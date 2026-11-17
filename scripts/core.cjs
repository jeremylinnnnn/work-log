'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function assert(ok, message) { if (!ok) throw new Error(message); }
function digest(value) { return 'sha256:' + crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function hashObject(value) { return digest(stable(value)); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value, exclusive = false) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const data = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) fs.writeFileSync(file, data, { flag: 'wx' });
  else {
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }
}
function lines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(s => s.trim()).map((s, i) => {
    try { return JSON.parse(s); } catch { throw new Error(`${file}: invalid JSONL line ${i + 1}`); }
  });
}
function append(file, value) { fs.appendFileSync(file, JSON.stringify(value) + '\n'); }
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) out._.push(argv[i]);
    else {
      const key = argv[i].slice(2);
      assert(!(key in out), `duplicate option --${key}`);
      out[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return out;
}
function required(o, key) { assert(typeof o[key] === 'string' && o[key].trim(), `missing --${key}`); return o[key]; }
function number(value, label, fallback = null, integer = false) {
  if (value === undefined || value === null || value === 'null') return fallback;
  const n = typeof value === 'boolean' ? NaN : Number(value);
  assert(Number.isFinite(n) && n >= 0 && (!integer || Number.isInteger(n)), `${label} must be a nonnegative ${integer ? 'integer' : 'number'}`);
  return n;
}
function bool(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error('expected true or false');
}
function walk(dir, suffix) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const file = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(file, suffix));
    else if (e.isFile() && (!suffix || file.endsWith(suffix))) out.push(file);
  }
  return out;
}
function treeHash(dir) {
  assert(fs.statSync(dir).isDirectory(), `artifact is not a directory: ${dir}`);
  const entries = [];
  function visit(current) {
    for (const e of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = path.join(current, e.name), rel = path.relative(dir, full).split(path.sep).join('/');
      assert(!e.isSymbolicLink(), `artifact symlink is unsupported: ${rel}`);
      if (e.isDirectory()) visit(full);
      else if (e.isFile()) entries.push([rel, fs.statSync(full).mode & 0o111, digest(fs.readFileSync(full))]);
      else throw new Error(`unsupported artifact entry: ${rel}`);
    }
  }
  visit(dir);
  return hashObject(entries);
}
function inside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function execute(argv, { cwd, timeout_ms = 60000, stdout_file, stderr_file, env = process.env } = {}) {
  assert(Array.isArray(argv) && argv.length && argv.every(s => typeof s === 'string' && !s.includes('\0')), 'argv must be a nonempty string array');
  assert(Number.isInteger(timeout_ms) && timeout_ms > 0, 'timeout_ms must be a positive integer');
  return new Promise(resolve => {
    const start = performance.now();
    const stdout = fs.openSync(stdout_file, 'wx'), stderr = fs.openSync(stderr_file, 'wx');
    let timed_out = false, spawn_error = null, settled = false;
    const proc = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', stdout, stderr] });
    const kill = () => {
      try { process.kill(process.platform === 'win32' ? proc.pid : -proc.pid, 'SIGKILL'); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => { timed_out = true; kill(); }, timeout_ms);
    proc.on('error', e => { spawn_error = e.message; });
    proc.on('close', (code, signal) => {
      if (settled) return; settled = true;
      clearTimeout(timer); kill(); fs.closeSync(stdout); fs.closeSync(stderr);
      resolve({ exit_code: code, signal, timed_out, spawn_error, wall_time_s: (performance.now() - start) / 1000 });
    });
  });
}
function evaluatorSpec(file) {
  file = fs.realpathSync(file);
  const spec = read(file);
  assert(spec.schema_version === 1 && typeof spec.id === 'string' && spec.id && typeof spec.version === 'string' && spec.version, 'invalid evaluator id/version/schema');
  assert(Array.isArray(spec.argv) && spec.argv.length && spec.argv.every(s => typeof s === 'string'), 'invalid evaluator argv');
  assert(Array.isArray(spec.files) && spec.files.length, 'evaluator.files must include trusted evaluator code');
  const files = spec.files.map(f => { assert(typeof f === 'string', 'invalid evaluator file'); const p = fs.realpathSync(path.resolve(path.dirname(file), f)); return { path: p, sha256: digest(fs.readFileSync(p)) }; });
  return { spec, files, sha256: hashObject({ spec, files }) };
}
async function evaluate({ spec_file, artifact_dir, evidence_dir, run_id, task_id, expected_spec_hash }) {
  spec_file = fs.realpathSync(spec_file); artifact_dir = fs.realpathSync(artifact_dir); evidence_dir = path.resolve(evidence_dir);
  evidence_dir = path.join(fs.realpathSync(path.dirname(evidence_dir)), path.basename(evidence_dir));
  assert(!inside(artifact_dir, evidence_dir) && !inside(artifact_dir, spec_file), 'evaluator and evidence must be outside the artifact');
  const info = evaluatorSpec(spec_file);
  assert(!info.files.some(f => inside(artifact_dir, f.path)), 'evaluator code must be outside the artifact');
  if (expected_spec_hash) assert(info.sha256 === expected_spec_hash, 'evaluator changed since registration');
  fs.mkdirSync(evidence_dir, { recursive: false });
  const artifact_hash = treeHash(artifact_dir);
  const argv = info.spec.argv.map(s => s.replaceAll('{artifact}', artifact_dir).replaceAll('{evaluator_dir}', path.dirname(spec_file)));
  const result = await execute(argv, { cwd: artifact_dir, timeout_ms: info.spec.timeout_ms || 60000, stdout_file: path.join(evidence_dir, 'stdout.txt'), stderr_file: path.join(evidence_dir, 'stderr.txt') });
  const after = treeHash(artifact_dir);
  const unchanged = artifact_hash === after && evaluatorSpec(spec_file).sha256 === info.sha256;
  const receipt = {
    schema_version: 1, producer: 'work-log-evaluator/v1', run_id, task_id,
    evaluator: { id: info.spec.id, version: info.spec.version, spec_file, sha256: info.sha256 },
    artifact: { directory: artifact_dir, sha256: after, hash_scope: 'all regular files except .git and node_modules; executable bits included; no symlinks' },
    ...result, unchanged, pass: result.exit_code === 0 && !result.timed_out && !result.spawn_error && unchanged,
    stdout_sha256: digest(fs.readFileSync(path.join(evidence_dir, 'stdout.txt'))),
    stderr_sha256: digest(fs.readFileSync(path.join(evidence_dir, 'stderr.txt'))), evaluated_at: new Date().toISOString()
  };
  const receipt_file = path.join(evidence_dir, 'receipt.json'); write(receipt_file, receipt, true);
  return { receipt, receipt_file, receipt_sha256: digest(fs.readFileSync(receipt_file)) };
}
function verifyOutcome(outcome, run, base = '.', expected = {}) {
  try {
    assert(outcome && typeof outcome.pass === 'boolean', 'missing evaluator outcome');
    assert(outcome.run_id === run.run_id && outcome.task_id === run.task_id, 'outcome/run identity mismatch');
    assert(typeof outcome.evidence_ref === 'string' && outcome.evidence_sha256, 'legacy/self-reported outcome has no receipt');
    const file = path.resolve(base, outcome.evidence_ref), r = read(file);
    assert(digest(fs.readFileSync(file)) === outcome.evidence_sha256, 'receipt hash mismatch');
    assert(r.schema_version === 1 && r.producer === 'work-log-evaluator/v1', 'unsupported receipt');
    assert(r.run_id === run.run_id && r.task_id === run.task_id && r.pass === outcome.pass, 'receipt identity/result mismatch');
    assert(typeof r.pass === 'boolean' && r.unchanged === true, 'artifact or evaluator changed during evaluation');
    assert(r.pass === (r.exit_code === 0 && !r.timed_out && !r.spawn_error && r.unchanged), 'receipt contradicts process result');
    assert(evaluatorSpec(r.evaluator.spec_file).sha256 === r.evaluator.sha256, 'evaluator evidence changed');
    if (expected.evaluator_hash) assert(r.evaluator.sha256 === expected.evaluator_hash, 'unregistered evaluator');
    if (expected.artifact_dir) assert(fs.realpathSync(r.artifact.directory) === fs.realpathSync(expected.artifact_dir), 'wrong artifact directory');
    assert(treeHash(r.artifact.directory) === r.artifact.sha256, 'artifact changed after evaluation');
    for (const stream of ['stdout', 'stderr']) assert(digest(fs.readFileSync(path.join(path.dirname(file), stream + '.txt'))) === r[stream + '_sha256'], `${stream} evidence changed`);
    return { verified: true, pass: r.pass, reason: null, receipt: r };
  } catch (e) { return { verified: false, pass: false, reason: e.message }; }
}
function stepStats(steps) {
  let calls = 0, nonzero = 0, unexpected = 0, unknown = 0, first = null, recovery = null;
  for (const [i, s] of steps.entries()) {
    if (!s.tool_call) continue;
    calls++;
    const code = s.tool_result?.exit_code;
    if (!Number.isInteger(code)) { unknown++; continue; }
    if (code !== 0) nonzero++;
    if (code !== 0 && !first && s.check_id) first = { i, id: s.check_id };
    const expected = s.expected_exit_codes || [0];
    if (!expected.includes(code)) {
      unexpected++;
    } else if (first && recovery === null && s.check_id === first.id && code === 0) recovery = i - first.i;
  }
  return { tool_calls: calls, nonzero_exit_calls: nonzero, unexpected_failures: unexpected, unknown_exit_calls: unknown, recovery_steps: recovery };
}
module.exports = { assert, digest, stable, hashObject, read, write, lines, append, args, required, number, bool, walk, treeHash, inside, execute, evaluatorSpec, evaluate, verifyOutcome, stepStats };

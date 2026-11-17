#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), os = require('node:os');
const C = require('./core.cjs');

function jsonl(file) { return file.endsWith('.jsonl') ? file : file.replace(/\.md$/, '') + '.jsonl'; }
function modelCheck(records, model) {
  C.assert(records[0]?.type === 'session', 'missing session');
  C.assert(typeof model === 'string' && model.trim().toLowerCase() === String(records[0].model).trim().toLowerCase(), 'model mismatch; create a separate log');
  return records[0];
}
function snapshot() {
  const root = path.resolve(__dirname, '..');
  return {
    behavior: C.hashObject(C.walk(__dirname, '.cjs').map(f => [path.basename(f), C.digest(fs.readFileSync(f))])),
    content: C.hashObject(C.walk(root).map(f => [path.relative(root, f), C.digest(fs.readFileSync(f))]))
  };
}
function render(file) {
  const records = C.lines(file), s = records[0];
  const out = ['# 工作过程日志 — ' + (s.project || ''), '', `- 模型：${s.model}`, `- 任务：${s.task}`, `- 任务 ID：${s.task_id}`, `- 开始：${s.started_at}`, '- 真相源：' + path.basename(file), ''];
  for (const r of records.slice(1)) {
    if (r.type === 'step') out.push(`### [${r.step_id}] ${r.timestamp} · ${r.stage || ''}`, '', r.raw_body || r.operation || '', '', '```json', JSON.stringify({ tool_call: r.tool_call, tool_result: r.tool_result, check_id: r.check_id, expected_exit_codes: r.expected_exit_codes }), '```', '');
    if (r.type === 'run' || r.type === 'outcome') out.push(`## ${r.type}`, '', '```json', JSON.stringify(r, null, 2), '```', '');
  }
  fs.writeFileSync(file.replace(/\.jsonl$/, '.md'), out.join('\n') + '\n');
}
function fields(body) {
  const f = {}; let key;
  for (const line of body.split('\n')) {
    const m = line.match(/^\*\*(.+?)\*\*\s*[：:]\s*(.*)$/);
    if (m) { key = m[1]; f[key] = m[2]; } else if (key) f[key] += '\n' + line;
  }
  return f;
}
async function main(argv = process.argv.slice(2)) {
  const o = C.args(argv), command = o._[0];
  if (!command || o.help) {
    console.log('log.cjs init|append|finish|evaluate|render --model NAME --file PATH\ninit: --root DIR --task TEXT --task-id ID\nappend: --stage NAME --tool NAME --command TEXT --exit-code INT --expected-exit-codes 0,1 --check-id ID; body on stdin\nevaluate: --spec FILE --artifact-dir DIR [--evidence-dir DIR]\nfinish: --status success|failed|abandoned|partial|unknown [--receipt FILE] [--pass true|false]'); return;
  }
  if (command === 'init') {
    const root = path.resolve(o.root || process.cwd()), model = C.required(o, 'model'), time = new Date().toISOString();
    C.assert(fs.statSync(root).isDirectory(), 'root must exist');
    const file = jsonl(path.resolve(root, o.file || path.join('docs', 'worklogs', time.replace(/[:.]/g, '-') + '-' + crypto.randomUUID().slice(0, 8) + '.jsonl')));
    C.assert(!fs.existsSync(file), 'log already exists; append or create a new file');
    const snap = snapshot();
    const s = { type: 'session', schema_version: 2, run_id: o['run-id'] || crypto.randomUUID(), task_id: o['task-id'] || C.hashObject({ project: o.project || path.basename(root), task: o.task || '' }), model, project: o.project || path.basename(root), component: o.component || null, task: o.task || '', started_at: time, skill_snapshot: snap.content, behavior_version: snap.behavior, environment: { platform: os.platform(), arch: os.arch(), node: process.version } };
    s.source_group = o['source-group'] || null;
    s.task_family = o['task-family'] || null;
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s) + '\n', { flag: 'wx' }); render(file);
    console.log(`LOG_FILE=${file.replace(/\.jsonl$/, '.md')}\nJSONL_FILE=${file}\nMODEL=${model}\nTASK_ID=${s.task_id}\nRUN_ID=${s.run_id}`); return;
  }
  const file = jsonl(path.resolve(C.required(o, 'file'))), records = C.lines(file), s = modelCheck(records, C.required(o, 'model'));
  if (command === 'render') { render(file); return; }
  if (command === 'append') {
    C.assert(!records.some(r => r.type === 'run'), 'run is finished; create a new session');
    const stage = C.required(o, 'stage'), body = fs.readFileSync(0, 'utf8').trim(), f = fields(body);
    C.assert(body, 'empty stdin body');
    const code = o['exit-code'] === undefined || o['exit-code'] === 'null' ? null : Number(o['exit-code']);
    C.assert(code === null || Number.isInteger(code), 'exit-code must be an integer or null');
    const expected = String(o['expected-exit-codes'] || '0').split(',').map(Number);
    C.assert(expected.length && expected.every(Number.isInteger), 'invalid expected-exit-codes');
    C.append(file, { type: 'step', schema_version: 2, run_id: s.run_id || null, task_id: s.task_id, step_id: Math.max(0, ...records.filter(r => r.type === 'step').map(r => r.step_id)) + 1, timestamp: new Date().toISOString(), stage, component: o.component || s.component, tool_call: o.tool || o.command ? { name: o.tool || 'command', command: o.command || null } : null, tool_result: { output: f['结果（原始）'] || f['结果'] || '', exit_code: code, truncated: Boolean(o.truncated) }, expected_exit_codes: expected, check_id: o['check-id'] || null, operation: f['操作'] || body, interpretation: f['解读'] || f['判断'] || null, decision_note: f['思路'] || null, next_step: f['下一步'] || null, raw_body: body });
    render(file); console.log('OK append'); return;
  }
  const run_id = s.run_id || o['run-id'];
  C.assert(run_id, 'legacy session needs --run-id');
  if (command === 'evaluate') {
    C.assert(!records.some(r => r.type === 'run'), 'evaluate before finish');
    const evidence_dir = path.resolve(o['evidence-dir'] || path.join(path.dirname(file), 'evidence-' + crypto.randomUUID()));
    fs.mkdirSync(path.dirname(evidence_dir), { recursive: true });
    const result = await C.evaluate({ spec_file: C.required(o, 'spec'), artifact_dir: C.required(o, 'artifact-dir'), evidence_dir, run_id, task_id: s.task_id });
    console.log(`RECEIPT=${result.receipt_file}\nPASS=${result.receipt.pass}`); return;
  }
  C.assert(command === 'finish', `unknown command: ${command}`);
  C.assert(!records.some(r => r.type === 'run'), 'one run per session; create a new log');
  const status = C.required(o, 'status'); C.assert(['success', 'failed', 'abandoned', 'partial', 'unknown'].includes(status), 'invalid status');
  const source = o['metrics-source'] || 'unknown'; C.assert(['client', 'harness', 'self', 'unknown'].includes(source), 'invalid metrics-source');
  const steps = records.filter(r => r.type === 'step'), stats = C.stepStats(steps);
  const run = { type: 'run', schema_version: 2, run_id, task_id: s.task_id, task_family: o['task-family'] || null, model: s.model, model_version: o['model-version'] || null, skill_snapshot: s.skill_snapshot, behavior_version: s.behavior_version || null, prompt_version: o['prompt-version'] || null, env_hash: o['env-hash'] || null, tool_inventory: o['tool-inventory'] ? [...new Set(o['tool-inventory'].split(',').map(x => x.trim()))].sort() : null, started_at: s.started_at, ended_at: new Date().toISOString(), last_step_id: steps.at(-1)?.step_id || 0, status, metrics_source: source, comparable: C.bool(o.comparable, true), tool_calls: C.number(o['tool-calls'], 'tool-calls', steps.some(x => x.tool_call) ? stats.tool_calls : null, true), failed_tool_calls: C.number(o['failed-tool-calls'], 'failed-tool-calls', steps.some(x => x.tool_call) ? stats.unexpected_failures : null, true), tokens_in: C.number(o['tokens-in'], 'tokens-in', null, true), tokens_out: C.number(o['tokens-out'], 'tokens-out', null, true), wall_time_s: C.number(o['wall-time-s'], 'wall-time-s'), human_interventions: C.number(o['human-interventions'], 'human-interventions', null, true), retries: C.number(o.retries, 'retries', null, true) };
  run.source_group = s.source_group || null;
  run.task_family = run.task_family || s.task_family || null;
  let outcome;
  if (o.receipt) {
    const ref = path.resolve(o.receipt), receipt = C.read(ref);
    outcome = { type: 'outcome', schema_version: 2, run_id, task_id: s.task_id, evaluator: receipt.evaluator?.id, pass: receipt.pass, evidence_ref: path.relative(path.dirname(file), ref), evidence_sha256: C.digest(fs.readFileSync(ref)), evaluated_at: receipt.evaluated_at };
    const v = C.verifyOutcome(outcome, run, path.dirname(file)); C.assert(v.verified, v.reason);
  } else if (o.pass !== undefined || o.evaluator) {
    outcome = { type: 'outcome', schema_version: 2, run_id, task_id: s.task_id, pass: C.bool(o.pass), evaluator: o.evaluator || null, criteria: o.criteria || null, evidence_ref: o['evidence-ref'] || null, evidence_sha256: null, source: 'caller', evaluated_at: new Date().toISOString() };
  }
  C.append(file, run); if (outcome) C.append(file, outcome); render(file);
  console.log(`OK finish\nRUN_ID=${run_id}\nOUTCOME=${outcome ? 'written' : 'missing'}\nJSONL_FILE=${file}`);
}
if (require.main === module) main().catch(e => { console.error('ERROR: ' + e.message); process.exitCode = 1; });
module.exports = { main, render, jsonl };

#!/usr/bin/env node
'use strict';
const fs = require('node:fs'), path = require('node:path');
const C = require('./core.cjs');

function summarize(dir, cost = 'tool_calls') {
  C.assert(['tool_calls', 'tokens', 'wall_time_s'].includes(cost), 'cost must be tool_calls, tokens, or wall_time_s');
  const runs = [], quality = [];
  for (const file of C.walk(dir, '.jsonl')) {
    let records;
    try { records = C.lines(file); } catch (e) { quality.push({ file, error: e.message }); continue; }
    const s = records[0]; if (s?.type !== 'session') { quality.push({ file, error: 'not a work-log session' }); continue; }
    const finished = records.filter(r => r.type === 'run');
    const fileRuns = finished.length ? finished : [{ run_id: s.run_id || 'unfinished:' + file, task_id: s.task_id, model: s.model, status: 'unfinished' }];
    let previous = 0;
    for (const r of fileRuns) {
      const outcomes = records.filter(o => o.type === 'outcome' && o.run_id === r.run_id);
      const steps = records.filter(o => o.type === 'step' && (!finished.length || (o.step_id > previous && (fileRuns.length === 1 || o.step_id <= r.last_step_id))));
      previous = r.last_step_id || previous;
      const stats = C.stepStats(steps), identity = r.model === s.model && r.task_id === s.task_id;
      const v = identity && outcomes.length === 1 ? C.verifyOutcome(outcomes[0], r, path.dirname(file)) : { verified: false, pass: false, reason: !identity ? 'session/run identity mismatch' : 'missing or duplicate outcome' };
      let value = null;
      if (cost === 'tool_calls') value = Number.isFinite(r.tool_calls) ? r.tool_calls : steps.some(x => x.tool_call) ? stats.tool_calls : null;
      else if (['client', 'harness'].includes(r.metrics_source)) value = cost === 'tokens' ? Number.isFinite(r.tokens_in) && Number.isFinite(r.tokens_out) ? r.tokens_in + r.tokens_out : null : r.wall_time_s ?? null;
      if (!(typeof value === 'number' && Number.isFinite(value) && value >= 0)) value = null;
      runs.push({ ...r, task_family: r.task_family || s.task_family || s.task_id || 'unknown', file, declared_pass: outcomes[0]?.pass ?? null, outcome_present: outcomes.length > 0, verified: v.verified, verified_success: v.verified && v.pass && r.status === 'success', evidence_error: v.reason, cost_basis: cost, cost: value, diagnostic: stats });
    }
  }
  const ids = new Map(); for (const r of runs) ids.set(r.run_id, (ids.get(r.run_id) || 0) + 1);
  for (const r of runs) if (ids.get(r.run_id) > 1) { r.verified = false; r.verified_success = false; r.evidence_error = 'duplicate run_id'; }
  const groups = new Map();
  for (const r of runs) { const key = JSON.stringify([r.task_family, r.model]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  const family_metrics = [...groups.values()].map(g => {
    const successes = g.filter(r => r.verified_success).length, complete = g.every(r => r.cost !== null);
    return { task_family: g[0].task_family, model: g[0].model, tasks: new Set(g.map(r => r.task_id)).size, runs: g.length, verified: successes, evaluated: g.filter(r => r.verified).length, missing_or_unverified: g.filter(r => !r.verified).length, unfinished: g.filter(r => r.status === 'unfinished').length, pass_rate: successes / g.length, evaluation_coverage: g.filter(r => r.verified).length / g.length, cost_basis: cost, cost_complete: complete, total_cost: complete ? g.reduce((a, r) => a + r.cost, 0) : null, cost_per_success: complete && successes ? g.reduce((a, r) => a + r.cost, 0) / successes : null, noncomparable: g.filter(r => r.comparable === false).length };
  });
  return { schema_version: 2, generated_at: new Date().toISOString(), family_metrics, runs, data_quality: quality, notes: ['pass_rate denominator includes all recorded sessions/runs, including unfinished and unverified runs; only a preregistered experiment manifest can detect entirely absent runs', 'cost unit is fixed for the whole report; missing values never switch units', 'tool counts from manual logs are recorded calls, not audited native call counts', 'exit status and recovery are diagnostics; recovery requires a matching check_id', 'receipts provide local integrity checks, not protection against a writer controlling the evaluator and evidence'] };
}
function markdown(report) {
  const rows = ['# Work Log 汇总', '', '| 任务族 | 模型 | 运行 | 验证成功 | 未验证 | 通过率 | 成本单位 | 成本/成功 |', '| --- | --- | ---: | ---: | ---: | ---: | --- | ---: |'];
  const esc = x => String(x ?? '-').replaceAll('|', '\\|').replaceAll('\n', ' ');
  for (const r of report.family_metrics) rows.push('| ' + [r.task_family, r.model, r.runs, r.verified, r.missing_or_unverified, (r.pass_rate * 100).toFixed(1) + '%', r.cost_basis, r.cost_per_success].map(esc).join(' | ') + ' |');
  rows.push('', ...report.notes.map(s => '- ' + s), '', '## 数据质量', '', '```json', JSON.stringify([...report.data_quality, ...report.runs.filter(r => r.evidence_error).map(r => ({ run_id: r.run_id, error: r.evidence_error }))], null, 2), '```');
  return rows.join('\n') + '\n';
}
function main() {
  const o = C.args(process.argv.slice(2)); if (o.help) { console.log('summarize.cjs --dir DIR [--cost tool_calls|tokens|wall_time_s] [--json] [--out FILE]'); return; }
  const report = summarize(path.resolve(o.dir || 'docs/worklogs'), o.cost || 'tool_calls'), out = o.json ? JSON.stringify(report, null, 2) + '\n' : markdown(report);
  if (o.out) { fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true }); fs.writeFileSync(o.out, out); } else process.stdout.write(out);
}
if (require.main === module) { try { main(); } catch (e) { console.error('ERROR: ' + e.message); process.exitCode = 1; } }
module.exports = { summarize, markdown };

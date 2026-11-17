# work-log

> Keep traceable evidence of what an agent actually did, and summarize outcomes and cost.

An agent skill for recording engineering work as structured evidence. Every non-trivial task gets a JSONL log of *operation → observation → decision*; a Markdown view is regenerated from it, never hand-maintained.

The point is not a diary. It is an auditable record of **real tool calls, real exit codes and real output**, so that later claims of "it's fixed" can be checked against something.

## Why JSONL is the source of truth

Two copies of the same facts always drift. Here the JSONL run file is authoritative and the Markdown file is a rebuildable view (`render` regenerates it if it drifts).

## Usage

### Start a run

```bash
node scripts/log.cjs init --root /abs/project --model Codex \
  --task 'fix dependency conflict' --task-id stable-task-id \
  --task-family dependency-conflict \
  --source-group repository-and-issue-cluster
```

Keep the returned `LOG_FILE`, `JSONL_FILE` and `RUN_ID`. One session allows exactly one run — repeated trials get their own session.

### Append a step

```bash
node scripts/log.cjs append --file /abs/run.jsonl --model Codex \
  --stage verify --tool exec_command --command 'npm test' \
  --exit-code 1 --check-id regression <<'EOF'
**Operation**: ran the regression check.
**Result (raw)**: exit_code=1; key error text preserved verbatim.
**Reading**: the original problem is not resolved.
EOF
```

Rules that matter:

- An unknown exit code is written as `null` — **never** as `0`.
- Expected non-zero exits are declared with `--expected-exit-codes 0,1`.
- `check_id` identifies one verification target; a recovery only counts when that same check passes again.
- Operation, raw result and reading are written separately.
- Long output is excerpted with an explicit truncation marker; full evidence goes to a separate file.
- No secrets, tokens or private data, ever.

### Finish

```bash
node scripts/log.cjs finish --file /abs/run.jsonl --model Codex \
  --status success --task-family dependency-conflict
```

Without an independent evaluator, finish honestly — self-reported success is not `verified`. With one, run `evaluate` first and hand its receipt to `finish`. Evaluator code, credentials and logs live outside the artifact under test, and the verification criteria may not be edited to make something pass.

### Summarize

```bash
node scripts/summarize.cjs --dir /abs/logs --cost tool_calls --json
```

One cost unit per report; missing data is reported as unknown rather than silently converted. Token and duration figures only count when supplied by the client or executor — model estimates are tagged `self`.

## Requirements

Node.js 20+, no third-party dependencies.

## Install

```bash
git clone https://github.com/jeremylinnnnn/work-log.git \
  ~/.workbuddy-ai/skills/work-log
```

For Claude Code, clone into `~/.claude/skills/work-log` instead.

## Layout

```
SKILL.md               entry point and recording rules
references/cli.md      evaluator format
scripts/log.cjs        init / append / finish / evaluate / render
scripts/summarize.cjs  aggregate across runs
scripts/core.cjs       shared storage layer
agents/openai.yaml     agent metadata
```

## Honest limits

- A manual log can only measure calls that were recorded; it cannot prove nothing was missed.
- Cross-task aggregation is for *finding candidates*, not for causal claims about a strategy.
- Strict experiments need a pre-registered manifest from [better-solution](../better-solution); an ordinary log cannot detect runs that are missing entirely.

## Companion skill

[better-solution](https://github.com/jeremylinnnnn/better-solution) consumes these logs as its evidence base.

## License

MIT — see [LICENSE](LICENSE).

---
name: work-log
description: 在工程排查、构建和多步实现中保留可追溯的操作证据，并汇总结果与成本；也用于明确要求记录过程的任务。支持 better-solution 的证据采集，单步问答和纯概念解释不启用。
metadata:
  short-description: 记录工程操作与独立评估，以 JSONL 为准并生成可阅读的日志
---

# Work Log v4

在非平凡工程任务开始时建立日志，在关键“操作—观察—决策”循环后追加，结束时写入 run。不要为每个读取动作撰写长篇叙事。记录简短决策说明、真实工具参数、原始结果、失败与回退；不推测或要求输出隐藏推理。

本技能依赖 Node.js 20+，无第三方依赖。下文脚本路径相对于本 SKILL.md 所在目录。

## 记录

```bash
node scripts/log.cjs init --root /absolute/project --model Codex \
  --task '修复目标问题' --task-id stable-task-id --task-family dependency-conflict \
  --source-group repository-and-issue-cluster
```

保留返回的 LOG_FILE、JSONL_FILE、RUN_ID。每次写入必须带相同 `--model`。模型名称取已知的实际名称；不知道具体版本时不要编造。跨模型各建独立日志，不向其他模型文件追加。一次 session 只允许一个 run；重复试验另建 session。

```bash
node scripts/log.cjs append --file /absolute/run.jsonl --model Codex \
  --stage 验证 --tool exec_command --command 'npm test' \
  --exit-code 1 --check-id regression <<'EOF'
**操作**：运行回归检查。
**结果（原始）**：exit_code=1；保留关键报错原文。
**解读**：原问题仍未解决。
EOF
```

退出码未知时写 `null`，不能写成 0；预期非零退出用 `--expected-exit-codes 0,1` 明确表达。`check_id` 标识同一个验证目标；恢复必须由原检查再次通过确认。`--command` 会作为工具动作记录，即使没有 `--tool`。正文中的操作、原始结果、解读分开写；决策说明可省略。输出较长时摘关键原文并标注已截断，完整证据另存文件。禁止写入密钥、令牌、隐私。

## 结束与评估

没有独立评估时，照实 finish；不能把自述成功当成 verified。

```bash
node scripts/log.cjs finish --file /absolute/run.jsonl --model Codex \
  --status success --task-family dependency-conflict
```

有可运行的独立评估器时，先读 [references/cli.md](references/cli.md) 中的评估器格式。在 finish 之前运行 `evaluate`，再把返回的 receipt 交给 finish。评估器代码、凭据和日志应位于被测产物目录外；不得修改验证标准来得到通过。

JSONL 是权威记录；Markdown 是可重建视图，不手工维护两份真相。每次追加自动生成 Markdown；发生视图漂移时运行 `render`。旧 v3 JSONL 可用于汇总，其调用方填入的 pass 保留为 declared_pass，不自动升级为独立验证。

```bash
node scripts/summarize.cjs --dir /absolute/logs --cost tool_calls --json
```

整份报告使用一种成本单位，缺失时报告未知，不自动换单位。手动日志只能衡量已记录调用，不能证明没有漏记。token/耗时由客户端或执行器提供才参与相应汇总，模型估计标 self。跨任务汇总仅用于发现候选策略，不能作为策略有效的因果证据。

严格实验的分母由 better-solution 的预登记 manifest 决定；普通日志无法发现整份缺失的运行。日志完成或交接时写明当前产物、实际验证结果和待办。

# work-log

把 Agent 做了什么留下可追溯的 JSONL 证据，并汇总结果与成本。

一个 Agent Skill。每个非平凡任务建一份 JSONL 日志，按操作、观察、决策逐条追加。Markdown 视图由 JSONL 生成，可以随时重建。

记录内容是真实的工具调用、退出码和输出，用来核对后续关于任务是否完成的说法。

## 为什么跨模型也能比

每条记录都带 `model` 字段，规则要求每个模型写自己的日志文件，不往其他模型的文件里追加。同一个任务族下，不同模型的记录自然分组，工具调用数、失败数和验证轮数可以横向比较。

这是 [better-solution](https://github.com/jeremylinnnnn/better-solution) 做跨模型策略对比的数据基础。

## 以 JSONL 为准

同一份事实存两份会分叉。这里 JSONL 是权威记录，Markdown 是可重建的视图，漂移时用 `render` 重新生成。

## 使用

### 建立 run

```bash
node scripts/log.cjs init --root /abs/project --model Codex \
  --task '修复依赖冲突' --task-id stable-task-id \
  --task-family dependency-conflict \
  --source-group repository-and-issue-cluster
```

记下返回的 `LOG_FILE`、`JSONL_FILE` 和 `RUN_ID`。一次 session 对应一个 run，重复试验另建 session。

### 追加一步

```bash
node scripts/log.cjs append --file /abs/run.jsonl --model Codex \
  --stage 验证 --tool exec_command --command 'npm test' \
  --exit-code 1 --check-id regression <<'EOF'
**操作**：运行回归检查。
**结果（原始）**：exit_code=1；保留关键报错原文。
**解读**：原问题仍未解决。
EOF
```

几条约定：

- 退出码未知时写 `null`。
- 预期非零退出用 `--expected-exit-codes 0,1` 声明。
- `check_id` 标识同一个验证目标，原检查再次通过时才算恢复。
- 操作、原始结果和解读分开写。
- 长输出摘关键原文并标注截断，完整证据另存文件。

### 结束

```bash
node scripts/log.cjs finish --file /abs/run.jsonl --model Codex \
  --status success --task-family dependency-conflict
```

没有独立评估器时，`finish` 记录的是自述状态。有评估器时先运行 `evaluate`，把返回的 receipt 交给 `finish`。评估器代码、凭据和日志放在被测产物目录之外。

### 汇总

```bash
node scripts/summarize.cjs --dir /abs/logs --cost tool_calls --json
```

一份报告使用一种成本单位，缺失时报告未知。token 和耗时只计入客户端或执行器提供的数值，模型估计的部分标记为 `self`。

## 依赖

Node.js 20+，无第三方依赖。

## 安装

```bash
git clone https://github.com/jeremylinnnnn/work-log.git \
  ~/.workbuddy-ai/skills/work-log
```

Claude Code 的安装路径是 `~/.claude/skills/work-log`。

## 目录结构

```
SKILL.md               入口与记录规则
references/cli.md      评估器格式
scripts/log.cjs        init / append / finish / evaluate / render
scripts/summarize.cjs  跨 run 汇总
scripts/core.cjs       存储层
agents/openai.yaml     Agent 元数据
```

## 适用范围

- 手动日志覆盖已记录的调用，未记录的调用不计入统计。
- 跨任务汇总用于发现候选策略，不构成因果证据。
- 严格实验需要 [better-solution](https://github.com/jeremylinnnnn/better-solution) 的预登记 manifest。

## 配套 skill

[better-solution](https://github.com/jeremylinnnnn/better-solution) 把这些日志当作证据库。

## 许可

MIT，见 [LICENSE](LICENSE)。

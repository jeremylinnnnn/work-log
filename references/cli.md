# 命令与证据契约

需要 Node.js 20+。所有路径参数可用绝对路径；相对 `--file` 在 init 时按 `--root` 解释，其余命令按当前工作目录解释。`.md` 参数自动映射到同名 `.jsonl`。

## init / append / finish / render

- `init --root DIR --model NAME --task TEXT --task-id ID`：建 session 并立即分配 UUID run_id；可选 `--file`、`--project`、`--component`、`--task-family`、`--source-group`、`--run-id`。已有 JSONL 拒绝覆盖。
- `append --file FILE --model NAME --stage NAME`：stdin 接收记录。`--tool`、`--command`、`--exit-code INT|null`、`--expected-exit-codes 0,1`、`--check-id ID`、`--component`、`--truncated` 为可选项。
- `finish --file FILE --model NAME --status STATUS`：status 为 success / failed / abandoned / partial / unknown。可选 `--receipt FILE`、`--task-family`、`--model-version`、`--prompt-version`、`--env-hash`、`--tool-inventory bash,read`、`--metrics-source client|harness|self|unknown`、`--tokens-in`、`--tokens-out`、`--wall-time-s`、`--tool-calls`、`--failed-tool-calls`、`--human-interventions`、`--retries`、`--comparable true|false`。数值必须非负；次数必须整数。旧 session 无 run_id 时必须显式传 `--run-id`。
- `render --file FILE --model NAME`：从 JSONL 重建 Markdown。

`finish --pass true --evaluator pytest` 仅用于兼容调用方自述，不产生 verified。实际模型身份和 metrics_source 仍需调用方正确提供；字符串声明本身不是可信测量。

## 独立评估

评估器 JSON 示例，代码和 JSON 都放在被测产物目录外：

```json
{
  "schema_version": 1,
  "id": "project-regression",
  "version": "1",
  "argv": ["node", "{evaluator_dir}/verify.cjs", "{artifact}"],
  "files": ["verify.cjs"],
  "timeout_ms": 60000
}
```

argv 是参数数组，执行时不启用 shell。`{evaluator_dir}` 是 JSON 所在目录，`{artifact}` 是被测产物目录。`files` 列出验证器及其直接、间接本地代码/测试数据依赖，用于计算评估器摘要。第三方依赖、运行时和系统工具版本由实验环境快照另行固定。

验证器必须在成功时退出 0，失败时非零；检查正确性、回归和任务约束。该版本要求验证器不改动产物目录；构建缓存和测试临时输出放到目录外。

```bash
node scripts/log.cjs evaluate --file /absolute/run.jsonl --model Codex \
  --spec /absolute/evaluator/spec.json --artifact-dir /absolute/artifact
node scripts/log.cjs finish --file /absolute/run.jsonl --model Codex \
  --status success --receipt /absolute/evidence/receipt.json
```

evaluate 输出真实 `RECEIPT=` 路径。凭据包含 run/task、评估器版本与摘要、产物摘要、退出码、超时、原始 stdout/stderr 摘要。后续验证重新检查这些关联；产物、评估器或输出改变后，旧凭据不再验证当前产物。

产物摘要包含所有普通文件和可执行位，跳过 `.git` 和 `node_modules`；拒绝符号链接。被跳过的依赖不能因此视为已固定。大型仓库应先准备最小、完整且依赖受控的被测目录。保留产物与证据原路径，否则报告会显示无法复核。

这些哈希用于本地完整性和错误绑定检测，不是第三方签名，也不抵抗同时控制代码、验证器和证据的写入者。实验执行器本身不提供操作系统隔离。

## 汇总

`summarize.cjs --dir DIR [--cost tool_calls|tokens|wall_time_s] [--json] [--out FILE]`

默认 tool_calls，所有组保持同一单位；缺任一运行的成本时该组总成本和 cost/success 为 null。失败成本包含在分子；零成功时 cost/success 为 null，不报告为 0。通过率分母包括已记录的未结束 session 和未验证运行，分子要求凭据验证通过且运行正常完成。无法解析的文件单独报告，不据残缺数据推断成功。

JSONL schema_version=2：session / step / run / outcome。behavior_version 是脚本摘要；skill_snapshot 是技能全部文件摘要，文档变化不会悄悄等同于执行器代码变化。人工标记 comparable=false 会保留在报告中；是否能比较取决于 task、环境、提示、工具、版本和具体问题，不能用该布尔值做全局裁决。

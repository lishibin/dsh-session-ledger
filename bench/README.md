# Benchmark fixture

这些脚本是 Harness 无关的基准基线，用来固定数据集、验证指标和检测“重启后是否重新扫描全部事件”。它们不是 `dsh-session-query-sqlite` 的实现，也不能替代真实 Harness 集成测试。

## 快速运行

```bash
npm run bench:generate
npm run bench
npm run check
```

M4 的可复现实验使用临时索引，避免复用旧的增量状态：

```bash
npm run bench:m4
```

结果写入被忽略的 `bench/results/m4-latest.json`，包含首次构建、重启加载、追加 1,000 条事件和追加前后的查询样本。

默认生成 100,000 条事件、1,000 个会话和 10 个工作区。首次 `npm run bench` 会构建一个可重启复用的参考 token 索引；再次运行会直接加载索引并执行查询。输出中的 `eventsScanned=0` 只表示参考索引的重启路径满足基线，不代表官方 provider 已经满足该指标。

## 输出

基准结果写入 `bench/results/latest.json`，包含：

- 数据集规模与 fixture 哈希；
- 初次构建、重启加载、查询和增量追加的耗时；
- 查询 p50/p95/p99；
- 扫描事件数与索引新增文档数；
- Node 和平台信息。

真实 Harness 集成完成后，应使用同一份 fixture，通过 `ctx.sessionQuery` 重跑相同查询，并把 provider 的索引状态、错误码和 full rebuild 次数加入结果。

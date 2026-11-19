# dsh-session-ledger

DeepSeek Harness 的可追溯会话证据与用户确认式长期记忆插件设计。

设计文档：[`docs/design/session-ledger.md`](docs/design/session-ledger.md)

第一版复用 Harness 的 `ctx.sessionQuery` 与 `ctx.storageDomain`，不重复实现会话全文索引。

M1 账本核心、真实 Harness 适配器、Domain 重启恢复测试和 Host smoke 已完成。运行 `npm test` 验证核心与真实 Domain 恢复行为。

M3 已接入 Harness 的 `ctx.userQuestions` approval intent：`ctx.sessionLedgerConfirmation.request()` 展示候选和来源，只有用户选择保存才晋升长期记忆，拒绝则转为 `dismissed`。

M5 已补齐来源二次验证、确认凭证防重放和记忆生命周期状态机：晋升前复核事件身份、内容哈希、时间和来源版本；重复签发会使旧确认失效；并发晋升按候选串行化且保持幂等。详见 [`docs/release/m5.md`](docs/release/m5.md)。

现在已经包含 Harness 组合包入口：`src/plugin.mjs` 会打开 `session_ledger` domain，并提供 `ctx.sessionLedger` 与 `ctx.sessionLedgerConfirmation`；`cordis.patch.yml` 从 `DSH_SESSION_LEDGER_SECRET` 读取确认令牌密钥。适配器当前把规范化的 `SessionHeader.cwd` 作为 workspace key，等 workspace registry 适配稳定后再切换为正式 workspace ID。

发布说明见 [`docs/release/0.1.0.md`](docs/release/0.1.0.md)，基准结果见 [`docs/release/m4-benchmark.md`](docs/release/m4-benchmark.md)，社区 Discussion 草稿见 [`docs/community/discussion-draft.md`](docs/community/discussion-draft.md)。

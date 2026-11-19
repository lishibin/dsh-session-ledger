# Harness API compatibility checklist

## Baseline selected on 2026-11-19

| Package | Baseline | Why |
| --- | --- | --- |
| `@deepseek-ai/dsh` | `0.2.2-rc.5` | 本机实际安装并通过 Host smoke 的版本 |
| `@deepseek-ai/dsh-session-query` | `0.0.1-rc.1` | 提供 `ctx.sessionQuery` 类型和查询契约 |
| `@deepseek-ai/dsh-session-query-sqlite` | `0.0.1-rc.1` | 提供 SQLite FTS5 搜索投影 |
| `@deepseek-ai/dsh-storage-domain` | `0.0.1-rc.1` | 提供跨重启的 schema 校验存储 |

版本是基准实验选择，不是对 Harness 稳定 API 的承诺。发布插件前要固定一个实际安装过、测试通过的版本范围。

## 已确认的依赖面

- `ctx.sessionQuery.searchSessions(request)`：跨会话全文搜索；
- `ctx.sessionQuery.searchEvents(request)`：单会话事件搜索；
- `ctx.sessionQuery.readEvent(request)`：读取带边界的具体事件；
- `ctx.sessionQuery.listSessions()` / `filterSessions()`：工作区和来源可用性过滤；
- `ctx.storageDomain.open(spec)`：打开长期记忆 domain；
- storage-domain 的写入在 resolve 前持久化，并通过 schema 校验。
- `ctx.userQuestions.ask()` 的 approval intent 可承载用户确认；插件不依赖具体 UI，只依赖稳定的 question/answer 结构。
- `SESSION_QUERY_STALE_CURSOR`、`SESSION_QUERY_INVALID_CURSOR` 和 `SESSION_QUERY_INDEX_FAILED` 是查询降级边界；适配器会保留错误码并报告 `degraded` 健康状态。
- 缺失路由 backend 时，`ctx.storageDomain.open()` 返回稳定的 `backend-not-found` 错误。
- `session_ledger` Domain 的跨重启恢复和真实 Host 启动 smoke 已通过。

## 尚未确认、禁止写死的接口

1. 具体确认 UI 的视觉呈现仍由 answerer 决定，插件只依赖 `ctx.userQuestions.ask()` 的稳定服务和 approval intent；
2. SQLite provider 的索引滞后、最后索引事件和 full rebuild 诊断接口；
3. 插件配置中持久化查询索引路径的最终写法；
4. 目标发行线是否允许插件声明并复用 `session-query-sqlite`；
5. `dsh-superagent` Ticket 对象的稳定扩展点。

## 复核命令

```bash
npm view @deepseek-ai/dsh@next version
npm view @deepseek-ai/dsh@latest version
npm view @deepseek-ai/dsh-session-query version
npm view @deepseek-ai/dsh-session-query-sqlite version
npm view @deepseek-ai/dsh-storage-domain version
```

## 接入前置条件

- 用目标版本启动一个最小 Host；
- 确认 `ctx.sessionQuery` 在有持久化会话时可用；
- 确认索引路径可配置且重启后文件仍存在；
- 确认查询结果包含 `session_id`、`event_seq`、时间和工作区可判定信息；
- 确认 storage-domain 可以打开 `session_ledger` domain；
- 记录任何缺失接口为上游 Discussion，而不是在插件里访问内部文件或私有服务。

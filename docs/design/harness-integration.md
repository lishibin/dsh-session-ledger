# Harness 集成说明

## 已接入的真实接口

目标发行线为 `@deepseek-ai/dsh@0.2.2-rc.5`（兼容范围为 `>=0.2.2-rc.4 <0.3.0`）。

- `ctx.sessionQuery.searchSessions()`：通过 `SessionSearchRequest.sessionFilters` 限定会话 ID；
- `ctx.sessionQuery.listSessions()`：读取带 `header` 的逻辑会话记录，用于工作区筛选；
- `ctx.sessionQuery.readEvent()`：从返回的 `window.target` 提取事件序号、时间和正文；
- `extractSessionEventText()`：复用官方事件语义抽取规则，避免自行解释 SessionEvent；
- `ctx.storageDomain.open(sessionLedgerDomainSpec)`：打开版本为 1 的 `session_ledger` domain；
- `ctx.userQuestions.ask()`：通过官方 approval intent 展示候选记忆并等待用户选择；
- `ctx.provide('sessionLedger', ledger)`：按 Cordis 生命周期提供 Host-side 服务。
- `ctx.provide('sessionLedgerConfirmation', confirmation)`：提供不暴露 token 的确认到晋升桥接服务。

实现位置：

- [domain-spec.mjs](../../src/domain-spec.mjs)
- [storage-domain-adapter.mjs](../../src/storage-domain-adapter.mjs)
- [session-query-adapter.mjs](../../src/session-query-adapter.mjs)
- [plugin.mjs](../../src/plugin.mjs)

## 当前工作区边界

官方 `SessionHeader` 提供 `cwd`，而不是 workspace registry ID。当前适配器把 `cwd` 原样作为 `workspaceId`，并且先调用 `listSessions()` 得到同一 cwd 的 session ids，再把这些 ids 传给全文查询。

这保证了第一版不会把不存在的 workspace 字段写进来源记录，但首次搜索会增加一次会话元数据列表调用。后续接入 `ctx.workspaceRegistry` 后，可以把 workspace 成员关系交给官方 workspace 服务，减少这层转换。

## 安装形态

组合包通过 [cordis.patch.yml](../../cordis.patch.yml) 插入插件行：

```yaml
- insert:
    - id: dsh-session-ledger
      name: dsh-session-ledger
      config:
        confirmationSecret: !!js process.env.DSH_SESSION_LEDGER_SECRET
```

启动前设置密钥：

```bash
export DSH_SESSION_LEDGER_SECRET="use-a-profile-specific-random-secret"
dsh plugin --profile demo add /absolute/path/to/dsh-session-ledger
dsh --profile demo --dump-config
```

本地有 Harness 可执行文件时，可以用仓库内的 smoke test 重复执行同样检查：

```bash
DSH_PROFILE=demo npm run smoke:host
```

如果命令名不是 `dsh`，设置 `DSH_BIN=/absolute/path/to/dsh`。该检查会安装当前包到指定 profile，并要求 profile 配置成功导出；它不会自动启动一个长期运行的 Host 进程。

插件要求宿主 profile 已经提供 `sessionQuery`、`storageDomain` 和 `userQuestions`；缺少任一服务时，Cordis 会让插件保持 pending，而不是以空历史启动。

M3 的确认入口是 `ctx.sessionLedgerConfirmation.request({ candidateId, kind, agent, signal })`。它会把候选文本和已脱敏来源交给 `ctx.userQuestions.ask()`，只有选中 `Save as long-term memory` 才在 Host 内使用绑定的 HMAC token 调用 `promote()`；选择 `Do not save` 会审计并转为 `dismissed`，取消或没有 answerer 则不会改变候选的 `presented` 状态。

## Host smoke 的执行边界

真实 Domain 重启测试已经使用官方 `dsh-storage-domain` 与 `dsh-storage-json` 完成。Node 24 和 `dsh@0.2.2-rc.5` 已安装后，隔离 profile 的 Host smoke 也已执行：插件安装、配置导出通过，`dsh --profile demo --no-open` 保持运行超过 15 秒且没有启动错误，随后手动终止进程。

尚未覆盖的是端到端记忆操作：当前 smoke 没有注入真实会话事件，也没有从运行中的 Host 调用 `ctx.sessionLedger` 的候选创建和晋升流程。该项需要带有可读历史会话的 Harness profile 或专门的 Host fixture。

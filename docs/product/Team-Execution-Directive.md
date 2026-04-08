# OpenShock Team Execution Directive

**版本:** 1.1
**更新日期:** 2026 年 4 月 8 日
**关联文档:** [Execution Tickets](./Execution-Tickets.md) · [Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、唯一真值

- 产品范围只认 `PRD -> Checklist -> Execution Tickets -> Test Cases`。
- 实时状态以 live board 为准。
- 如果 board、口头同步、文档冲突，以文档链和代码真值为准，不以口头为准。

---

## 二、团队执行规则

1. 每次只 claim 一张 ticket。
2. 一个分支只做一张 ticket 的 write scope。
3. 不允许把未验证能力写成“已完成”。
4. 任何改动必须同时更新：
   - 相关文档
   - 相关测试
   - 相关票据状态
5. reviewer 先看 blocker，再看风格；没有 blocker 就尽快合。

### 前端守则

- 聊天、Room、Inbox 永远比 Board 更重要；Board 只做 planning mirror。
- 不新增“Rooms 总览”式独立心智；默认从 channel / issue / inbox 进入具体 room。
- Thread 只作为某条消息的回复子区，不升级成新的首页级对象。
- composer 必须常驻可见；历史消息必须能稳定回滚，不允许输入框把消息区顶没。
- 壳层继续向 `app.slock.ai` 学结构和密度，但保留 OpenShock 现有字体与更克制的审美，不做生硬复制。
- 前端票不接受“为了展示而展示”的大卡片、大标题、大段空白；默认先压密度，再谈装饰。

### Agent / Onboarding / Governance 守则

- Agent profile 最小字段必须包括：`role`、`avatar`、`prompt`、`provider/model preference`、`memory binding`、`machine affinity`。
- Machine profile 最小字段必须包括：`hostname`、`OS`、`shell`、已发现 CLI/provider/model inventory、pairing 状态。
- onboarding 至少提供 `开发团队`、`研究团队`、`空白自定义` 三种模板，且必须可恢复继续。
- 多 Agent 正式交接必须走 `Agent Mailbox / handoff ledger`，不能只藏在 prompt 或口头约定里。
- 任何配置票都必须落到后端 durable truth，不接受只改前端 local state 的“假配置面”。

### 下一批默认批次

1. `TKT-21` `TKT-24`
2. `TKT-22` `TKT-23`
3. `TKT-25`
4. `TKT-32` `TKT-33` `TKT-37`
5. `TKT-34`
6. `TKT-35` `TKT-36`
7. `TKT-26`
8. `TKT-28` `TKT-29` `TKT-30` `TKT-31`

---

## 三、每张票的提交内容必须包含

- `Goal`
- `Scope`
- `Changed Files`
- `Self-Check`
- `Test Cases`
- `Risks`
- `Docs Updated`
- `Persistence / Recovery Proof`（只要票里碰了配置、profile、onboarding、mailbox）

---

## 四、自测最低要求

- 后端票至少跑相关 `go test`
- 前端票至少跑 typecheck / build
- 涉及主链的票至少跑 `pnpm verify:release`
- 涉及浏览器流程的票必须补 headed evidence，不能用默认 headless 冒充
- 涉及配置持久化的票必须补 reload / restart proof
- 涉及多 Agent 协作的票必须补 handoff / ack / override 证据

---

## 五、提测与合并门

- PR 描述必须列出对应 `TKT-*` 和 `TC-*`
- 没有测试证据的，不进 review
- 文档和代码口径冲突的，不合并
- 合并后主分支必须保持 clean

---

## 六、每日同步格式

- `Today`
- `Blocked`
- `Next`
- `Ticket`
- `Needed Review`

示例：

- Today: 完成 `TKT-01` pairing reconcile 的 server patch 和 regression tests
- Blocked: `ops:smoke` 还没补 URL truth check
- Next: 接 `TKT-02`
- Ticket: `TKT-01`
- Needed Review: backend + setup flow

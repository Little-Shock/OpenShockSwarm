# OpenShock To Do List

**版本:** 1.3
**更新日期:** 2026 年 4 月 11 日
**关联文档:** [PRD](./PRD.md) · [Product Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、这份文档现在只做什么

- 只维护当前最需要推进的 GAP、优先级和推荐顺序
- 不再把“完整产品范围”和“当前已完成实现”混在一起
- 不再把“contract 已落地”和“浏览器级 / 线上级闭环已验证”混写

如果 live board 和文档冲突：

- 实时状态以 live board 为准
- 需求边界以 `PRD + Checklist` 为准
- 测试结论以 `Test Report` 为准

---

## 二、当前已经站住的基线

- 统一 workspace shell 已站住:
  - `chat / inbox / board / setup / issues / runs / agents / memory / access / settings` 已共享同一套壳体
  - `Chat / Work` 顶部切换、同源 `/api/control/*` proxy、work surface 去白缝与密度收紧已完成当天有头走查
- 消息工作面已站住:
  - real quick search、DM / followed / saved、room workbench、topic route、mobile inbox triage 都已有 headed evidence
- profile / onboarding / mailbox 已站住:
  - Agent profile editor、machine capability binding、scenario onboarding、Agent Mailbox、多 Agent governance、config persistence 都已有当前主线验证
- Setup 主链、runtime pairing 冷启动一致性、release smoke gate 已站住
- 真实远端 PR browser loop、signed webhook replay 已站住
- login / session / invite / member role / action-level authz matrix 已站住
- approval center、notification delivery、memory governance、memory correction / cleanup、credential profile、stop/resume/follow-thread 已站住
- multi-runtime scheduler / active lease / offline failover 已站住

这些能力的详细验收见 [Product Checklist](./Checklist.md) 和 [Testing Index](../testing/README.md)。

---

## 三、本轮已收口 / 当前必须先收的 GAP

### 2026-04-10 已收口

- `GAP-24 / TKT-61`
  - routing policy、escalation SLA、notification policy、response aggregation audit 已落到同一份 workspace governance truth，并有 Windows Chrome 有头证据。
- `GAP-28 / TKT-58`
  - 版本化 `/v1/control-plane/commands`、`/events`、`/debug/commands/:id`、`/debug/rejections` contract 已站住，并覆盖 idempotency / stable error family / browser readback。
- `GAP-29 / TKT-59`
  - live truth hygiene、dirty projection fail-closed 与 `verify:web` regression gate 已形成 no-shadow-truth 主线约束。
- `GAP-30 / TKT-60`
  - `/v1/runtime/publish`、cursor dedupe、replay evidence packet、run detail replay panel 已形成可回放 contract。

### 2026-04-11 已收口

- `GAP-21 / TKT-39`
  - review comment / review thread / changes requested 现在会稳定回写到 PR conversation ledger，并且 Inbox、Room PR tab、PR Detail 已统一深链到同一条 review 上下文。
- `GAP-22 / TKT-41`
  - run / room / workspace 三层 usage、quota、retention 与 warning 已进入正式产品面，并已有 Windows Chrome 有头证据，不再只停在 smoke / logs / setup 边栏。
- `GAP-23 / TKT-44`
  - invite / verify / reset / blocked recovery 已通过 Windows Chrome 有头链路收成同一条 identity template journey；`/settings` identity template chain 与 `/access` recovery flow 已走同一份 delivery truth。
- `GAP-25 / TKT-46`
  - restricted sandbox 已通过 Windows Chrome 有头链路收成正式产品面；`run-level profile -> approval_required -> same-target override/retry -> reload persistence` 已有当前轮证据。
- `GAP-26 / TKT-48`
  - workspace plan / usage / retention 已通过 Windows Chrome 有头链路收成正式产品面；`/rooms -> /runs -> /settings` 的 plan、quota、warning 与 retention 已共享同一份 live truth。
- `GAP-27 / TKT-49`
  - PR delivery entry 已通过 Windows Chrome 有头链路收成单一判断入口；release gate、operator handoff note、delivery template 和 evidence bundle 已同页可复核。
- `GAP-31 / TKT-62`
  - configurable team topology 现在已通过 Windows Chrome 有头链路收成正式产品面；`/settings -> /setup -> /mailbox -> /agents` 会共享同一份 durable lane / role / default-agent truth，并覆盖 reload / restart recovery。
- `GAP-32 / TKT-63`
  - mailbox 现在已补 source / target 双边 formal comment；`request -> source comment -> blocked -> target comment -> ack -> complete` 已有 Windows Chrome 有头链路，且 comment 不会冲掉 blocked tone 或 lifecycle note。
- `GAP-33 / TKT-64`
  - governed next-handoff 默认治理现在已站住；`/mailbox` 与 Inbox compose 会按当前 room truth 和 team topology 自动建议下一棒，并在缺少 QA target 时显式 blocked，而不是随机回退。
- `GAP-34 / TKT-65`
  - governed route 现在已补一键起单；`/mailbox` 与 Inbox compose 都可以直接 `Create Handoff`，并在创建后同步切到 `active`，完成后一起回放到 blocked QA fallback。

### 当前必须先收的 GAP

当前需要优先收的已不再是“能不能配 topology”“能不能正式对话”“能不能给下一棒默认路由”或“能不能一键起单”，而是 topology 之后的自动推进/自动收口策略、agent-to-agent orchestration 和更重的跨 Agent delivery delegation。

---

## 四、推荐推进顺序

1. 先围 `CHK-16` 的 shell density / high-frequency interaction polish 开票。
2. 再围 `CHK-21` 的 auto-advance / auto-closeout、automation policy 与 delivery delegation 开票。
3. 最后继续补 `CHK-10` `CHK-22` 的长期记忆整理、外部 provider 编排与 durable governance。

---

## 五、这轮知识回收带来的新增要求

- 以后再看历史平行分支，默认顺序是:
  - `eng01/pr1-head-regression-fix`
  - `feat/initial-implementation`
  - `eng01/batch6-83`
  - `feat/tff`
- 允许吸收的是:
  - `/v1` contract、debug / replay read-model、runtime publish cursor、staged backlog 拆法、局部组件拆分
- 不允许吸收的是:
  - 旧 JS `apps/server / apps/shell` 主体代码
  - `tff` 的 dashboard 气质
  - 提前把 hosted billing / subscription 拖回当前主线

---

## 六、每张执行票最少要写清什么

- `Goal`
- `Scope`
- `Dependencies`
- `Self-Check`
- `Review Gate`
- `Merge Gate`
- `Related Checklist IDs`
- `Related Test Case IDs`

没有这 8 项，不进入 active execution。

---

## 七、每一轮固定 Loop

每一轮开发固定按这个顺序：

1. PI / 架构锁 active batch
2. owner claim 并实现
3. owner 自测并贴证据
4. reviewer 只报 blocker / no-blocker
5. blocker 按最小范围回补
6. reviewer 重核
7. `in_review -> done`
8. round-end verify / push / board 清绿
9. 立刻起下一轮 planning 票

不允许停在：

- 只有口头同步，没有仓库文档
- 只有实现，没有 reviewer 证据
- 只有 reviewer PASS，没有板面收口
- 当前 batch 刚结束，下一轮却没人开票

---

## 八、维护规则

- 每一轮收口后，先更新这份文档，再开下一轮 planning 票
- 如果 live board 已经收掉某条 face，对应条目要同步从“下一步”挪到“已完成”
- 如果 backlog 方向变了，必须先更新这里，再去频道口头宣布

这份文档的目标不是写愿景，而是让大家下一次开票时不需要重新争论：

- 现在已经做完了什么
- 还剩哪些 face
- 下一张票该怎么开

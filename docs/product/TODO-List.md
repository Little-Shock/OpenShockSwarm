# OpenShock To Do List

**版本:** 1.9
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
- `GAP-35 / TKT-66`
  - governed route 现在已补 `Complete + Auto-Advance`；reviewer handoff 完成后，如果下一条 lane 已映射默认 Agent，就会自动创建 followup handoff，并让 `/mailbox` 与 Inbox compose 一起切到新的 `active` ledger。
- `GAP-36 / TKT-67`
  - final lane closeout 现在已显式接回 PR delivery entry；`/mailbox` 与 Inbox compose 在 `done` 时都会给出 closeout 回链，PR detail 的 handoff note / evidence 也会直接带上最新 governed closeout note。
- `GAP-37 / TKT-68`
  - final lane closeout 现在还会显式派生 delivery delegate；PR detail 已出现 `Delivery Delegation` card，且 related inbox 会写入 deterministic delegation signal，默认 dev-team 会回到 `PM / Spec Captain`。
- `GAP-38 / TKT-69`
  - final lane closeout 现在还会自动创建 delegated closeout handoff；PR detail delegation card 已能显示 `handoff requested` 并一跳回到 Mailbox / Inbox 的对应 ledger。
- `GAP-39 / TKT-70`
  - delegated closeout handoff 现在还会把 `blocked -> completed` lifecycle 同步回 PR detail delegation card 和 deterministic related inbox signal，且不会把 governed closeout done-state 冲回 active。
- `GAP-40 / TKT-71`
  - workspace governance 现在已支持 `formal-handoff / signal-only` delivery delegation automation policy；`signal-only` 下仍会派 PR delegation signal，但不会自动创建 delegated closeout handoff，且 `/settings` / PR detail / Mailbox 会读同一份 durable truth。
- `GAP-41 / TKT-72`
  - workspace governance 现在还支持 `auto-complete` delivery delegation automation policy；final lane closeout 后 PR detail / related inbox 会直接写成 `delegation done`，而不是额外再起 delegated closeout handoff，且 `/settings` / Mailbox 继续读同一份 durable truth。
- `GAP-42 / TKT-73`
  - delegated closeout handoff 上的 source / target formal comment 现在也会同步回 PR detail `Delivery Delegation` summary 与 related inbox signal；多 Agent closeout 沟通不再只留在 Mailbox 局部 ledger。
- `GAP-43 / TKT-74`
  - delegated closeout handoff 在 target `blocked` 后，现在还会自动创建一条 `delivery-reply` response handoff 回给 source；PR detail delegation card 会同步显示 `reply requested / reply completed` 与 deep link，且 response 完成后主 closeout handoff 仍保持 blocked，直到 target 重新 acknowledge。
- `GAP-44 / TKT-75`
  - delegated closeout 第二轮及后续 retry 现在也会被收成正式 truth；PR detail delegation card 会显式显示 `reply xN` attempt 计数，并始终 deep-link 到最新一轮 response handoff，而不会继续复用旧 ledger。
- `GAP-45 / TKT-76`
  - `delivery-reply` response handoff 上的 source / target formal comment 现在也会同步回 PR detail `Delivery Delegation` summary 与 related inbox signal；comment sync 过程中 response lifecycle 继续保持 `reply requested`，不会被 comment 偷改。
- `GAP-46 / TKT-77`
  - `delivery-reply` 的 response progress 现在还会回推父级 delegated closeout handoff、其 handoff inbox signal 与 run/session next action；target 在 Mailbox / Inbox 也能直接看到“source 已回复，轮到你 re-ack”的 resume signal。
- `GAP-47 / TKT-78`
  - Mailbox 现在也会直接显示 delegated closeout parent/child orchestration；父级 closeout card 会出现 `reply requested / reply completed` 与 `reply xN`，child `delivery-reply` card 则可一跳回 parent closeout。
- `GAP-48 / TKT-79`
  - child `delivery-reply` 完成后，Mailbox 现在还可以直接 `Resume Parent Closeout`；blocker agent 可从 child ledger 一键把父级 delegated closeout 重新接住，而不是手动回找 parent card。
- `GAP-49 / TKT-80`
  - parent delegated closeout 被重新接住乃至最终收口后，PR detail `Delivery Delegation` summary 与 related inbox signal 现在也会继续保留 `reply xN / 第 N 轮 unblock response` 历史，不会只在 Mailbox parent card 里看得到。
- `GAP-50 / TKT-81`
  - child `delivery-reply` card 现在也会直接显示 parent 当前是 `blocked / acknowledged / completed`，source agent 不必离开 child ledger，也能知道主 closeout 后续到底有没有被接住并最终收口。
- `GAP-51 / TKT-82`
  - parent delegated closeout 重新 `acknowledged` / `completed` 后，parent handoff 自己的 Mailbox card、handoff inbox signal 与 run/session context 现在也会继续保留 `reply xN / 第 N 轮 unblock response` 历史，不会在 parent surface 被通用 resume/done 文案洗掉。
- `GAP-52 / TKT-83`
  - parent delegated closeout 重新 `acknowledged` / `completed` 后，child `delivery-reply` 自己的 `lastAction` 与 child inbox summary 现在也会同步前滚到 parent acknowledged / completed；source agent 不会再看到 chip 已更新但正文仍过期的分裂真相。
- `GAP-53 / TKT-84`
  - parent delegated closeout 重新 `acknowledged` / `completed` 后，child `delivery-reply` 的 lifecycle messages 现在也会显式追加 `parent-progress` 事件；同时 PR detail `Delivery Delegation` summary 会继续保留最新 formal comment，不会被这些后续 lifecycle 写回洗掉。
- `GAP-54 / TKT-85`
  - child `delivery-reply` 的 formal comment / response complete 现在也会显式写进 parent delegated closeout 自己的 lifecycle messages，成为 `response-progress` timeline；target 深看 parent ledger 时，不再只剩一条不断被覆盖的 `lastAction`。
- `GAP-55 / TKT-86`
  - child `delivery-reply` 对 parent delegated closeout 的关键 progress 现在也会显式写进 Room 主消息流，作为 `[Mailbox Sync]` orchestration 叙事；房间里不再只靠 Mailbox / PR / Inbox 才知道 parent closeout 已收到这轮 unblock response。

### 当前必须先收的 GAP

当前需要优先收的已不再是“能不能配 topology”“能不能正式对话”“能不能给下一棒默认路由”“能不能一键起单”“能不能自动续下一棒”“能不能把 final lane 接回 delivery entry”“能不能显式给出 delivery delegate”“能不能自动创建 delegated closeout handoff”“能不能把 delegated lifecycle / latest comment 回写到 PR contract”“能不能把 delivery delegation policy 做成正式配置 / auto-complete 策略”“能不能把 blocked delegated closeout 物化成 response handoff”“能不能把第二轮 retry attempt 显式收成产品真相”“能不能把 response handoff formal comment 回写到统一 delivery contract”“能不能把 response progress 回推父级 delegated handoff / inbox / next action”“能不能把 parent/child response orchestration 直接做进 mailbox shell”“能不能从 child ledger 直接恢复 parent closeout”“能不能把 parent 恢复后的 reply 历史继续留在统一 delivery contract”“能不能让 child ledger 直接看见 parent 最终有没有被接住”“能不能把 parent 自己的 mailbox/run context 也保住 response history”“能不能让 child ledger 的正文与 child inbox signal 一起跟上 parent 真相”“能不能让 child ledger 时间线和 latest formal comment 也跟上 parent follow-through”“能不能让 parent 自己的 timeline 也完整回放 child response 轨迹”或“能不能把这些关键 child response sync 也写进 Room 主消息流”，而是更深的 agent-to-agent communication 与跨 Agent closeout 编排。

---

## 四、推荐推进顺序

1. 先围 `CHK-16` 的 shell density / high-frequency interaction polish 开票。
2. 再围 `CHK-21` 的更深 agent-to-agent communication、delegate execution 与跨 Agent closeout orchestration 开票。
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

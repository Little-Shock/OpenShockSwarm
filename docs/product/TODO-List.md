# OpenShock To Do List

**版本:** 1.28
**更新日期:** 2026 年 4 月 18 日
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
- `GAP-56 / TKT-87`
  - child `delivery-reply` 如果自己再次 `blocked`，Room 主消息流现在也会显式追加 `[Mailbox Sync]` 阻塞叙事；房间里可以直接看到 unblock 链本身又被卡住，不再只剩乐观的 comment / completion sync。
- `GAP-57 / TKT-88`
  - shell footer 现在新增固定 `Profile Hub`；当前 `Human / Machine / Agent` 会作为 app.slock.ai 式壳层入口常驻，并一跳进入统一 profile surface，不再要求用户绕到右栏 summary 或独立列表页。
- `GAP-58 / TKT-89`
  - PR detail 现在新增统一 `Delivery Collaboration Thread`；parent `delivery-closeout` 与 child `delivery-reply` 的 request / blocker / formal comment / response progress / parent-progress 会按真实时间顺序同屏回放，并能直接 deep-link 回对应 Mailbox handoff。
- `GAP-59 / TKT-90`
  - PR detail 现在还把当前 delivery thread 升级成正式 action surface；parent delegated closeout 与 child `delivery-reply` 可同页直接 `blocked / comment / acknowledged / completed`，child 完成后还能直接 `Resume Parent Closeout`。
- `GAP-60 / TKT-91`
  - `/mailbox` 现在已补当前 room ledger 的 multi-select `Batch Queue`；open handoff 可统一 `acknowledged / comment / completed`，selection 会在 closeout 后自动清空，closeout note 与 inbox summary 继续沿正式 handoff truth 前滚。
- `GAP-61 / TKT-92`
  - workspace governance 的 escalation 现在已补正式 queue truth；active handoff 与 blocked inbox signal 会带着 `label / source / owner / next-step / deep-link` 同时进入 `/mailbox` 与 `/agents`，handoff closeout 后 queue 也会自动清空。
- `GAP-62 / TKT-93`
  - governance escalation 现在还补了跨 room rollup；整个 workspace 里仍在冒烟的 room 会带着 `room / status / count / latest escalation / deep-link` 同时进入 `/mailbox` 与 `/agents`，closeout 后会回退到 baseline hot-room 视角。
- `GAP-63 / TKT-94`
  - batch queue 现在还补了 governed batch policy；`Create Governed Handoff` 会保留 `kind=governed`，pure governed selection 可直接 `Batch Complete + Auto-Advance`，并把 next-lane followup 收成同一条正式治理链。
- `GAP-64 / TKT-95`
  - cross-room governance 现在还补了 room-level orchestration metadata 与正式 create action；hot room rollup 会显式显示 `current owner / current lane / next governed route`，并允许在 `/mailbox` 上对 `ready` room 直接 `Create Governed Handoff`，同时把 `/agents` 镜像到同一条 active route truth。
- `GAP-65 / TKT-96`
  - memory center 现在还补了正式 provider orchestration；`workspace-file / search-sidecar / external-persistent` 的 `enabled / scope / retention / degraded fallback` 会写回 durable truth，并直接进入 `/memory` 和 next-run preview。
- `GAP-66 / TKT-97`
  - memory center 现在还补了正式 provider health / recovery；`workspace-file / search-sidecar / external-persistent` 的 `health summary / next action / failure count / activity timeline / recovery result` 会写回 durable truth，并在 `/memory` 与 preview prompt summary 同步投影。
- `GAP-70 / TKT-101`
  - Phase 0 shell 前端减法已收二十五刀；shared `RunControlSurface` 已压短，`/topics/:topicId` 的重复继续入口卡已删掉，room `context` tab 也已压成“当前焦点 + 待处理”，右侧 `RoomWorkbenchRailSummary` 把 `overview / delivery / system` 的重复双卡收回单卡表达，并补回房间内 agent / machine profile 深链锚点；`/mailbox` 的 cross-room governance rollup 与 `/agents` 的 orchestration governance rollup 现在都把 `current owner / current lane / next-route` 解释收回 `GovernanceEscalationGraph` 主视图，列表卡只保留 room 热点、双状态与主推进动作，`/mailbox` 升级队列单卡里重复的 `nextStep` 和泛化 `打开详情` 入口也已收掉，改为只保留 label / chips / status / summary，不再把 handoff ledger 和 Inbox 已持有的导航与下一步说明再堆一层；room PR sheet 上重复的 inbox / mailbox 导航也已一起减掉，卡头 `收件箱 / 交接箱` 快捷入口、`RoomRelatedSignalsPanel` 卡内逐条 `收件箱详情 / 回到讨论间` 按钮、PR panel 里的泛化 `收件箱评审 / 话题上下文` CTA、PR tab 下 delivery rail 里的自引用 `房间 PR` 入口，以及 Inbox / Mailbox 合并面里 focused handoff card 上自引用 `打开收件箱` CTA 都已删掉；PR 面只保留 `PR 详情 / 打开远端 PR` 这类 PR 专属导航，focused handoff 卡只保留非自引用的讨论 / 运行 / 事项 / 主交接 / 回复等深链；重复的 `latestSummary`、次级 `查看该讨论` 入口以及 `/agents` 升级时限卡里的 `下一次升级` helper copy 也都已删掉；`/inbox` 上 governed handoff compose 也已改成“自动建议优先、手动表单次级展开”，approval-center 桌面信号卡右侧重复的 `打开详情` 入口也已删除，改为只保留 `Room / Run / PR / PR Detail` 这些主导航，不再把同一张卡上的次级 deep-link 再堆一层；approval-center 移动端 active signal 上泛化 `打开详情` CTA 也已继续收掉，移动端现在统一通过 `更多信息` 折叠暴露真实 `Room / Run / PR / PR Detail` 目的地，不再单独堆一层 generic jump；`/rooms/:roomId?tab=pr` 的 `RoomRelatedSignalsPanel` 尾部泛化 `打开收件箱` 入口也已一并收掉，PR 面板里这块现在只保留 signal summary，不再在信息区重复堆一层 generic self-link；`/mailbox` focused handoff detail card 上泛化 `打开收件箱` CTA 也已继续收掉，focused card 现在只保留 room / parent / response 这些具体 lineage 导航与推进动作，不再把 inbox 当成抽象中转层；`/rooms/:roomId?tab=context` 的 pending panel 上泛化 `打开交接箱` CTA 也已继续收掉，当当前 room 没有待跟进交接时，这块现在只明确写出空态，不再把 mailbox 当成抽象兜底跳转；同一 context panel 上桌面端泛化 `打开收件箱` CTA 现在也已收掉，桌面 inbox 主入口交回 shell sidebar，移动端仍保留 `room-workbench-open-inbox` 作为 sidebar 隐藏后的局部逃生路径；PR detail 右栏 `相关收件箱提醒` 卡上的泛化 `打开详情` 现在也已收掉，页头 `返回收件箱` 继续持有正式 navigation，related inbox 卡只保留当前 signal summary 和 kind，不再把信息卡伪装成第二个 action strip；standalone topic route overview 上泛化 `回到讨论间` CTA 现在也已收掉，room return path 统一交回 `打开讨论页话题` 这条具体 backlink，topic overview 只保留 topic summary、run/deep-link 和 issue context，不再把同一条 room return path 再堆成第二条返回导航；`/mailbox` 的人工确认卡上泛化 `打开处理入口` 动作现在也已收掉，blocked / required 的治理导航继续由 escalation queue、Inbox 和 handoff ledger 持有，不再在右栏重复堆一层 generic CTA；`/agents` 的 `responseAggregation` 里重复的 `决策路径 / 接管记录` 尾巴和独立 `协作规则` 卡组也已删除，walkthrough 也已进一步压回“步骤标题 + 当前摘要 + 状态”，人工接管卡上的泛化 `打开接管链路` 动作也已收掉，避免在人类已能从 escalation queue / Inbox 进入处理链路时再堆一层重复入口；approval center recent ledger 里泛化 `打开上下文` CTA 也已一并收掉，recent card 现在只保留状态、房间、时间和摘要，避免把历史区伪装成第二个 action queue。下一步优先继续压 room / mailbox / inbox / topic route 内仍重复的次级 deep-link、owner/status/action truth，让 chat-first 路径更顺、更轻、更舒服，而不是继续加一层层次级面板。

### 2026-04-16 已收口

- `GAP-67 / TKT-98`
  - daemon session workspace envelope 已正式落地；同一 `sessionId` 会稳定复用同一目录，并写出 `MEMORY.md / SESSION.json / CURRENT_TURN.md / notes/work-log.md` 作为 turn continuity 本地锚点。
- `GAP-68 / TKT-99`
  - Codex resume continuity 已收成 local-first truth；session-scoped `OPENSHOCK_CODEX_HOME` 会跟同一份 session workspace 一起复用，daemon restart 后的 `resume --last` 不再继续吃全局共享状态。
- `GAP-69 / TKT-100`
  - daemon real-process continuity system harness 已站住；built binary + real daemon subprocess + httptest control plane + fake Codex CLI 现在能一起证明 same-session restart recovery、`CURRENT_TURN.md` 刷新、`notes/work-log.md` 累积、稳定 `codexHome` 与 `appServerThreadId` reinjection。
- `GAP-71 / TKT-102`
  - 显式 provider thread state 的本地持久化 contract 已站住；执行进程现在可通过 daemon 提供的 thread-state file 写回 `SESSION.json.appServerThreadId`，后续 resume 会把这个值重新注入进程环境，形成可验证的本地恢复锚点。

### 当前必须先收的 GAP

当前需要优先收的已不再是“能不能配 topology”“能不能正式对话”“能不能给下一棒默认路由”“能不能一键起单”“能不能自动续下一棒”“能不能把 final lane 接回 delivery entry”“能不能显式给出 delivery delegate”“能不能自动创建 delegated closeout handoff”“能不能把 delegated lifecycle / latest comment 回写到 PR contract”“能不能把 delivery delegation policy 做成正式配置 / auto-complete 策略”“能不能把 blocked delegated closeout 物化成 response handoff”“能不能把第二轮 retry attempt 显式收成产品真相”“能不能把 response handoff formal comment 回写到统一 delivery contract”“能不能把 response progress 回推父级 delegated handoff / inbox / next action”“能不能把 parent/child response orchestration 直接做进 mailbox shell”“能不能从 child ledger 直接恢复 parent closeout”“能不能把 parent 恢复后的 reply 历史继续留在统一 delivery contract”“能不能让 child ledger 直接看见 parent 最终有没有被接住”“能不能把 parent 自己的 mailbox/run context 也保住 response history”“能不能让 child ledger 的正文与 child inbox signal 一起跟上 parent 真相”“能不能让 child ledger 时间线和 latest formal comment 也跟上 parent follow-through”“能不能让 parent 自己的 timeline 也完整回放 child response 轨迹”“能不能把这些关键 child response sync 也写进 Room 主消息流”“能不能把 parent / child formal communication 拉平成 PR detail 上可回放的统一 thread”“能不能直接在 PR detail 内执行当前 delegated closeout / reply action”“能不能把 escalation 从 aggregate SLA 计数落成正式 queue truth”“能不能把 workspace 级 hot room 收成跨 room rollup”“能不能让 hot room 直接起 governed next handoff”，而是前端减法、更重的长期记忆整理、外部 provider 编排、durable governance，以及下一层的 multi-room dependency graph / auto-closeout；同时要继续把刚站住的 daemon continuity harness 扩成更重的 multi-session / multi-agent recovery 矩阵。

---

## 四、推荐推进顺序

1. 先收 `TKT-101`：持续做 room / inbox / run / governance 的 subtractive polish，但不再靠加新面板解决流畅度问题。
2. 然后回到 `CHK-10` 的更重 memory compaction / retention / durable adapter。
3. 后续所有多智能体 continuity / recovery 票默认接 `TKT-100` 这套 real-process harness，不再回退到手搓零散 fixture。

---

## 五、这轮知识回收带来的新增要求

- 以后再看历史平行分支，默认顺序是:
  - `eng01/pr1-head-regression-fix`
  - `feat/initial-implementation`
  - `eng01/batch6-83`
  - `feat/tff`
- 允许吸收的是:
  - `/v1` contract、debug / replay read-model、runtime publish cursor、staged backlog 拆法、局部组件拆分
  - daemon-managed persistent session workspace
  - `CURRENT_TURN.md / SESSION.json / notes/work-log.md` per-session envelope
  - local-first provider thread persistence 与 restart recovery
  - real daemon-process continuity harness + restart recovery pattern
  - 前端 mention/feed/read-receipt 里“减法优先”的交互收口思路
- 不允许吸收的是:
  - 旧 JS `apps/server / apps/shell` 主体代码
  - `tff` 的 dashboard 气质
  - 提前把 hosted billing / subscription 拖回当前主线

### 还要继续吸收进 TODO 的具体项

- 用 `TKT-100` harness 固定补四类 scenario seed：same-session restart、multi-agent handoff resume、runtime publish retry、memory provider degraded fallback，并让 reviewer packet / release gate 复用同一份 evidence 模板，不让恢复链重新退回函数级单测。
- 把 recovery fixture 继续收敛成可复用的 scenario seed / evidence pattern，并补 daemon `publish cursor` 的 durable truth、fixture-seed -> smoke -> shell-ready integrated readiness gate，后续 daemon 与 governance 恢复票不再各自手搓假数据。
- 补一张 `/v1 compatibility sunset / adapter freeze gate` 票，给兼容 alias 标明 retirement 条件、禁止新增 noun，并把 freeze rule 做成 release gate 自动拦截。
- 把 control-plane debug read-model 扩成带 cursor、actor/resource filter 和 correlation id 的历史视图，让外部 consumer 能直接回放一段治理链，而不是只看单条 command 和 rejection list。
- 按 `tff` 的局部组件拆法继续重构 shell，但只吸收拆法和降复杂度思路，不吸收它的 dashboard 视觉与 IA；chat 高频原语优先拆成独立的 mention / feed / read-state / auto-scroll 模块，再反向收 room/channel 那几个超大组件。
- 继续按局部组件拆法收 room / inbox / governance rail，把重复双卡压回单卡表达，同时保住 profile、inbox、mailbox 这些高频深链锚点。
- 前端继续吸收 `tff` 在信息区“一个主动作或零动作”的减法纪律；历史卡、recent ledger、已在当前上下文里的 self-link 默认不再额外渲染泛化 CTA，只保留真正改变用户位置或状态的主导航。
- 把 session workspace 从最小 envelope 前滚到 `SOUL.md + MEMORY.md + notes/channels.md + notes/operating-rules.md + notes/skills.md + notes/rooms/<room>.md` 的可恢复规则栈，并在 resume 时显式挂回当前 room context，让多智能体协作不只靠聊天历史恢复。
- 前端所有高频路径继续执行“减法优先”，优先删除重复状态、重复动作和解释性噪音，而不是再加 summary 卡和二级面板。

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

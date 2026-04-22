# OpenShock To Do List

**版本:** 1.64
**更新日期:** 2026 年 4 月 22 日
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

## 三、当前一屏视图

如果你今天只想知道“下一步先做什么”，先看这 3 条：

1. 把首页和主壳继续收成真正产品入口。
   重点是 `/`、`shell`、`rooms`：先回答“我现在能做什么”，再展示统计和支撑信息。
2. 把 supporting flow 继续做减法。
   重点是 `/setup`、`/mailbox`、`/settings`：默认只保留下一步，诊断、治理、调度、配额都后移。
3. 把 release gate 从“能连通”推进到“能证明主链可用”。
   重点是 `state stream / experience metrics / runtime drift`，后续再补 `run control` 和 GitHub hard gate。

---

## 四、本轮已收口 / 当前必须先收的 GAP

下面按日期保留的是最近收口归档，方便追溯；它们不是“今天优先做什么”的主视图。

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
  - Phase 0 shell 前端减法已收九十三刀；room/context/pr/mailbox/governance 里的重复 self-link、generic CTA、双卡解释和旧 fallback 已大幅收回 contract-level 目标名，PR/detail/topic/run/settings/setup 这些 supporting flow 现在优先暴露 `执行详情 / 事项详情 / 话题详情 / 交付详情 / 交接详情 / 通知设置 / 账号中心 / 远端 PR / GitHub 安装页` 这类真实目标，而不是继续堆空泛按钮。
  - 后端可用性这轮也继续前滚到 action semantics：delivery gate、governance route、delivery evidence、delegation/lineage deep-link 都已补 contract-level `hrefLabel` 并由 live truth hygiene 给旧 snapshot 自动回填，前端不再靠局部猜测决定动作名；当前页自链接也已继续从 PR detail evidence、多个 summary strip 和 governance rollup room action 里收掉。
  - channel thread supporting flow 里的回访 rail 也已继续收口：列表卡上的 `打开原视图` 和 desktop 详情 rail 里的 `打开列表` 都已删掉，当前队列上下文只保留 `重新打开线程` 这一条真正改变位置的主动作，不再靠残留 `surfaceHref` 维持重复自链接。
  - governance rollup / graph 的 room-side action 现在也不会再退回 `查看上下文`；即使旧 snapshot 没带 `hrefLabel / nextRouteHrefLabel`，sanitize 后的前端也会直接看到 `查看当前交接 / 查看交接箱 / 执行详情 / 交付详情` 这类真实目标名，不再靠图组件局部猜一个抽象入口。
  - governed route closeout 的 action label 也已继续收回 contract；`WorkspaceGovernanceSuggestedHandoff.hrefLabel`、server hygiene 和 web sanitizer 会一起把 active / done 路径补成 `查看当前交接 / 交付详情 / 查看交接箱`，`/mailbox` 与 compose surface 不再各自维护一份 `governedCloseoutLabel` helper。
  - governance next-route 的未知目标现在 fail-closed，不再把 opaque href 渲染成 `查看下一棒 / 查看收口详情`；graph、mailbox rollup 和 orchestration rollup 只在目标名可明确映射到真实页面时保留 deep-link。
  - PR delivery gate / evidence 的未知目标现在也 fail-closed，不再渲染 `关联详情`；delivery detail 只在 href 能明确映射到真实页面时才保留链接，不再把 opaque route 伪装成辅助动作。
  - `watch` 状态文案这轮也已继续从动作态压回状态态；`/chat`、`/setup`、`/settings` 和首页运行概览里的 `进入观察` 现在统一收成 `观察中`，避免 quota / budget badge 再像一个可点击动作。
  - handoff kind label 这轮也已继续收回 contract；`AgentHandoff.kindLabel` 现在由后端显式产出并由 hygiene / web sanitizer 给旧 snapshot 回填，`delivery-reply` 在 `/mailbox`、`/inbox`、PR detail 上统一显示成更直白的 `补充回复`，不再让三个前端组件和 headed 脚本各自猜 `收尾回复`。
  - supporting flow 里剩余的 section toggle 和 agent detail 次级入口这轮也继续压成目标名；Setup 里的 `查看连接细节 / 查看回流地址 / 查看绑定依据`、Onboarding 的 `查看高级选项` 和 agent detail 的 `查看该智能体交接` 现在统一收成 `连接细节 / 回流地址 / 绑定依据 / 高级选项 / 交接箱`，不再把折叠区标题和过滤后的 mailbox 深链伪装成动作句。
  - detail surface 的描述文案这轮也继续去旁白；`live-detail-views` 里的 `这里查看... / 这里集中查看...` 现在统一压成直接对象描述，避免讨论间总览、智能体总览、执行总览、话题详情和执行详情继续带着解释性开头。
  - PR 交付、Mailbox、Profile、Memory 和通知概览这轮也继续去掉 `在这里... / 这里可以... / 这里会...` 这类旁白式开头；首屏描述现在直接说对象本身，不再让用户先读一层界面说明。
  - 空状态和帮助提示里的剩余 `这里会... / 这里可以...` 也继续收掉；Memory、Settings、Profile 和 PR detail 的等待态/空态现在直接说明结果何时出现或能做什么，不再把容器位置当成用户需要理解的动作。
  - `access / orchestration / sandbox` 这轮也继续去掉剩余的容器式说明；身份恢复、成员偏好、调度队列、运行环境压力、治理指标和执行权限面板不再写 `在这里... / 这里会...`，`run-sandbox` 标题也从动作句压成 `这次执行的访问范围`。
  - inbox signal 的链接文案这轮也继续收回目标名；当前生成中的 `/rooms / runs / setup / inbox focus` signal 不再写 `打开房间 / 打开评审 / 打开配置 / 打开 Mailbox / 重新配对 / 解除阻塞 / 查看批准`，统一按 `执行详情 / 进入讨论间 / 设置 / 收件箱定位` 这类真实目标名产出。server hygiene 和 web sanitizer 对空 `action` 也会按 `href` 回填，未知目标则 fail-closed，不再退回 `查看详情`。
  - governance / delivery 的深链文案这轮也继续压成目标名；`/mailbox / inbox / settings / rooms tab` 现在由同一套 helper 统一产出 `当前交接 / 交接箱 / 交接建议 / 待处理升级 / 收件箱定位 / 收件箱 / 设置 / 讨论间执行面 / 讨论间上下文`，PR detail、governance graph、mailbox 和 board compose 不再各自猜一套 fallback。
  - web sanitizer 这轮也补上了空 `hrefLabel` 的显式回填；`sanitizeDisplayText(..., fallback)` 不会自动替空字符串兜底的问题已在 governance suggested handoff 和 cross-room rollup 上修正，旧 snapshot 进入前端后也能直接恢复正式目标名，而不是继续依赖组件局部字符串。
  - detail/profile/settings/mailbox/PR/governance 的剩余容器式说明这轮继续压短；空态和说明不再写“这里会显示 / 在这里处理 / 在这里调整”，而是直接说新交接、事项、说明记录、通知结果、治理链路何时出现或能做什么。
  - 后端 live truth hygiene 的客户可见 fallback 也继续去内部词；issue/room 的脏数据兜底从 `live truth / 执行真相` 改成 `当前状态 / 最新执行状态`，对应 web sanitizer 和 state hygiene contract test 同步更新。
  - memory/setup/github callback/chat room 的页面壳层这轮也继续减法；`/memory`、`/setup`、GitHub 安装回跳、branch-head 对齐和 room workbench 空态不再用“在这里/这里会”解释容器，统一改成资料、诊断、同步状态、PR 评审状态和频道摘要本身。
  - 默认频道和空白工作区 seed 这轮也继续去容器味；`#all / #roadmap` 不再写“都在这里 / 先在这里”，而是直接说轻松聊天、路线讨论和“频道承载轻量讨论，正式工作升级成讨论间”。
  - backend inbox 动作名这轮也继续收回统一 helper；runtime lease 冲突不再硬写 `查看冲突`，而是按 run href 回到 `InboxItemActionLabel`，用户只会看到和其他入口一致的 `执行详情`。
  - issues / onboarding / quick search 的壳层说明也继续压短；`集中查看当前事项 / 打开聊天主界面 / 打开当前结果 / 需要时再打开即可` 已改成 `查看当前事项 / 进入聊天主界面 / 进入当前结果 / 按需展开` 这类更直接的对象名或结果名。
  - 首页跳转和默认私聊文案这轮也继续去产品团队口吻；首页加载提示从“打开正确入口”压成“正在进入工作区”，`dm-mina` 的 summary / purpose / saved-later 文案改成更直接的“文案和稍后查看习惯”，不再写“收口面 / 一等入口需求”这类内部表达。
  - 第七十二刀继续把 supporting flow 里的剩余内部味压回用户语言；GitHub 阻塞、delivery delegation 和账号恢复通知现在统一直接落成 `执行详情 / 交付详情 / 账号中心` 这类真实目标名，治理阻塞摘要、稍后查看说明和跨讨论间阻塞汇总也不再写 `blocked escalation / verify / recovery / planning lane / workspace truth / rooms` 这类内部词。
  - 第七十三刀继续把治理图和规则卡的图例压成用户语言；治理规则不再显示 `Formal Handoff / Review Gate / Test / Verify Gate / Blocked Escalation / Human Override`，统一改成 `交接 / 评审 / 验证 / 阻塞 / 人工接管`，治理图上的 `多房间 / hot room / 当前负责人 / 下一棒 / rooms` 也改成 `讨论间 / 当前处理人 / 下一步 / 个讨论间`，避免主面再读起来像内部控制台。
  - 第七十四刀继续把治理和交接的剩余内部词压回短中文；后端 `workspace governance` 输出给前端的模板、路由、升级、提醒、最终回复和 walkthrough 文案统一改成客户可读口径，前端 `/mailbox`、`/agents` 和旧 Phase 0 fallback 里的 `人工确认 / 当前治理升级队列 / 通知策略 / 回复聚合 / 当前负责人 / Runtime Replay / 泳道 / 人工闸门` 也同步收成 `待拍板 / 待处理升级 / 提醒设置 / 最终回复 / 当前处理人 / 执行回放 / 当前事项 / 待拍板事项`。
  - 第七十五刀继续把 detail / orchestration / supporting flow 的残留控制台味压回短中文；`负责人 / 执行泳道 / 自动合并闸门 / 这里显示...` 这一批已在 `/agents`、detail、旧 Phase 0、board inbox、chat room、branch-head 与 setup 调度说明里收成 `当前处理人 / 执行信息 / 自动合并检查 / 直接对象描述`，后端 store helper 和 API sanitizer 里的 `治理阻塞 / 未命名治理角色 / 未命名治理步骤 / 当前多 Agent 治理摘要` 也同步改成 `待处理升级 / 未命名分工 / 未命名步骤 / 当前协作摘要`，避免旧 snapshot 再把前端刚减掉的词吐回来。
  - 第七十六刀继续把 setup / board / room supporting flow 的容器旁白压成对象名；onboarding、GitHub connection、repo binding、board inbox 和 chat room 里的 `这里... / 交接列表 / 待处理列表 / 交接记录 / 回到这里` 现在统一收成 `这组仓库信息 / 先完成默认连接即可 / 当前仓库有没有接通 / 交接 / 待处理 / 回到任务板` 这类更直接的对象或目标名，不再把容器位置写成界面说明。
  - 第七十七刀继续把 `交接记录` 这类剩余容器标题压成对象名；`live-detail / live-mailbox` 的标题、加载文案和说明现在统一收成 `交接 / 正在获取当前交接 / 交接会同步更新`，跨讨论间阻塞说明里的 `这里把...` 也改成直接描述，不再把列表容器写成界面说明。
  - 第七十八刀继续沿 `slock.ai` 的频道目的和房间工作台减法往前推；`#announcements` 在 web mock 和 server seed 里的 purpose 已统一改成 `只发版本、Runtime 变化和制度公告，不在这里展开讨论`，room thread、频道 fallback 和暂停提示里的 `总览页 / 用途说明 / 控制面板` 也同步压成 `不再额外铺一层总览 / 当前还没有同步频道说明 / 先恢复当前执行` 这类直接说法。
  - 第七十九刀继续把 fallback、默认提示和 seed/mock 里的内部口径压回用户语言；live truth hygiene、web sanitizer、Memory Clerk prompt 和 access / bridge supporting flow 里的 `真值 / Topic / Run / 控制说明 / 可解释真值 / 这里...` 已统一收成 `当前仓库信息 / 待整理话题 / 当前执行摘要 / 当前执行备注 / 记在同一条记录里，方便回看 / 直接确认连接与权限` 这类直接说法，旧 snapshot 和默认数据不会再把前端刚减掉的词回灌回来。
  - 第八十刀继续把 `settings / profile` supporting flow 的容器旁白压成对象描述；凭据范围、沙箱策略、模型建议、工作区额度和设置概览里的 `这里显示 / 这里定义 / 这里管理 / 这里集中...` 已统一改成直接说明当前对象或状态，不再先解释容器位置。
  - 第八十一刀继续把 `setup` 模板样板名和启动包口径压短，并让后端 materialization 同步跟上；开发/研究/空白模板里的 `角色 / 起步智能体 / Owner / Research Lead / Lead Operator / review` 这批样板名现在统一收成 `分工 / 默认智能体 / 所有者 / 方向 / 总控智能体 / 评审` 这类更直接的中文口径，模板卡、已落地启动包和默认空白工作区不会再前后端各说一套。
  - 第八十二刀补上旧 snapshot 防回流；server live hygiene 和 web sanitizer 现在会把 onboarding materialization 里的 `Owner / Member / Viewer / Research Lead / Lead Operator / Review Runner / review 事件` 等历史样板名映射成 `所有者 / 成员 / 访客 / 方向 / 总控智能体 / 评审智能体 / 评审事件`，避免默认包已经改短但旧状态继续把英文和内部词吐回前台。
  - 第八十三刀继续把 Settings 通知页的解释腔压成状态本身；身份通知、默认通知、当前浏览器接收和待发送信号里的 `会实时显示 / 统一显示 / 这里就是实际生效 / 直接显示 / 说明目前...` 已改成 `保持同步 / 共用同一条发送状态 / 使用这组规则 / 成为本地通知 / 目前没有...` 这类更直接的句子。
  - 第八十四刀继续把 `profile / memory` 支持流的界面说明压成对象名；`管理资料来源 / 集中展示... / 会直接显示` 这批标题和描述已收成 `资料来源 / 心跳、命令环境... / 文件栈` 这类直接对象，不再先解释页面在做什么。
  - 第八十五刀继续把 `orchestration / setup` 的调度摘要和空态压短，并把 runtime scheduler 的旧口径一并收掉；`/agents` 与 `/setup` 里的 `当前还没有... / 当前这一列... / 把...放到一个面板里` 已改成更直接的状态或对象描述，server runtime scheduler、web sanitizer 和 mock fallback 也会把 `fallback state / workspace selection / failover / active lease / Runtime 已...` 统一收成 `工作区默认运行环境 / 切到 / 条执行 / 运行环境已...`，旧 snapshot 不会再把英文和控制台词灌回前台。
  - 第八十六刀继续把 `profile / settings / access / memory` 的剩余帮助文案和空态压短；`显示这个智能体... / 当前没有... / 请切换到管理员... / 当前成员还没有... / 把密钥从...收回到... / 邀请成员与角色管理` 这批句子已改成更直接的对象或状态描述，支持流首屏继续向 `slock.ai` 那种“直接说现在是什么、能做什么”收口。
  - 第八十七刀继续把 `access / memory / orchestration / setup` 的剩余空态压短；`最近还没有... / 还没有状态说明 / 还没有检查记录 / 还没有清理记录 / 还没有已注册运行环境 / 成员管理` 这一批已收成 `最近没有... / 暂无... / 还没注册运行环境 / 成员` 这类更短的状态或对象名，supporting flow 继续减少解释成本。
  - 第八十八刀继续把 `GitHub / onboarding` 支持流压短，并同步 seed/mock 默认口径；`当前还没有完成 GitHub 应用配置，请先补充设置 / 当前还没有配置公开回跳地址 / 当前还没有配置公开回调地址 / 可以先跳过，之后再补充 GitHub 配置 / 如果你当前就在目标项目目录中，可以直接读取` 这一批已收成 `GitHub 应用还没配好，先补全设置 / ...还没配置 / 之后再补 GitHub 配置 / 在目标项目目录中就直接读取`，默认数据里的连接说明也同步改短。
  - mobile 房间逃生入口和 Viewer 摘要这轮也继续收口到目标名；`room-workbench-open-inbox` 的文案已压成 `收件箱`，Viewer 角色不再写“查看控制面 / 历史真值”，统一改成“只读控制面和历史记录”。
  - 第九十四刀继续把 `setup / settings / mailbox / run control / shell primitives` 的剩余帮助句和 fallback 压成对象或状态本身；`继续入口 / 继续地址 / 打开 / 当前还没有同步频道说明 / 当前还没有明确的下一步建议 / 当前没有额外需要你拍板的事项 / 当前还没有验证结果` 这一批已统一收成 `回跳地址 / 切换 / 频道说明还没同步 / 暂无明确下一步建议 / 暂无需要你拍板的事项 / 暂无验证结果` 这类更短口径，前后端 sanitizer、workspace governance 和 seed 也同步跟上。
  - 第九十五刀继续把 `board / chat / settings / setup` 的剩余说明腔压成状态句和动作句；`回到任务板排优先级 / 需要继续交接的事项 / 当前频道或私聊的说明会显示 / 当前讨论间的摘要会显示 / 这个消息面当前还没有内容 / 支持中断后继续 / 需要继续时回到 / 默认值会直接保存到服务端 / 还没有接收端` 这一批已统一收成 `来自…排完优先级就回去 / 待跟进交接 / 频道说明还没同步 / 讨论摘要还没同步 / 暂无消息 / 支持续接 / 回跳地址 / 默认值直接写回服务端 / 暂无接收端`，board/chat/settings/setup 首屏继续减少解释成本。
  - 同轮顺手把 `headed-room-workbench-topic-context / headed-board-planning-surface / headed-notification-preference-delivery / headed-setup-e2e` 补成可复用外部 live stack 的运行器；现在可通过 `--web-url`、`--server-url` 或 `OPENSHOCK_E2E_WEB_URL`、`OPENSHOCK_E2E_SERVER_URL` 直连已有服务，不再硬绑脚本内本地起服。当前沙箱里验证后，失败点已经从本地 `listen EPERM` 前移成目标服务不可达 `fetch failed`。
  - 仍保留的例外是合法主入口或真实操作，例如移动端 `room-workbench-open-inbox` 逃生路径、GitHub 安装外跳、正式 mutation CTA；减法只碰空动词和重复导航，不误删真正改变位置或状态的按钮。下一步优先继续扫 board / room / settings 剩余的帮助文案和空态边界，再回到 setup 里仍然过长的提示和治理摘要。

### 2026-04-16 已收口

- `GAP-67 / TKT-98`
  - daemon session workspace envelope 已正式落地；同一 `sessionId` 会稳定复用同一目录，并写出 `MEMORY.md / SESSION.json / CURRENT_TURN.md / notes/work-log.md` 作为 turn continuity 本地锚点。
- `GAP-68 / TKT-99`
  - Codex resume continuity 已收成 local-first truth；session-scoped `OPENSHOCK_CODEX_HOME` 会跟同一份 session workspace 一起复用，daemon restart 后的 `resume --last` 不再继续吃全局共享状态。
- `GAP-69 / TKT-100`
  - daemon real-process continuity system harness 已站住；built binary + real daemon subprocess + httptest control plane + fake Codex CLI 现在能一起证明 same-session restart recovery、`CURRENT_TURN.md` 刷新、`notes/work-log.md` 累积、稳定 `codexHome` 与 `appServerThreadId` reinjection。
- `GAP-71 / TKT-102`
  - 显式 provider thread state 的本地持久化 contract 已站住；执行进程现在可通过 daemon 提供的 thread-state file 写回 `SESSION.json.appServerThreadId`，后续 resume 会把这个值重新注入进程环境，形成可验证的本地恢复锚点。

### 2026-04-22 九分冲刺待收

- `P0-首页产品化`
  - `/` 不能再只是跳转中间页；要直接回答“现在可以继续聊天、继续设置、回到最近讨论、处理待办交接”。
- `P0-主壳减法`
  - `shell / rooms` 继续压噪音：统计、摘要 rail、重复 self-link 和多层次级标签默认后移，主视觉只保留聊天和当前目标。
- `P0-Setup 减法`
  - `/setup` 默认只保留模板、仓库、GitHub、运行环境 4 个 checkpoint；runtime inventory、governance、lease、调度、配额全部降到高级区域。
- `P0-Mailbox 减法`
  - `/mailbox` 默认只保留待你处理的交接、阻塞原因和下一步按钮；升级队列、团队分工、规则、自动续接都进入二级视图。
- `P0-Release Gate 加硬`
  - `ops:smoke` 已覆盖 `/v1/state/stream`、`/v1/experience-metrics`、runtime pairing drift、`run control` fail-closed；下一步是把 strict GitHub readiness 更常态化，而不是只靠发布时手动加环境变量。
- `P1-文件级记忆产品面`
  - 把 `SOUL.md / MEMORY.md / notes/channels.md / notes/operating-rules.md / notes/skills.md / notes/work-log.md` 变成默认可见、可回放、可注入的工作面。
- `P1-协议化协作闭环`
  - 把 `claim -> execute -> handoff -> resume -> closeout` 做成显式主链，绑定 actor、thread、evidence 和 SLA，减少“有能力但没有强协议”的使用落差。

本轮已落地：

- `/`
  - 首页已改成真实产品入口，默认显示“现在可以做什么”、最近讨论、待办交接、GitHub 与工作区概况，不再自动跳转。
- `/setup`
  - 首屏已改成“下一步 + 模板/仓库/GitHub/运行环境”优先，开始使用语气替代“设置与诊断”语气。
- `/mailbox`
  - 首屏已改成“先处理需要你接手的事”，把待处理交接和下一步动作提前到最前面。
- `ops:smoke`
  - 已覆盖 `/v1/state/stream` 与 `/v1/experience-metrics`，并锁进脚本测试。
  - 已补 `POST /v1/runs/__ops_smoke_missing_run__/control` fail-closed 探测；默认 smoke 现在会证明控制路由在线且不会误写 live run。
- `文件级记忆`
  - session 默认记忆路径已前滚到 `MEMORY.md + notes/channels.md + notes/operating-rules.md + notes/skills.md + notes/work-log.md + room/decision`。
  - `/memory` next-run preview 与 agent profile file stack 现在会默认露出 owner agent 的 `SOUL.md + MEMORY.md + notes/*` 规则栈，而不再只露一条 `MEMORY.md`。
- `daemon continuity`
  - daemon session workspace 已从最小 envelope 前滚到 `SOUL.md + MEMORY.md + notes/channels.md + notes/operating-rules.md + notes/skills.md + notes/rooms/<room>.md + notes/work-log.md`。

### 当前必须先收的 GAP

当前需要优先收的已不再是“能不能配 topology”“能不能正式对话”“能不能给下一棒默认路由”“能不能一键起单”“能不能自动续下一棒”“能不能把 final lane 接回 delivery entry”“能不能显式给出 delivery delegate”“能不能自动创建 delegated closeout handoff”“能不能把 delegated lifecycle / latest comment 回写到 PR contract”“能不能把 delivery delegation policy 做成正式配置 / auto-complete 策略”“能不能把 blocked delegated closeout 物化成 response handoff”“能不能把第二轮 retry attempt 显式收成产品真相”“能不能把 response handoff formal comment 回写到统一 delivery contract”“能不能把 response progress 回推父级 delegated handoff / inbox / next action”“能不能把 parent/child response orchestration 直接做进 mailbox shell”“能不能从 child ledger 直接恢复 parent closeout”“能不能把 parent 恢复后的 reply 历史继续留在统一 delivery contract”“能不能让 child ledger 直接看见 parent 最终有没有被接住”“能不能把 parent 自己的 mailbox/run context 也保住 response history”“能不能让 child ledger 的正文与 child inbox signal 一起跟上 parent 真相”“能不能让 child ledger 时间线和 latest formal comment 也跟上 parent follow-through”“能不能让 parent 自己的 timeline 也完整回放 child response 轨迹”“能不能把这些关键 child response sync 也写进 Room 主消息流”“能不能把 parent / child formal communication 拉平成 PR detail 上可回放的统一 thread”“能不能直接在 PR detail 内执行当前 delegated closeout / reply action”“能不能把 escalation 从 aggregate SLA 计数落成正式 queue truth”“能不能把 workspace 级 hot room 收成跨 room rollup”“能不能让 hot room 直接起 governed next handoff”，而是前端减法、更重的长期记忆整理、外部 provider 编排、durable governance，以及下一层的 multi-room dependency graph / auto-closeout；同时要继续把刚站住的 daemon continuity harness 扩成更重的 multi-session / multi-agent recovery 矩阵。

### 本轮已转成执行票

#### `TKT-103` Release Smoke 补齐 Run Control Fail-Closed

- Goal: 让 `pnpm ops:smoke` 不只证明主链连通，还证明 `run control` 路由在线且边界不会误写 live run。
- Scope: `scripts/ops-smoke.sh`、`apps/server/internal/api/ops_smoke_script_test.go`、`docs/engineering/Release-Gate.md`、`docs/testing/README.md`。
- Dependencies: 现有 `POST /v1/runs/:id/control` contract、`TC-018` 浏览器级 exact replay、`TC-021` release gate pairing smoke。
- Self-Check: `bash -n scripts/ops-smoke.sh`、`go test ./internal/api -run TestOpsSmoke -count=1`。
- Review Gate: 负向 probe 必须返回 `404 + run not found`，不能默默 200、302 或写坏任一现有 run。
- Merge Gate: live stack smoke 继续能在真实 server/daemon 端口上通过。
- Related Checklist IDs: `CHK-15`
- Related Test Case IDs: `TC-018` `TC-021`

#### `TKT-104` 文件级记忆默认规则栈产品化

- Goal: 让文件记忆不再只是 `MEMORY.md + work-log`，而是默认把 workspace 规则栈和 owner agent 规则栈都带进下一次任务。
- Scope: session 默认 `memoryPaths`、`/memory` next-run preview、agent profile file stack、room prompt 的读取边界文案。
- Dependencies: 当前 `CHK-10` memory center provider preview、`TC-036` agent profile edit、`TC-088` owner continuity。
- Self-Check: `go test ./internal/store -run 'TestMemoryCenter|TestUpdateAgentProfilePersistsAuditAndPreview|TestCreateIssueCreatesMemoryArtifactsAndSessionLinks' -count=1`、`go test ./internal/api -run 'TestAgentProfileRouteSupportsEditAndPreviewWriteback|TestBuildRoomExecPromptIncludesRoomRunAndRecentContext' -count=1`。
- Review Gate: preview 必须显式露出 `SOUL.md + MEMORY.md + notes/channels.md + notes/operating-rules.md + notes/skills.md + notes/work-log.md`，且 room note/decision 仍受 policy 与 memory space 约束。
- Merge Gate: profile preview badge、memory center preview 和 store reload 后的 owner continuity 不能回退。
- Related Checklist IDs: `CHK-10` `CHK-22`
- Related Test Case IDs: `TC-013` `TC-019` `TC-036` `TC-088`

#### `TKT-105` Daemon Session Workspace 规则栈前滚

- Goal: 让 daemon 恢复链默认拥有可检查的规则栈，而不是只剩 `MEMORY.md / CURRENT_TURN.md / work-log`。
- Scope: `apps/daemon/internal/runtime/service.go` session scaffold、对应 runtime tests、daemon README/测试索引同步。
- Dependencies: `TKT-100` same-session recovery harness、`TKT-99` scoped Codex home continuity、local slock 文件记忆参考。
- Self-Check: `go test ./apps/daemon/internal/runtime -count=1`。
- Review Gate: 同一 session 第二轮执行必须继续复用同一目录，且新增 `SOUL.md + notes/* + room note` 不得覆盖已有手工内容。
- Merge Gate: `CURRENT_TURN.md` 刷新、`notes/work-log.md` 累积、`SESSION.json` thread state persistence 继续保持。
- Related Checklist IDs: `CHK-10` `CHK-14` `CHK-22`
- Related Test Case IDs: `TC-043` `TC-088` `TC-091`

---

## 五、推荐推进顺序

1. 先收 `TKT-101`：持续做 room / inbox / run / governance 的 subtractive polish，但不再靠加新面板解决流畅度问题。
2. 然后回到 `CHK-10` 的更重 memory compaction / retention / durable adapter。
3. 后续所有多智能体 continuity / recovery 票默认接 `TKT-100` 这套 real-process harness，不再回退到手搓零散 fixture。

---

## 六、这轮知识回收带来的新增要求

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

## 七、每张执行票最少要写清什么

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

## 八、每一轮固定 Loop

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

## 九、维护规则

- 每一轮收口后，先更新这份文档，再开下一轮 planning 票
- 如果 live board 已经收掉某条 face，对应条目要同步从“下一步”挪到“已完成”
- 如果 backlog 方向变了，必须先更新这里，再去频道口头宣布

这份文档的目标不是写愿景，而是让大家下一次开票时不需要重新争论：

- 现在已经做完了什么
- 还剩哪些 face
- 下一张票该怎么开

---

## 十、最近进展

- `2026-04-21`
  - Setup 协作预览现在会直接显示每条 governance lane 的默认智能体，`Architect / Developer / Reviewer / QA` 不再只有抽象 lane 名。
  - 新增 1 个真实 developer agent `Build Pilot`，让“网站需求 4 棒接力”不再卡死在 seed/mock 只有 3 个 agent 的缺口上。
  - 新增 `scripts/headed-website-four-agent-delivery.mjs`，覆盖网站需求的 `setup -> board visible truth -> planner assignment -> architect -> developer -> reviewer -> qa -> final response` 链路。
  - `scripts/headed-planner-dispatch-replay.mjs` 已补 external live stack 复用入口；当前沙箱里 failure point 已前移到外部 `healthz` 不可达，而不是本地 `listen EPERM`。
  - 任务板卡片继续做前端减法：每张事项卡只保留 `讨论间` 一个主动作，事项详情改走上下文回跳，不再在卡片上重复渲染第二个 CTA。
  - Agent 档案页继续压短解释文案：文件记忆、凭据范围、沙箱策略、编辑区和下一次执行预览都改成对象 / 结果本身，减少“页面在解释自己”的阅读成本。
  - `headed-board-planning-surface` 和 `headed-website-four-agent-delivery` 已跟随单 CTA 任务板更新断言，负向 DOM 检查确认 board 卡片没有 `board-card-issue-*` 第二按钮，Agent 档案页没有 disabled 假按钮。
  - `settings` 里的凭证 / 通知支持流继续做减法：`工作区凭证 / 默认策略 / 当前浏览器接收 / 邮件接收 / 接收端列表 / 待发送来源` 这批标题、摘要和空态已改成对象或状态本身，不再反复解释页面怎么工作。
  - `run sandbox` 这轮顺手补齐了同页真相一致性：权限检查返回后，右侧 `当前判断`、放行条件和 `approval_required -> overridden` 状态现在会立刻读同一份最新 decision，不再出现顶部提示已更新但判断卡还停在旧状态的分裂。
  - `headed-notification-preference-delivery` 与 `headed-restricted-sandbox-policy` 已再次验证这两条 supporting flow；通知链路覆盖无效邮箱失败后修正恢复，sandbox 链路覆盖 `allowed -> approval_required -> same-target override -> reload persisted`。
  - first-start 入口这轮继续收口成产品名而不是路径：`/access` 与 `/setup` 不再提示不存在的“首页设置”，`登录后去哪里 / 现在先做哪一步` 里的 `/access / /onboarding / /chat/all` 这批原始地址已改成 `身份 / 引导 / 聊天 / 设置` 这类前台口径，同时保留测试用 raw route 真值。
  - `/rooms` 这轮重新收成真正的讨论间索引，不再硬跳 `/chat/all`；房间回到一等入口后，更接近 `slock` 那种 channel / room 并列的协作壳心智。
  - `/agents/[id]` 这轮明确收成历史兼容跳转，canonical agent route 统一回到 `/profiles/agent/[id]`；`live-detail-views` 里无路由入口的旧 agent detail 页面和相关死代码也一起移除，减少维护噪音和双路由分裂。
  - Quick Search、Mailbox agent 链接和 server 生成的搜索入口这轮也统一回到 canonical `/profiles/agent/[id]`，前台不再主动发出旧 `/agents/[id]` 深链，只保留兼容跳转。
  - Issue detail 里遗留的英文 `Planning mirror` 已改成 `回任务板`，支持流不再混进英文 CTA。
  - 根 README 与 `docs/README.md` 这轮继续产品化：入口说明改成“现在你能做什么、发布前最小验证、文档从哪里读真相”，并同步当前 canonical profile route、`/rooms` 入口和验证索引。
  - `Runbook / Phase0-MVP / Testing Index` 这轮补齐当前真实 route/API inventory、`pnpm dev:fresh:*` 主启动路径和一屏测试信任矩阵；TODO 自身也切出“当前一屏视图”，避免新贡献者先读长归档。
  - Room context 空态回到测试契约里的 `当前没有待跟进交接`，避免同一 supporting surface 因文案漂移打断 `headed-room-workbench-topic-context`。

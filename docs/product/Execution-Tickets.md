# OpenShock Execution Tickets

**版本:** 1.29
**更新日期:** 2026 年 4 月 16 日
**关联文档:** [PRD](./PRD.md) · [Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、使用方式

- 这份文档承接 **当前票面状态** 的 canonical backlog，并保留最近完成批次的状态和映射。
- 已完成能力的详细证据继续以 [Checklist](./Checklist.md) 和记实测试报告为准，不在这里重复展开。
- 每张票必须绑定对应 `Checklist` 和 `Test Case`，否则不能 claim。

### 状态定义

- `todo`: 还没开始
- `active`: 已 claim，正在实现
- `review`: 已提测，等待 reviewer / QA
- `done`: 已过 gate 并进入主线

---

## 二、当前批次优先级

1. 已经站住的前端壳、onboarding、mailbox、profile、persistence 不再反复假装“未完成”；后续票只围剩余 GAP 开。
2. 当前主线已经吸收 PR conversation、usage/quota、identity recovery、restricted sandbox、delivery gate 和 configurable topology；下一批不再重复补旧口，而是继续往更深治理和体验收尾推进。
3. 聊天、Room、Inbox、Topic、Run 的真相仍高于 Board；Board 继续只做 planning mirror。
4. 多 Agent 协作当前已经收进 SLA / routing / aggregation、formal comment、governed next-route default、one-click auto-create、governed auto-advance、delivery closeout backlink、delivery delegation signal、delegated closeout handoff auto-create、delegated closeout lifecycle sync、delivery delegation automation / auto-complete policy、delegated closeout response orchestration、retry attempt truth、parent surface context preservation、child response context sync、child response timeline sync、parent response timeline sync、room main-trace sync（含 blocked response trace）、PR detail collaboration thread + inline thread actions、mailbox 当前 room ledger 的 multi-select batch queue、governed batch policy auto-advance、workspace governance escalation queue mirror、cross-room escalation rollup，以及 room-level governed create action；下一批继续前滚到更重的 multi-room dependency graph / auto-closeout。
5. memory provider orchestration 与 health/recovery 已补到正式产品面；下一批继续围后台整理、真实 remote external durable adapter 和更重的多 Agent 自治策略。

### Frontend Batch Merge Gate

- 每张前端票都必须补 headed browser walkthrough 证据，不接受用默认 headless 冒充。
- 每张前端票都必须更新 `Checklist -> Test Cases -> Ticket` 的映射。
- 每张前端票都必须做桌面主视口走查；改布局还要补窄屏抽查。
- 每张前端票都必须显式检查:
  - composer 是否常驻可见
  - 历史消息是否能稳定回滚
  - 左栏 / 下拉 / 高亮是否紧凑易读
  - Board 是否没有重新抢回主导航心智

### Config / Governance Batch Merge Gate

- 涉及 Agent / Machine / onboarding / preference 的票，必须补 reload 或 restart 之后的 persistence 证据。
- 涉及多 Agent 的票，必须显式展示 handoff ledger、ack / blocked、human override。
- 不接受只做前端 mock 表单、不写后端 truth 的配置票。

---

## 三、当前票面状态

## TKT-21 Real Quick Search / Search Result Surface

- 状态: `done`
- 优先级: `P0`
- 目标: 把当前静态 Quick Search 做成真正可切换 `channel / room / issue / run / agent` 的结果面。
- 范围:
  - 搜索输入与结果列表
  - 结果高亮、键盘导航、跳转后保持当前壳层上下文
  - `channel / room / issue / run / agent` 最小结果卡
- 依赖: `TKT-16`
- Done When:
  - Quick Search 不再只是入口按钮，而是真正可切换工作面的命令面板
  - 搜索后能跳到目标页面，并保持当前壳层高亮正确
  - 有 headed walkthrough 证据覆盖 `open -> search -> jump`
- Checklist: `CHK-01` `CHK-16`
- Test Cases: `TC-033`

## TKT-22 DM / Followed Thread / Saved Later Surface

- 状态: `done`
- 优先级: `P0`
- 目标: 补齐 `DM / followed thread / saved later` 这条消息工作流。
- 范围:
  - DM 数据模型与前台入口
  - followed thread 列表
  - saved / later 列表
  - 基础 unread 语义与回访入口
- 依赖: `TKT-21`
- Done When:
  - 用户可从同一套壳层进入 DM、followed thread 和 saved later
  - thread 不再只停在右 rail 回复区，而是可被 follow / reopen
  - 至少有一条 headed browser walkthrough 覆盖 `channel -> thread -> follow -> reopen`
- Checklist: `CHK-16` `CHK-17`
- Test Cases: `TC-029`

## TKT-23 Room Workbench Tabs / Topic Context

- 状态: `done`
- 优先级: `P0`
- 目标: 把 Room 收成默认工作台，让 `Chat / Topic / Run / PR / Context` 在同一页稳定切换。
- 范围:
  - room header tabs
  - topic summary / run truth / PR truth / context back-links
  - room-first navigation and state persistence
- 依赖: `TKT-16`
- Done When:
  - 用户围绕一个 room 完成讨论、执行、PR、回看，不需要频繁跳详情页
  - run control、PR entry、inbox back-link 保持可用
  - room 切 tab 不丢当前上下文
- Checklist: `CHK-06` `CHK-17`
- Test Cases: `TC-031`

## TKT-24 Frontend Interaction Polish Sweep

- 状态: `done`
- 优先级: `P0`
- 目标: 系统化收前端的人机工学问题，不再靠零散截图驱动微调。
- 范围:
  - sidebar / channel / room dropdown 与高亮位置
  - channel / room scrollback 稳定性
  - composer 常驻可见性
  - 字号、间距、密度、Work 页卡片收缩
  - 下拉、hover、focus 和点击区的人类可用性
- 依赖: `TKT-16`
- Done When:
  - 主要聊天与工作面不存在“输入框看不到”“历史消息滚不回去”“高亮位置飘”“空白过大”这类高频问题
  - 有明确的 headed walkthrough 覆盖桌面主视口和窄屏抽查
  - 文档里形成固定的 interaction polish 验收项
- Checklist: `CHK-01` `CHK-16` `CHK-17`
- Test Cases: `TC-028` `TC-034`

## TKT-25 Agent / Machine / Human Profile + Presence

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `Agent / Machine / Human` 做成可 drill-in 的 profile surface，而不是散落的 badge。
- 范围:
  - profile routes / panels
  - presence、activity、capability、最近 room/run 关系
  - shell / room 内的统一 drill-in entry
- 依赖: `TKT-23`
- Done When:
  - 任一 `Agent / Machine / Human` 都可从壳层或 room 进入 profile surface
  - presence / capability / 最近活动直接消费 live truth
  - profile 不再只是孤立详情页
- Checklist: `CHK-02` `CHK-17`
- Test Cases: `TC-030`

## TKT-26 Board Light Planning Cleanup

- 状态: `done`
- 优先级: `P2`
- 目标: 保留 Board 的次级位置，但把 planning card 和回跳关系做轻。
- 范围:
  - board card 信息压缩
  - room / issue / board 回跳关系
  - planning 语言与主壳一致，不再像独立后台
- 依赖: `TKT-20`
- Done When:
  - Board 明显是 planning mirror，而不是默认中心
  - 从 room / issue 打开 planning surface 再回来足够顺手
  - card 语言比当前更轻、更少噪音
- Checklist: `CHK-05` `CHK-18`
- Test Cases: `TC-032`

## TKT-27 DM / Thread / Search Backend Contracts

- 状态: `done`
- 优先级: `P1`
- 目标: 给下一轮消息型前端补最小 server truth，不靠纯本地 mock 撑 DM / followed thread / search。
- 范围:
  - `directMessages / directMessageMessages / followedThreads / savedLaterItems` 的 state contract
  - `quickSearchEntries` search result contract
  - unread / reopen / jump target contract
- 依赖: 无
- Done When:
  - 前端不需要再拿硬编码占位结构伪装 DM / thread search
  - DM composer、thread follow、saved later 能直接打 live API
  - Quick Search 能直接消费 server-backed `dm / followed / saved` result truth
  - 合同有对应后端 tests
- Checklist: `CHK-03` `CHK-16` `CHK-17`
- Test Cases: `TC-029` `TC-033`

## TKT-28 GitHub App Installation-Complete Callback / Repo Sync

- 状态: `done`
- 优先级: `P1`
- 目标: 补齐 GitHub App 安装完成后的 live callback、repo 持续同步与前台回流。
- 范围:
  - installation-complete callback
  - repo sync / webhook backfill
  - room / inbox / PR state 回流
- 依赖: `TKT-06`
- Done When:
  - 完整 GitHub App 安装后，OpenShock 能持续收到 repo truth
  - 不再只停在 installation pending 的 blocked-path
  - 有实机或近实机证据覆盖 callback -> sync -> UI update
- Checklist: `CHK-07`
- Test Cases: `TC-015`

## TKT-29 Device Authorization / Email Verification / Reset

- 状态: `done`
- 优先级: `P1`
- 目标: 把 invite / role / quick login 补成完整身份恢复链。
- 范围:
  - device authorization
  - email verification / reset
  - session recovery / external identity binding
- 依赖: `TKT-08`
- Done When:
  - 新成员、换设备、忘记密码这些链路都能被产品化验证
  - 身份真相会回写到 session / member / permission surface
- Checklist: `CHK-13`
- Test Cases: `TC-035`

## TKT-30 Destructive Guard / Secret Boundary

- 状态: `done`
- 优先级: `P1`
- 目标: 把 destructive action approval、secret boundary 和越界写保护做成产品化 guard。
- 范围:
  - destructive git / filesystem approval
  - sandbox boundary visibility
  - secret / credential scope
- 依赖: 无
- Done When:
  - 高风险动作不会直接执行，而会进入 approval required
  - secrets 和 runtime capability 边界清晰
  - room / inbox / run 都能看到 guard truth
- Checklist: `CHK-12`
- Test Cases: `TC-027`

## TKT-31 Runtime Lease Conflict / Scheduler Hardening

- 状态: `done`
- 优先级: `P1`
- 目标: 在当前 failover 基线上继续补 lease conflict guard、scheduler observability 和恢复策略。
- 范围:
  - lease conflict
  - scheduler policy visibility
  - failover / recover consistency
- 依赖: `TKT-14`
- Done When:
  - 多 runtime 不会因为 lease 漂移或 stale state 做出错误调度
  - `/setup` 与 `/agents` 能稳定显示当前决策原因
  - 对应 release / browser verify 能稳定回放
- Checklist: `CHK-14` `CHK-15`
- Test Cases: `TC-020` `TC-021`

## TKT-57 GitHub Public Ingress Callback / Webhook Delivery Verification

- 状态: `done`
- 优先级: `P1`
- 目标: 把 GitHub installation callback / webhook delivery 从近实机 contract 推到 public ingress 级 exact evidence。
- 范围:
  - Setup surface 暴露 public callback URL / webhook URL
  - installation callback 通过同一 public ingress root 回流
  - signed webhook delivery + bad-signature fail-closed 走 public ingress 回放
- 依赖: `TKT-28`
- Done When:
  - `/v1/github/connection` 与 Setup UI 会明确给出 public callback / webhook URL
  - `/setup/github/callback` 能在 public ingress root 下把 installation truth 写回 Setup
  - `/v1/github/webhook` 的 signed delivery 与 bad-signature fail-closed 都有同一 public root 下的 exact artifact
- Checklist: `CHK-07`
- Test Cases: `TC-015` `TC-045`

## TKT-32 Agent Profile Editor / Prompt Avatar Memory Binding

- 状态: `done`
- 优先级: `P1`
- 目标: 把 Agent 从只读对象补成真正可编辑的 profile surface。
- 范围:
  - role / avatar / prompt / operating instructions 编辑
  - memory binding / recall policy / provider preference
  - next-run preview 与审计差异
- 依赖: `TKT-25` `TKT-12`
- Done When:
  - 用户可在 Agent profile 中编辑 prompt、avatar、role 与 memory binding
  - 编辑结果会回写到后端 truth，并影响下一次 run 的 injection preview
  - 至少有一条 headed walkthrough 覆盖 `open profile -> edit -> save -> verify next run`
- Checklist: `CHK-02` `CHK-10` `CHK-19`
- Test Cases: `TC-030` `TC-036`

## TKT-33 Machine Profile / Local CLI Model Capability Binding

- 状态: `done`
- 优先级: `P1`
- 目标: 把 Runtime / Machine 的本地能力发现与 Agent 偏好绑定做成正式产品面。
- 范围:
  - machine profile：hostname / OS / shell / daemon / capability summary
  - 本地 CLI / provider truth + provider model catalog
  - Agent default provider / model / runtime affinity 绑定
- 依赖: `TKT-14`
- Done When:
  - `/setup`、`/agents` 或 machine profile 能看到 machine capability truth
  - Agent 可声明 default provider / model / runtime affinity，并与 machine/provider truth 对齐；model catalog 只作 suggestion，不按静态列表硬拒绝
  - 有 store / API tests 加浏览器级 walkthrough
- Checklist: `CHK-14` `CHK-19` `CHK-22`
- Test Cases: `TC-037` `TC-040`

## TKT-34 Onboarding Studio / Dev Team + Research Team Templates

- 状态: `done`
- 优先级: `P1`
- 目标: 把首次启动和团队模板做成真正可恢复的 onboarding 流。
- 范围:
  - onboarding wizard / resumable progress
  - `开发团队 / 研究团队 / 空白自定义` 模板
  - 默认 channels / roles / agents / notification policy / onboarding notes 物化
- 依赖: `TKT-32` `TKT-33` `TKT-37`
- Done When:
  - 新 workspace 可以选择模板并完成首次启动
  - onboarding 可中断后继续，而不是一次性魔法流程
  - 有 headed walkthrough 覆盖 `create workspace -> choose template -> pair runtime -> finish`
- Checklist: `CHK-20` `CHK-22`
- Test Cases: `TC-038` `TC-040` `TC-041`

## TKT-35 Agent Mailbox / Handoff Contract

- 状态: `done`
- 优先级: `P1`
- 目标: 给 Agent-to-Agent 正式协作建立可观测、可追踪的消息与交接合同。
- 范围:
  - agent mailbox message model
  - handoff request / ack / blocked / complete lifecycle
  - room / inbox back-link 与 human visibility
- 依赖: `TKT-27`
- Done When:
  - 一个 Agent 可以正式把上下文交给另一个 Agent
  - handoff 生命周期能在 Room / Inbox / Mailbox surface 中被追踪
  - 后端有 contract tests，前台有 walkthrough evidence
- Checklist: `CHK-03` `CHK-21`
- Test Cases: `TC-039`

## TKT-36 Multi-Agent Governance / Role Topology / Reviewer-Tester Loop

- 状态: `done`
- 优先级: `P1`
- 目标: 把多 Agent 分工、审批和 response aggregation 变成可治理的团队拓扑，而不是口头约定。
- 范围:
  - `PM / Architect / Splitter / Developer / Reviewer / QA` 与研究团队变体
  - handoff rules / approval gates / escalation path
  - human override 与 response aggregation
- 依赖: `TKT-34` `TKT-35`
- Done When:
  - 用户可基于模板起出多 Agent 分工链
  - review / test / blocked escalation 有显式治理面
  - 至少有一条端到端 walkthrough 覆盖 issue -> handoff -> review -> test -> final response
- Checklist: `CHK-20` `CHK-21`
- Test Cases: `TC-041`

## TKT-37 Workspace / User / Agent Config Persistence + Database Truth

- 状态: `done`
- 优先级: `P1`
- 目标: 把 workspace / member / agent profile 的配置读写与治理快照从临时前端状态补成 durable store truth。
- 范围:
  - workspace / member durable config schema / store / migration
  - preference / onboarding / profile / repo-binding / GitHub-installation snapshot persistence
  - restart / reload / device switch recovery contract
- 依赖: 无
- Done When:
  - 关键配置可跨刷新、重启、换设备恢复
  - API 与 UI 读取到的是同一份 durable truth
  - 至少有一条测试覆盖 persistence + recovery
- Checklist: `CHK-22`
- Test Cases: `TC-040`

## TKT-38 Live Truth Hygiene / Placeholder Leak Guard

- 状态: `done`
- 优先级: `P0`
- 目标: 把 live truth 面里的 placeholder、乱码、fixture / test residue 和内部路径泄漏收成 fail-closed contract，不再把脏 seed/fallback 直接送到用户面前。
- 范围:
  - `/v1/state` 与 `/v1/state/stream` 的 visible truth sanitization
  - mutation-returned state 的前台 state adapter guard
  - live detail / room / setup / settings / orchestration / inbox 的 placeholder wording cleanup
  - `check:live-truth-hygiene` release gate
- 依赖: 无
- Done When:
  - `/chat/all`、`/issues`、`/rooms`、`/runs`、`/inbox` 用户可见文案不再出现 placeholder、乱码、fixture、test residue 或内部 worktree 路径
  - 如果底层 state 含脏值，前台回退到产品级 fallback，而不是把 seed/fallback 真值直接吐给用户
  - release gate 能稳定拦下 direct mock-data import、placeholder wording 和 tracked live-truth residue
- Checklist: `CHK-03` `CHK-15`
- Test Cases: `TC-042`

## TKT-40 Run History / Incremental Fetch / Resume Context

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `/runs` 收成可渐进展开的历史面，并让 run detail / room run tab 直接暴露当前可恢复的 session continuity。
- 范围:
  - `/v1/runs/history` paginated contract
  - `/v1/runs/:id/detail` resume-context + same-room history contract
  - `/runs` incremental fetch / `Load Older Runs`
  - run detail / room run tab 的 session-backed resume context 与 prior-run reopen
- 依赖: `TKT-23`
- Done When:
  - `/runs` 首屏只展示最新一页 history，旧 run 通过显式增量展开
  - run detail 能稳定显示 branch / worktree / memory paths / control note 这类 resume context
  - 同一条 room 的前序 run 可被 reopen，且回到 room run tab 时仍锚定当前 active continuity
- Checklist: `CHK-06`
- Test Cases: `TC-043`

## TKT-47 Mobile Web Light Observation / Notification Triage

- 状态: `done`
- 优先级: `P1`
- 目标: 把 mobile web 上的 `/inbox` 收成“能打开、能查看、能处理轻量通知”的 exact triage 面，而不是把桌面 workbench 整套硬塞进手机。
- 范围:
  - mobile-only triage summary card（open / unread / blocked / recent）
  - approval center signal card 的 mobile density 收缩
  - guard / backlinks / recent ledger 的折叠式 reveal
  - mobile headed verification for `/inbox`
- 依赖: `TKT-10` `TKT-11`
- Done When:
  - 390px 级视口下 `/inbox` 不出现横向溢出
  - 首屏能直接看到 open triage 摘要与 decision，不需要先横向滚动或穿过整块 guard copy
  - 更重的 notification policy / subscriber / delivery truth 继续明确回跳到 `/settings`
  - 有独立 headed mobile walkthrough 证据，而不是拿桌面截图代替
- Checklist: `CHK-11`
- Test Cases: `TC-044`

## TKT-52 Topic Route / Edit Lifecycle / Resume Deep Link

- 状态: `done`
- 优先级: `P1`
- 目标: 把 Topic 从 room workbench 子 tab 补成可独立直达、可注入 guidance、可直接恢复 continuity 的一等 route。
- 范围:
  - standalone topic route / quick-search backlinks
  - topic guidance edit surface
  - room / run continuity resume deep link
- 依赖: `TKT-23` `TKT-40`
- Done When:
  - Topic 不再只能从 room `?tab=topic` 里打开
  - 人类能直接在 Topic route 注入 guidance，并沿同一条 room / run truth 继续
  - 至少有一条 walkthrough 覆盖 `open topic -> edit guidance -> reload -> resume`
- Checklist: `CHK-06`
- Test Cases: `TC-031` `TC-046`

---

## 四、后续 Backlog / 延伸票

## TKT-39 Review Comment Sync / PR Conversation Backfill

- 状态: `done`
- 优先级: `P1`
- 目标: 把 PR review comment / thread resolution 从“只靠 webhook 粗同步”补成可回看、可回链的产品真相。
- 范围:
  - review comment / thread normalized state
  - PR detail、Room、Inbox 的 conversation back-link
  - reopen / re-sync / backfill consistency
- 依赖: `TKT-05` `TKT-28`
- Done When:
  - review comment、thread resolution、change request 能稳定回写到 PR / Room / Inbox
  - reload 或 webhook replay 后不会丢失 review conversation truth
  - 至少有一组 API + browser evidence 覆盖 `comment -> sync -> room/inbox back-link`
- 最新证据:
  - `go test ./internal/api` 已锁住 review sync、repeat replay dedupe、PR detail backlink contract
  - `docs/testing/Test-Report-2026-04-11-windows-chrome-pr-conversation-usage-observability.md`
- Checklist: `CHK-07` `CHK-08`
- Test Cases: `TC-025` `TC-026`

## TKT-41 Usage / Token / Quota Observability

- 状态: `done`
- 优先级: `P1`
- 目标: 把上下文窗口、token、quota 与执行成本补成正式可观察真相。
- 范围:
  - run / room / workspace usage summary
  - token / quota / context visibility
  - release / ops verify 的 usage regression hooks
- 依赖: `TKT-14`
- Done When:
  - 用户能看到 run / workspace 级 usage、quota 与 context cost
  - 关键 usage 指标不再只藏在日志或 CLI 输出里
  - verify / report 至少有一条证据覆盖 usage observability
- 最新证据:
  - `pnpm verify:web`
  - `docs/testing/Test-Report-2026-04-11-windows-chrome-pr-conversation-usage-observability.md`
- Checklist: `CHK-06` `CHK-15`
- Test Cases: `TC-021` `TC-026`

## TKT-42 Memory Viewer / Correction / Forget Surface

- 状态: `done`
- 优先级: `P1`
- 目标: 把记忆中心从“可浏览”补成“可纠正、可撤销、可追溯”的产品面。
- 范围:
  - memory detail audit trail
  - correction / feedback / forget actions
  - viewer-side provenance visibility
- 依赖: `TKT-12` `TKT-32`
- Done When:
  - 人类能查看 memory 来源、版本和作用域，并执行 correction / forget
  - correction / forget 会回写到同一份 governed truth
  - 至少有一条 walkthrough 覆盖 `open memory -> correct/forget -> verify audit`
- Checklist: `CHK-10` `CHK-22`
- Test Cases: `TC-023` `TC-036`

## TKT-43 Memory Cleanup / TTL / Promotion Worker

- 状态: `done`
- 优先级: `P1`
- 目标: 给 memory 增加去重、TTL、批量整理与 promote 队列，不让治理只停在单条人工操作。
- 范围:
  - dedupe / TTL / cleanup job
  - promote-to-skill / policy queue hardening
  - cleanup observability / recovery
- 依赖: `TKT-12`
- Done When:
  - memory cleanup 不再只能靠手工回收
  - TTL / dedupe / promote 结果有可见 ledger 与回归测试
  - 至少有一条验证覆盖 `cleanup -> promote -> verify next-run truth`
- Checklist: `CHK-10`
- Test Cases: `TC-019` `TC-023`

## TKT-44 Invite / Verify / Reset Notification Template Delivery

- 状态: `done`
- 优先级: `P1`
- 目标: 把 invite / verify / reset / blocked escalation 收成同一条恢复与通知模板链。
- 范围:
  - notification template catalog
  - invite / verify / reset / escalation email delivery
  - cross-device recovery touchpoint
- 依赖: `TKT-11` `TKT-29`
- Done When:
  - invite、verify、reset、高优先级 blocked escalation 都走同一份 delivery truth
  - 用户能在通知面看到模板与最近投递结果
  - 至少有一条验证覆盖 `invite/verify/reset -> delivery -> recovery`
- Checklist: `CHK-11` `CHK-13` `CHK-20`
- Test Cases: `TC-017` `TC-035` `TC-038`

## TKT-45 Credential Profile / Encrypted Secret Scope

- 状态: `done`
- 优先级: `P1`
- 目标: 把凭证从隐性环境依赖补成有边界、可审计的 Credential Profile。
- 范围:
  - encrypted secret storage / scope
  - workspace / agent / run credential binding
  - secret visibility / approval boundary
- 依赖: `TKT-30`
- Done When:
  - secret / credential 不再只能靠外部手配环境变量
  - workspace / agent / run 对 secret scope 的读取边界清晰
  - 至少有一条验证覆盖 `bind secret -> execute -> guard/audit`
- Checklist: `CHK-12` `CHK-13`
- Test Cases: `TC-024` `TC-027`

## TKT-46 Restricted Local Sandbox / Network / Tool Policy

- 状态: `done`
- 优先级: `P1`
- 目标: 在 trusted sandbox 之上继续补 network / tool / command 白名单和 profile 化策略。
- 范围:
  - sandbox profile / policy surface
  - network / command / tool allowlist
  - denial / approval-required recovery flow
- 依赖: `TKT-30` `TKT-45`
- Done When:
  - workspace / agent / run 能声明 restricted sandbox profile
  - 越权网络、命令或工具调用会显式进入 denied / approval required
  - 至少有一条验证覆盖 `restricted profile -> denied action -> override/retry`
- Checklist: `CHK-12` `CHK-15`
- Test Cases: `TC-021` `TC-027`

## TKT-48 Workspace Plan / Usage Limit / Retention Surface

- 状态: `done`
- 优先级: `P2`
- 目标: 把 workspace 计划、上限、usage 与 retention policy 做成用户可见的产品面。
- 范围:
  - workspace plan / limits summary
  - max machines / agents / channels / history retention visibility
  - usage / limit warning surface
- 依赖: `TKT-41`
- Done When:
  - 用户能看到当前 workspace plan、usage、limits 与 retention truth
  - 关键 limit 不再只存在文档或 server 默认值里
  - 至少有一条验证覆盖 `view plan -> hit warning -> inspect usage`
- Checklist: `CHK-15` `CHK-22`
- Test Cases: `TC-021` `TC-026`

## TKT-49 Delivery Entry / Release Gate / Handoff Note Contract

- 状态: `done`
- 优先级: `P2`
- 目标: 把交付入口、release-ready 标准与 handoff note 收成单一可执行契约。
- 范围:
  - delivery entry / operator handoff note
  - release gate checklist / acceptance contract
  - closeout / customer-facing evidence bundle
- 依赖: `TKT-39` `TKT-41` `TKT-44`
- Done When:
  - 团队能用一份 contract 判断“是否 release-ready”
  - handoff note、release gate、customer evidence 不再散落在多份临时说明里
  - 至少有一条验证覆盖 `prepare release -> verify gate -> publish handoff note`
- Checklist: `CHK-15` `CHK-21`
- Test Cases: `TC-026` `TC-041`

## TKT-58 Control-Plane `/v1` Command / Event / Debug Read Model

- 状态: `done`
- 优先级: `P1`
- 目标: 把公开 control-plane 收成稳定 `/v1` contract，明确 command write、event read 和 debug / replay read-model 的边界。
- 范围:
  - versioned `/v1` resource contract
  - command write / event read split
  - debug history / rejection reason / replay anchor
  - stable error family / idempotency / cursor semantics
- 依赖: 无
- Done When:
  - 外部 consumer 可不依赖前台私有逻辑直接写 command、读 event、读 debug history
  - 错误返回能稳定区分 `not_found / conflict / boundary_rejection / internal`
  - 至少有一条 API + browser evidence 覆盖 `write -> replay -> rejection/debug readback`
- Checklist: `CHK-03` `CHK-15`
- Test Cases: `TC-047`

## TKT-59 Shell Adapter / No-Shadow-Truth Contract

- 状态: `done`
- 优先级: `P1`
- 目标: 收紧 shell adapter discipline，确保 projection 只 fan-in 稳定真相，不再留下 shadow truth。
- 范围:
  - adapter projection boundary
  - fail-closed fallback contract
  - stale / dirty projection adversarial probes
  - release gate for no-shadow-truth regressions
- 依赖: `TKT-38`
- Done When:
  - 新 surface 不会因为局部 projection 或 mock residue 显示与 `/v1` 冲突的状态
  - adapter 缺字段或上游脏值时，前台统一 fail-closed 回退到产品级 fallback
  - 至少有一条 verify / browser evidence 覆盖 dirty projection 对抗性场景
- Checklist: `CHK-03` `CHK-15`
- Test Cases: `TC-048`

## TKT-60 Runtime Publish Cursor / Replay Evidence Packet

- 状态: `done`
- 优先级: `P1`
- 目标: 把 daemon -> server 的 publish、closeout 和 replay 收成可重放、可解释、可复核的 evidence packet。
- 范围:
  - publish cursor / sequence dedupe
  - failure / closeout evidence packet
  - replay / closeout read-model
  - runtime readiness regression hooks
- 依赖: `TKT-31`
- Done When:
  - daemon 重发事件不会破坏 sequence，也不会重复落账
  - run closeout / replay 可读到 failure anchor、closeout reason 与 publish cursor truth
  - 至少有一条 contract + headed evidence 覆盖 `publish -> retry -> replay/closeout readback`
- Checklist: `CHK-14` `CHK-15`
- Test Cases: `TC-049`

## TKT-61 Multi-Agent Routing SLA / Response Aggregation Hardening

- 状态: `done`
- 优先级: `P1`
- 目标: 在现有 team topology / mailbox / human override 基线上，补齐正式 routing policy、escalation SLA、notification policy 与 final-response aggregation contract。
- 范围:
  - handoff routing matrix
  - escalation SLA / timeout / retry policy
  - multi-agent notification policy
  - final-response aggregation audit + human override trace
- 依赖: `TKT-36` `TKT-44`
- Done When:
  - 多 Agent 协作不再只显示 topology，而能解释为什么发给谁、谁超时、谁聚合最终回复
  - blocked / review / test / escalation 都走同一份 routing + notification policy
  - 至少有一条端到端证据覆盖 `issue -> handoff -> escalation -> aggregated final response`
- Checklist: `CHK-21`
- Test Cases: `TC-050`

## TKT-62 Configurable Team Topology / Governance Persistence

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `PM / Architect / Developer / Reviewer / QA` 这类治理拓扑从只读模板预览收成真正可编辑、可恢复的 workspace truth。
- 范围:
  - `/settings` team topology editor
  - workspace durable topology persistence
  - `/setup` `/mailbox` `/agents` governance replay 读同一份 topology
  - reload / restart / second-context recovery evidence
- 依赖: `TKT-36` `TKT-37` `TKT-61`
- Done When:
  - 用户可以在 `/settings` 直接修改 lane / role / default agent / handoff path
  - `workspace.governance` 会优先围 durable topology 派生，而不是退回固定模板
  - 至少有一条 Windows Chrome 有头证据覆盖 `settings edit -> setup/mailbox/agents replay -> reload/restart recovery`
- 最新证据:
  - `go test ./internal/store -run TestWorkspaceConfig`
  - `go test ./internal/api -run TestWorkspaceConfigRoutePersistsDurableSnapshot`
  - `docs/testing/Test-Report-2026-04-11-windows-chrome-configurable-team-topology.md`
- Checklist: `CHK-21` `CHK-22`
- Test Cases: `TC-051`

## TKT-63 Formal Mailbox Comment / Bilateral Handoff Communication

- 状态: `done`
- 优先级: `P1`
- 目标: 在现有 mailbox lifecycle 上补齐 source / target 双边 formal comment，让 handoff 不只剩 request / ack / blocked / complete 的单向状态推进。
- 范围:
  - `POST /v1/mailbox/:id` comment action
  - source / target actor guard
  - same-handoff ledger / inbox / room trace writeback
  - blocked / completed lifecycle preservation
- 依赖: `TKT-35` `TKT-62`
- Done When:
  - source agent 与 target agent 都能在同一条 handoff 上补 formal comment
  - comment 不会偷偷改 lifecycle status，也不会冲掉 blocked / completed 的关键 note
  - 至少有一条 Windows Chrome 有头证据覆盖 `create -> source comment -> blocked -> target comment -> ack -> complete`
- 最新证据:
  - `go test ./internal/store -run TestAdvanceHandoffComment`
  - `go test ./internal/api -run TestMailboxRoutesComment`
  - `docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-formal-comment.md`
- Checklist: `CHK-21`
- Test Cases: `TC-052`

## TKT-64 Governed Mailbox Route / Default Role Handoff

- 状态: `done`
- 优先级: `P1`
- 目标: 把 team topology 从只读治理预览推进到当前 room truth 驱动的默认下一棒 handoff 建议，避免 mailbox compose 静默随机挑人。
- 范围:
  - `workspace.governance.routingPolicy.suggestedHandoff` contract
  - current room / run owner lane resolution
  - `/mailbox` 与 Inbox compose governed-route surface
  - active handoff focus / missing target blocked fallback
- 依赖: `TKT-61` `TKT-62` `TKT-63`
- Done When:
  - governance snapshot 能围当前 room / run truth 给出下一棒 governed handoff suggestion
  - 当前 room 已有未完成 handoff 时，surface 会切成 `active` 并回链当前 ledger，防止重复创建
  - 下一条 lane 缺少可映射 agent 时，surface 会显式 `blocked`，不再静默回退到随机接收方
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-route -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-route.md`
- Checklist: `CHK-21`
- Test Cases: `TC-053`

## TKT-65 Governed Mailbox Auto-Create / Compose Shortcut

- 状态: `done`
- 优先级: `P1`
- 目标: 把 governed route 从“会建议”推进到“可一键起单”，减少 `/mailbox` 与 Inbox compose 上的重复选择和二次确认摩擦。
- 范围:
  - `/mailbox` governed route create shortcut
  - Inbox compose governed route create shortcut
  - active focus back-link after auto-create
  - same-route blocked replay on both surfaces
- 依赖: `TKT-64`
- Done When:
  - `/mailbox` 与 Inbox compose 在 `ready` governed route 下都提供一键创建 formal handoff 入口
  - auto-create 后两处 surface 会同步切到 `active` 并提供同一条 focus handoff 回链
  - handoff 完成后，两处 surface 都会前滚到下一条 lane；如果缺少 target agent，则同样显式 `blocked`
- 最新证据:
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-route -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-autocreate.md`
- Checklist: `CHK-21`
- Test Cases: `TC-054`

## TKT-66 Governed Mailbox Auto-Advance

- 状态: `done`
- 优先级: `P1`
- 目标: 把 governed route 从“能一键起单”推进到“当前一棒完成后能继续自动前滚”，减少 reviewer/tester 链路中的重复 closeout + recreate 摩擦。
- 范围:
  - `POST /v1/mailbox/:id` governed auto-advance contract
  - `/mailbox` acknowledged handoff `Complete + Auto-Advance`
  - Inbox mailbox ledger `Complete + Auto-Advance`
  - same-truth governed followup replay
- 依赖: `TKT-64` `TKT-65`
- Done When:
  - acknowledged handoff 在完成时允许显式请求 `continueGovernedRoute`
  - 若下一条 governed lane 已映射合法 default agent，则 server 会自动创建 followup handoff，而不是要求前端串两次 mutation
  - `/mailbox` 与 Inbox compose 会一起切到 followup handoff 的 `active`，并维持同一条 focus backlink
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-auto-advance -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-auto-advance.md`
- Checklist: `CHK-21`
- Test Cases: `TC-055`

## TKT-67 Governed Closeout / Delivery Entry Bridge

- 状态: `done`
- 优先级: `P1`
- 目标: 让 final lane 的 governed closeout 不再只停在 mailbox 文案，而是显式回链到 PR delivery entry，并把 closeout note 带进 operator handoff note / evidence。
- 范围:
  - `workspace.governance.routingPolicy.suggestedHandoff` final-lane done href
  - `/mailbox` / Inbox compose closeout backlink
  - PR delivery handoff note governed closeout sync
  - PR delivery evidence governed closeout item
- 依赖: `TKT-66` `TKT-49`
- Done When:
  - final lane handoff 完成后，governed suggestion 会切到 `done` 并给出 delivery entry closeout 回链
  - `/mailbox` 与 Inbox compose 都能直接从 governed surface 打开同一条 PR delivery entry
  - PR detail 的 operator handoff note 与 evidence 会显式包含最新 governed closeout note，而不是继续只读 review / quota / notification
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-closeout -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-closeout.md`
- Checklist: `CHK-21`
- Test Cases: `TC-056`

## TKT-68 Governed Delivery Delegation Signal

- 状态: `done`
- 优先级: `P1`
- 目标: 让 final lane closeout 不只回链 PR delivery entry，还要显式派生最终 delivery delegate，并把这条委派信号写进 PR detail / related inbox truth。
- 范围:
  - `PullRequestDeliveryEntry.delegation` contract
  - final closeout -> delivery delegate topology fallback
  - PR detail `Delivery Delegation` card
  - PR-related inbox delegation signal / backlink
- 依赖: `TKT-67` `TKT-36`
- Done When:
  - final QA closeout 后，delivery entry 会显式给出 `delegate ready|blocked|done` 的 delegation truth，而不是只停在 closeout backlink
  - 委派目标会优先取 publish/closeout lane，缺省时回退到 owner/final-response lane；默认 dev-team 会回到 `PM / Spec Captain`
  - related inbox 会出现 deterministic delivery delegation signal，并回链到同一条 PR detail
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegation -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegation.md`
- Checklist: `CHK-21`
- Test Cases: `TC-057`

## TKT-69 Delegated Closeout Handoff Auto-Create

- 状态: `done`
- 优先级: `P1`
- 目标: 让 final QA closeout 后的 delivery delegate 不只停在 signal，而是自动生成一条独立的 formal closeout handoff，并从 PR detail 直接回链到这条 handoff。
- 范围:
  - delivery-closeout handoff kind
  - final closeout -> delegated handoff auto-create
  - missing delegate agent auto-materialization
  - PR detail delegation handoff status / deep link
- 依赖: `TKT-68` `TKT-35`
- Done When:
  - final QA closeout 后，系统会自动创建 `final verifier -> delivery delegate` 的 formal closeout handoff，而不是只停在 `delegate ready`
  - delegated handoff 不会把 governed route 的 done-state closeout 回链冲回 active；governance truth 与 closeout orchestration 保持解耦
  - PR detail 的 `Delivery Delegation` card 会显式显示 handoff status，并能深链到对应 Inbox / Mailbox handoff
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-handoff -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-handoff.md`
- Checklist: `CHK-21`
- Test Cases: `TC-058`

## TKT-70 Delegated Closeout Lifecycle Sync

- 状态: `done`
- 优先级: `P1`
- 目标: 让 delegated closeout handoff 的 `requested -> blocked -> completed` 生命周期，不只停留在 Mailbox ledger，而要即时回写到 PR detail delegation card 和 deterministic related inbox signal。
- 范围:
  - delegated closeout handoff lifecycle -> delivery delegation sync
  - PR detail `Delivery Delegation` blocked / completed state
  - deterministic delegation inbox signal blocker note / completed status sync
  - governance done-state isolation during delegated closeout lifecycle
- 依赖: `TKT-69` `TKT-68`
- Done When:
  - delegated closeout handoff 进入 `blocked` 后，PR detail 的 delegation card 会立即切到 `delegate blocked`，并把 blocker note 同步回 related inbox signal
  - delegated closeout handoff 重新 acknowledge 并 `completed` 后，PR detail 会切到 `delegation done` / `handoff completed`
  - 整个 delegated closeout lifecycle 不会把 governed route 的 final-lane done-state closeout 错误冲回 active
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-lifecycle -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-lifecycle.md`
- Checklist: `CHK-21`
- Test Cases: `TC-059`

## TKT-71 Delivery Delegation Automation Policy

- 状态: `done`
- 优先级: `P1`
- 目标: 把 final lane closeout 之后的 delivery delegate 自动化策略做成正式 workspace governance 配置，而不是把“永远自动起 delegated handoff”写死在代码里。
- 范围:
  - workspace governance `formal-handoff / signal-only` delivery delegation mode
  - `/settings` delivery delegation policy editor / durable truth
  - signal-only policy -> PR detail delegation signal without auto-created closeout handoff
  - Mailbox / related inbox policy-aligned closeout behavior
- 依赖: `TKT-68` `TKT-69` `TKT-70`
- Done When:
  - workspace governance 支持 `formal-handoff` 与 `signal-only` 两种 delivery delegation automation policy，并能持久化恢复
  - `signal-only` 模式下，final QA closeout 后 PR detail 仍会给出 `Delivery Delegation` card 和 related inbox signal，但不会自动创建 `delivery-closeout` handoff
  - `/settings`、PR detail 和 Mailbox 会读取同一份 policy truth，而不是出现某页改了、某页继续按旧默认运行的分裂
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-policy -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-policy.md`
- Checklist: `CHK-21`
- Test Cases: `TC-060`

## TKT-72 Delivery Delegation Auto-Complete Policy

- 状态: `done`
- 优先级: `P1`
- 目标: 把 final lane closeout 之后更重的 auto-closeout 策略做成正式 workspace governance 配置，让 delivery delegate 可以被直接自动收口，而不是只能在 `formal-handoff / signal-only` 两档之间二选一。
- 范围:
  - workspace governance `auto-complete` delivery delegation mode
  - auto-complete policy -> PR detail `delegation done` truth
  - related inbox signal auto-closeout sync
  - `/settings` durable policy readback without delegated handoff materialization
- 依赖: `TKT-68` `TKT-71`
- Done When:
  - workspace governance 支持 `auto-complete` delivery delegation automation policy，并能持久化恢复
  - `auto-complete` 模式下，final QA closeout 后 PR detail 会直接把 `Delivery Delegation` 收成 `delegation done`，而不是额外创建 `delivery-closeout` handoff
  - related inbox、PR detail 和 `/settings` 会读取同一份 auto-closeout policy truth，Mailbox 里也不会偷偷物化 delegated closeout handoff
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-auto-complete -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-auto-complete.md`
- Checklist: `CHK-21`
- Test Cases: `TC-061`

## TKT-73 Delegated Closeout Comment Sync

- 状态: `done`
- 优先级: `P1`
- 目标: 把 delegated closeout handoff 上的 formal comment 从“只留在 Mailbox card”推进成正式 delivery contract，让 source / target 的最新 closeout 沟通能同步回 PR detail 与 related inbox。
- 范围:
  - delegated closeout latest formal comment -> PR detail delegation summary
  - related inbox latest-comment sync
  - source / target dual-comment closeout coverage
  - lifecycle preservation during comment sync
- 依赖: `TKT-69` `TKT-70`
- Done When:
  - delegated closeout handoff 上的 source / target formal comment 会同步回 PR detail `Delivery Delegation` summary
  - related inbox signal 会同步带回最新 delegated closeout formal comment，而不是继续只显示旧 summary
  - comment sync 不会把 delegated handoff 的 `requested / blocked / completed` lifecycle 偷偷改坏
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-comment-sync -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-comment-sync.md`
- Checklist: `CHK-21`
- Test Cases: `TC-062`

## TKT-74 Delegated Closeout Response Handoff Orchestration

- 状态: `done`
- 优先级: `P1`
- 目标: 当 delegated closeout handoff 被 target `blocked` 时，把 unblock work 明确物化成一条回给 source 的 formal response handoff，而不是只把 blocker note 留在原 handoff 文案里。
- 范围:
  - `delivery-reply` handoff kind / parent linkage
  - blocked delegated closeout -> response handoff auto-create
  - PR detail `Delivery Delegation` response status / deep link
  - governance done-state isolation during delegated response lifecycle
- 依赖: `TKT-69` `TKT-70` `TKT-73`
- Done When:
  - delegated closeout handoff 进入 `blocked` 后，系统会自动创建 `target -> source` 的 `delivery-reply` formal handoff，并保留 parent linkage
  - PR detail 的 `Delivery Delegation` card 会显式显示 `reply requested / reply completed` 与 response deep link
  - source 完成 unblock response 后，原 delegated closeout handoff 仍保持 `blocked`，直到 target 显式重新 acknowledge，而不是被 response completion 偷偷改成 done
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-response -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-response.md`
- Checklist: `CHK-21`
- Test Cases: `TC-063`

## TKT-75 Delegated Closeout Retry Attempt Truth

- 状态: `done`
- 优先级: `P1`
- 目标: 把 delegated closeout 的第二轮及后续 retry attempt 收成正式产品真相，让人类能明确看到当前是第几轮 unblock response，而不是只能靠历史 ledger 自己数。
- 范围:
  - delegated response retry attempt counting
  - latest retry handoff deep-link rollover
  - PR detail `reply xN` visibility
  - retry-attempt summary sync back to related delivery contract
- 依赖: `TKT-74`
- Done When:
  - delegated closeout 发生第二轮及后续 `blocked -> response -> re-ack -> blocked` 时，系统会自动创建新的 `delivery-reply` handoff，而不是复用旧 response ledger
  - PR detail 的 `Delivery Delegation` card 会显式显示 `reply xN` 这类 retry attempt truth，并始终 deep-link 到最新一轮 response handoff
  - 第二轮 response 完成后，主 delegated closeout handoff 仍保持 blocked，直到 target 重新 acknowledge，retry visibility 不会偷偷篡改主 lifecycle
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-retry -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-retry.md`
- Checklist: `CHK-21`
- Test Cases: `TC-064`

## TKT-76 Delegated Response Comment Sync

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `delivery-reply` response handoff 上的 formal comment 也纳入同一条 delivery contract，让 source / target 的 unblock 沟通不只留在 response ledger 局部卡片里。
- 范围:
  - response handoff latest formal comment -> PR detail delegation summary
  - related inbox latest response-comment sync
  - source / target dual-comment response coverage
  - response lifecycle preservation during comment sync
- 依赖: `TKT-74` `TKT-75`
- Done When:
  - `delivery-reply` response handoff 上的 source / target formal comment 会同步回 PR detail `Delivery Delegation` summary
  - related inbox signal 会同步带回最新 response formal comment，而不是继续停在旧 unblock summary
  - response comment sync 不会把 `reply requested` lifecycle 偷偷改坏
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-response-comment-sync -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-response-comment-sync.md`
- Checklist: `CHK-21`
- Test Cases: `TC-065`

## TKT-77 Delegated Response Resume Signal

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `delivery-reply` 的 response progress 继续回推到父级 delegated closeout handoff 本身，让 target 不必只盯 PR detail，也能在 Mailbox / Inbox / run next action 里看到“source 已回复，轮到你 re-ack”的明确恢复信号。
- 范围:
  - response progress -> parent delegated handoff last-action sync
  - parent handoff inbox latest-response summary
  - run/session next-action resume guidance
  - parent blocked lifecycle preservation during response sync
- 依赖: `TKT-74` `TKT-75` `TKT-76`
- Done When:
  - `delivery-reply` response comment / completion 会直接回推父级 delegated closeout handoff 的 latest action，而不是只写在 child ledger 或 PR detail
  - 父级 handoff 自己的 inbox signal 会明确写回 blocker + latest unblock response，target 打开 Inbox 就能知道何时重新 acknowledge 主 closeout
  - run/session next action 也会切到同一条 resume guidance，同时父级 delegated closeout 继续保持 `blocked`，直到 target 显式 re-ack
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-resume -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-resume.md`
- Checklist: `CHK-21`
- Test Cases: `TC-066`

## TKT-78 Delegated Response Mailbox Visibility

- 状态: `done`
- 优先级: `P1`
- 目标: 把 delegated closeout 和 `delivery-reply` 的 parent/child orchestration 直接做进 Mailbox 壳层，不让用户必须切去 PR detail 才能看懂 reply 进度和回链。
- 范围:
  - parent delegated closeout mailbox reply-status chip
  - `reply xN` attempt visibility inside mailbox
  - child `delivery-reply` parent chip + parent deep-link
  - parent blocked lifecycle preservation after response completion
- 依赖: `TKT-74` `TKT-75` `TKT-77`
- Done When:
  - 父级 delegated closeout handoff card 会直接显示 `reply requested / reply completed` 与 `reply xN`
  - child `delivery-reply` handoff card 会显式展示 parent closeout，并支持 `Open Parent Closeout`
  - response 完成后，回到父级 closeout card 仍能看到最新 reply 状态，而主 closeout 继续保持 `blocked`
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-visibility -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-visibility.md`
- Checklist: `CHK-21`
- Test Cases: `TC-067`

## TKT-79 Delegated Response Parent Resume Action

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 的完成态继续升级成可操作 orchestration，让 blocker agent 能直接从 child ledger 把父级 delegated closeout re-ack 回来，而不是再手动回找 parent card。
- 范围:
  - child `delivery-reply` resume-parent action
  - parent closeout re-ack from child ledger
  - response chip preservation after parent resume
  - common governed-route ready-state stabilization
- 依赖: `TKT-77` `TKT-78`
- Done When:
  - child `delivery-reply` 在 completed 且 parent closeout 仍 blocked 时，会出现 `Resume Parent Closeout`
  - 点击后父级 delegated closeout 会直接切到 `acknowledged`
  - parent closeout 被重新接住后，父级 card 仍保留 `reply completed`，不会把 response evidence 冲掉
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-resume-parent -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-resume-parent.md`
- Checklist: `CHK-21`
- Test Cases: `TC-068`

## TKT-80 Delegated Response History Sync After Parent Resume

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 带来的 unblock 历史继续保留到 parent re-ack / complete 之后，让 PR detail 和 related inbox 这条 single delivery contract 不会在 parent 恢复后把 reply 轨迹吞掉。
- 范围:
  - response history preservation after parent resume
  - response history preservation after parent complete
  - PR detail delegation summary sync
  - related inbox history sync
- 依赖: `TKT-79`
- Done When:
  - parent delegated closeout 被重新 `acknowledged` 后，PR detail `Delivery Delegation` summary 仍会显示 `第 N 轮 unblock response / reply xN` 历史
  - parent delegated closeout 最终 `completed` 后，related inbox signal 仍会带着这段 response 历史一起收口
  - response history 不再只留在 Mailbox parent card，而会同步留存在统一交付合同
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-history-sync -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-history-sync.md`
- Checklist: `CHK-21`
- Test Cases: `TC-069`

## TKT-81 Delivery Reply Parent Status Visibility

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 从“能回跳 parent”继续升级成“能直接看见 parent 现在到底 blocked / acknowledged / completed”，避免 source agent 每次都要离开 child ledger 才知道主 closeout 有没有真的被接住。
- 范围:
  - child response parent-status chip
  - parent blocked/acknowledged/completed visibility inside child ledger
  - live mailbox + inbox mailbox surface alignment
  - headed browser walkthrough for parent status replay
- 依赖: `TKT-79` `TKT-80`
- Done When:
  - child `delivery-reply` card 会直接显示 `parent blocked / parent acknowledged / parent completed`
  - parent closeout 被重新接住或最终完成后，child card 的 parent-status chip 会一起前滚
  - source agent 不需要离开 child ledger 也能读懂主 closeout 当前所处状态
- 最新证据:
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-parent-status -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-parent-status.md`
- Checklist: `CHK-21`
- Test Cases: `TC-070`

## TKT-82 Delegated Parent Surface Context Preservation

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 带来的 unblock 历史继续保留到 parent delegated closeout 自己的 Mailbox / handoff inbox / run-session context，不让 parent re-ack / complete 一下就退回抽象通用文案。
- 范围:
  - parent mailbox card response-history preservation
  - parent handoff inbox summary preservation after resume/completion
  - run next-action + session resume context preservation
  - Windows Chrome walkthrough for parent surfaces
- 依赖: `TKT-80` `TKT-81`
- Done When:
  - parent delegated closeout 被重新 `acknowledged` 后，parent Mailbox card 会继续显示 `第 N 轮 unblock response` 历史
  - Run detail 的 `下一步` 与 session / resume context 仍会保留这段历史，而不是退回抽象 resume 文案
  - parent delegated closeout 最终 `completed` 后，这些 parent surfaces 会带着 history 一起收口
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-parent-context -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-parent-context.md`
- Checklist: `CHK-21`
- Test Cases: `TC-071`

## TKT-83 Delivery Reply Child Context Sync

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 从“chip 能看到 parent 进度”继续升级成“正文和 child inbox signal 也跟着 parent 前滚”，避免 source agent 看到已更新的 parent status，却还读到过期的旧说明。
- 范围:
  - child response `lastAction` sync after parent resume/completion
  - child handoff inbox summary sync after parent follow-through
  - parent-status chip + child body consistency
  - Windows Chrome walkthrough for child ledger context replay
- 依赖: `TKT-81` `TKT-82`
- Done When:
  - child `delivery-reply` 在 parent 重新 `acknowledged` 后，`lastAction` 会同步切到 parent acknowledged 的真实上下文
  - parent 最终 `completed` 后，child card 的正文与 child inbox summary 会继续前滚到 parent completed，而不是停在旧的 unblock response 文案
  - source agent 在 child ledger 内即可同时读到 parent status 与 parent follow-through 的正文真相
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-child-context -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-child-context.md`
- Checklist: `CHK-21`
- Test Cases: `TC-072`

## TKT-84 Delivery Reply Parent Progress Timeline

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 的 parent follow-through 从“卡片摘要知道了”继续升级成“child ledger 时间线里也明确可回放”，并保证这些后续 lifecycle event 不会把 PR detail 里的 latest formal comment 洗掉。
- 范围:
  - child response lifecycle `parent-progress` messages after parent resume/completion
  - latest formal comment preservation across response complete + parent follow-through
  - child ledger timeline + PR detail consistency
  - Windows Chrome walkthrough for child timeline replay
- 依赖: `TKT-76` `TKT-83`
- Done When:
  - parent 重新 `acknowledged` / `completed` 后，child `delivery-reply` 的 lifecycle messages 会显式新增 `parent-progress` entry
  - source agent 深看 child ledger 历史时，能直接看到 parent follow-through 事件，而不只是一段被改写过的卡片摘要
  - PR detail `Delivery Delegation` summary 会继续保留最新 formal comment，不会因为新的 lifecycle event 被回退成“没有 comment 的版本”
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -run "TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff|TestDelegatedCloseoutCommentsSyncToDeliveryContract|TestDelegatedCloseoutHandoffLifecycleReflectsInPullRequestDetail|TestDelegatedResponseCommentsReflectInPullRequestDetail" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-child-timeline -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-child-timeline.md`
- Checklist: `CHK-21`
- Test Cases: `TC-073`

## TKT-85 Delegated Parent Response Timeline

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 的 formal comment / response complete 正式写进 parent delegated closeout 自己的 lifecycle messages，而不是只更新 parent `lastAction`。target 深看 parent ledger 时，必须能回放 child response 轨迹。
- 范围:
  - parent delegated closeout `response-progress` timeline messages
  - parent ledger preservation after parent resume/completion
  - live mailbox + inbox mailbox timeline label alignment
  - Windows Chrome walkthrough for parent timeline replay
- 依赖: `TKT-77` `TKT-82` `TKT-84`
- Done When:
  - child `delivery-reply` 的 formal comment 和 response complete 会在 parent delegated closeout 自己的 lifecycle messages 里显式新增 `response-progress` entry
  - parent 自己后续重新 `acknowledged` / `completed` 后，这些 child-response timeline entry 仍会保留在 parent ledger 历史里
  - target 打开 parent card 时，可以直接从 parent timeline 回放 child response 的关键节点，而不只依赖一条会被后续动作覆盖的 `lastAction`
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -run "TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff|TestDelegatedCloseoutHandoffLifecycleReflectsInPullRequestDetail|TestDelegatedResponseProgressReflectsInParentMailboxAndRun|TestDelegatedResponseCommentsReflectInPullRequestDetail" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-parent-timeline -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-parent-timeline.md`
- Checklist: `CHK-21`
- Test Cases: `TC-074`

## TKT-86 Delegated Response Room Trace Sync

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 对 parent delegated closeout 的关键 progress，从 Mailbox / PR / Inbox 再推进到 Room 主消息流，让房间里直接可回放“child 已回复、parent 现在该怎么接”的 orchestration 叙事。
- 范围:
  - parent-synced child response progress -> room main trace writeback
  - `[Mailbox Sync]` narration for response comment / response complete
  - room-history preservation across comment + completion sync
  - Windows Chrome walkthrough for room chat replay
- 依赖: `TKT-77` `TKT-85`
- Done When:
  - child `delivery-reply` 的 formal comment 会在 Room 主消息流里追加一条 `[Mailbox Sync]` 叙事，明确 parent closeout 已收到这轮 unblock context
  - child `delivery-reply` 完成后，Room 主消息流会继续写出同步后的 completion guidance，而不只留在 Mailbox / PR / Inbox
  - Room 历史里会同时保留 comment sync 和 completion sync 两条记录，跨 Agent closeout 的关键轨迹不再只藏在局部 ledger
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -run "TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff|TestDelegatedResponseProgressReflectsInParentMailboxAndRun" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-room-trace -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-room-trace.md`
- Checklist: `CHK-21`
- Test Cases: `TC-075`

## TKT-87 Delegated Blocked Response Room Trace

- 状态: `done`
- 优先级: `P1`
- 目标: 把 child `delivery-reply` 自己再次 `blocked` 的状态，也正式写回 Room 主消息流，让房间里可以直接看到 unblock 链本身又被卡住，而不是只在 Mailbox / PR / Inbox 留下一层隐蔽阻塞。
- 范围:
  - blocked child response -> room main trace writeback
  - `[Mailbox Sync]` narration for response blocked
  - blocked response blocker note + parent blocked guidance preservation
  - Windows Chrome walkthrough for blocked response room replay
- 依赖: `TKT-74` `TKT-86`
- Done When:
  - child `delivery-reply` 如果再次进入 `blocked`，Room 主消息流会追加一条 `[Mailbox Sync]` 阻塞叙事
  - 这条 room trace 会保留 child blocker note，并明确写出“当前也 blocked / 主 closeout 继续保持 blocked”的 parent guidance
  - 房间里不再只回放乐观的 comment / completion sync；二次阻塞同样属于正式 orchestration truth
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store ./internal/api -run "TestDeliveryDelegationBlockedResponseSyncsIntoParentRoomTrace|TestDelegatedBlockedResponseReflectsInParentRoomTrace" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-room-trace-blocked -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-room-trace-blocked.md`
- Checklist: `CHK-21`
- Test Cases: `TC-076`

## TKT-88 Shell Profile Hub Entry

- 状态: `done`
- 优先级: `P1`
- 目标: 把当前 `Human / Machine / Agent` 收成 app.slock.ai 式壳层 footer profile hub，不再要求用户绕到右栏 summary 或独立列表页找 profile 入口。
- 范围:
  - sidebar footer `Profile Hub`
  - current human / paired machine / preferred agent selection
  - unified profile drill-in from shell footer
  - Windows Chrome walkthrough + room-context regression
- 依赖: `TKT-25`
- Done When:
  - sidebar footer 会常驻显示当前 `Human / Machine / Agent` 三个 profile entry
  - 三个 entry 都会进入统一 profile surface，而不是跳到分裂详情页
  - room context drill-in 不回退，shell / room 会共享同一份 live profile truth
- 最新证据:
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-profile-surface -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-shell-profile-hub.md`
- Checklist: `CHK-16`
- Test Cases: `TC-077`

## TKT-89 PR Detail Delivery Collaboration Thread

- 状态: `done`
- 优先级: `P1`
- 目标: 把 parent `delivery-closeout` 与 child `delivery-reply` 的 formal request / blocker / comment / progress 收成同一条 PR detail timeline，不再只剩一段不断被覆盖的 delegation summary。
- 范围:
  - `PullRequestDeliveryDelegation.communication` contract
  - parent / child mailbox message aggregation
  - PR detail `Delivery Collaboration Thread` 面板
  - chronological ordering with precise mailbox event timestamps
  - Windows Chrome walkthrough + report
- 依赖: `TKT-76` `TKT-80` `TKT-85`
- Done When:
  - PR detail 会新增 `Delivery Collaboration Thread`
  - parent closeout 与 child reply 的 formal request / blocker / comment / progress 会按真实时间顺序同屏显示
  - 每条 thread entry 都能 deep-link 回对应 Mailbox handoff，而不是只停在 PR summary
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestDeliveryDelegationCommunicationThreadAggregatesParentAndReplyMessages" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestDeliveryDelegationCommunicationThreadRoute" -count=1'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-communication-thread -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-communication-thread.md`
- Checklist: `CHK-21`
- Test Cases: `TC-078`

## TKT-90 PR Detail Delivery Thread Actions

- 状态: `done`
- 优先级: `P1`
- 目标: 把 PR detail 里的 `Delivery Collaboration Thread` 从只读回放推进成正式 action surface，让当前 delegated closeout / `delivery-reply` 能直接在 PR 页执行。
- 范围:
  - PR detail `Thread Actions` 面板
  - current parent / child mailbox handoff lookup
  - inline `acknowledged / blocked / comment / completed` mutation
  - child reply complete 后的 `Resume Parent Closeout`
  - Windows Chrome walkthrough + report
- 依赖: `TKT-79` `TKT-89`
- Done When:
  - PR detail 会直接显示当前 active parent / child handoff action card，而不必先跳去 Mailbox
  - parent closeout 与 child reply 都能在 PR detail 内直接做 formal ack / block / comment / complete
  - child response 完成后，用户能同页 `Resume Parent Closeout`，并看到 parent status 刷新到最新 mailbox truth
- 最新证据:
  - `pnpm --dir apps/web typecheck`
  - `bash -lc 'cd apps/web && pnpm exec eslint src/components/pull-request-detail-view.tsx'`
  - `pnpm verify:web`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-delegate-thread-actions -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-thread-actions.md`
- Checklist: `CHK-21`
- Test Cases: `TC-079`

## TKT-91 Mailbox Batch Queue

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `/mailbox` 从单卡逐条操作推进到当前 room ledger 的多选批量处理面，让 open handoff 能用同一条 batch queue 顺序完成 `acknowledged / comment / completed`。
- 范围:
  - `/mailbox` live ledger 的 multi-select state
  - batch selected chips / note / actor mode surface
  - sequential `updateHandoff` bulk replay
  - selection auto-clear after closeout
  - Windows Chrome walkthrough + report
- 依赖: `TKT-63` `TKT-64` `TKT-90`
- Done When:
  - `/mailbox` 会出现 `Batch Queue`，并能围当前可见 open handoff 做多选
  - batch `acknowledged / comment / completed` 会顺序落到每条 selected handoff，而不是只做前端假状态
  - handoff complete 后 selection 会自动清空，closeout note 与 inbox summary 会跟随正式 ledger 前滚
- 最新证据:
  - `pnpm --dir apps/web typecheck`
  - `bash -lc 'cd apps/web && pnpm exec eslint src/components/live-mailbox-views.tsx src/components/stitch-board-inbox-views.tsx'`
  - `node --check scripts/headed-mailbox-batch-actions.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-mailbox-batch-actions -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-batch-queue.md`
- Checklist: `CHK-21`
- Test Cases: `TC-080`

## TKT-92 Governance Escalation Queue

- 状态: `done`
- 优先级: `P1`
- 目标: 把 workspace governance 的 escalation 从抽象 SLA summary 推进成正式 queue truth，让 active handoff 与 blocked inbox signal 能以同一条队列 entry 出现在 `/mailbox` 与 `/agents`。
- 范围:
  - `workspace.governance.escalationSla.queue` contract
  - handoff / blocked inbox -> queue entry 派生
  - `/mailbox` governance escalation queue panel
  - `/agents` orchestration governance queue mirror
  - Windows Chrome walkthrough + report
- 依赖: `TKT-61` `TKT-63` `TKT-64` `TKT-91`
- Done When:
  - governance escalation 不再只显示 aggregate counter，而是有正式 queue entry truth
  - active handoff 与 blocked inbox signal 都会以 `label / source / owner / next-step / deep-link` 出现在队列里
  - `/mailbox` 与 `/agents` 会镜像同一份 escalation queue，handoff closeout 后队列自动清空
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMailboxLifecycleHydratesWorkspaceGovernance" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestStateRouteExposesGovernanceSnapshot|TestMailboxLifecycleUpdatesGovernanceSnapshot" -count=1'`
  - `pnpm --dir apps/web typecheck`
  - `bash -lc 'cd apps/web && pnpm exec eslint src/components/live-mailbox-views.tsx src/components/live-orchestration-views.tsx src/lib/phase-zero-helpers.ts src/lib/live-phase0.ts src/lib/phase-zero-types.ts'`
  - `node --check scripts/headed-governance-escalation-queue.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governance-escalation-queue -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-queue.md`
- Checklist: `CHK-21`
- Test Cases: `TC-081`

## TKT-93 Governance Escalation Room Rollup

- 状态: `done`
- 优先级: `P1`
- 目标: 把 governance escalation 从“当前焦点 queue”继续前滚到“整个 workspace 的 room-level rollup”，让人类一眼看见哪些 room blocked、哪些 room 仍 active。
- 范围:
  - `workspace.governance.escalationSla.rollup` contract
  - mailbox / inbox blocker -> room-level aggregation
  - `/mailbox` cross-room escalation rollup panel
  - `/agents` orchestration rollup mirror
  - Windows Chrome walkthrough + report
- 依赖: `TKT-92`
- Done When:
  - governance escalation 除了当前焦点 queue，还会给出整个 workspace 的 hot-room rollup
  - blocked room 与 active room 会同时出现在 rollup，并带出 `room / status / count / latest escalation / deep-link`
  - `/mailbox` 与 `/agents` 会镜像同一份 rollup truth；room closeout 后 rollup 自动回退到 baseline
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMailboxLifecycleHydratesWorkspaceGovernance" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestStateRouteExposesGovernanceSnapshot|TestMailboxLifecycleUpdatesGovernanceSnapshot" -count=1'`
  - `pnpm verify:web`
  - `node --check scripts/headed-governance-escalation-rollup.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governance-escalation-rollup -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-rollup.md`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governance-escalation-queue -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-queue.md`
- Checklist: `CHK-21`
- Test Cases: `TC-082`

## TKT-94 Mailbox Governed Batch Policy

- 状态: `done`
- 优先级: `P1`
- 目标: 把 `/mailbox` 的 batch queue 从“能批量 closeout”推进到“能按治理 policy 批量续下一棒”，让 pure governed selection 直接做 bulk `Complete + Auto-Advance`。
- 范围:
  - create handoff `kind=governed` contract
  - `/mailbox` `Governed Batch Policy` 面板
  - bulk `completed + continueGovernedRoute` orchestration
  - Windows Chrome walkthrough + batch queue regression
- 依赖: `TKT-64` `TKT-91`
- Done When:
  - `Create Governed Handoff` 会把 `kind=governed` 写进正式 mailbox contract，而不是落成 manual handoff
  - pure governed selection 会显示正式 policy 状态，并在可 complete 时开放 `Batch Complete + Auto-Advance`
  - bulk closeout 后只会物化一条 next-lane followup handoff，selection 自动清空，routing policy 聚焦到 followup
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMailboxRoutesCreateAndListLiveTruth|TestMailboxRoutesAdvanceLifecycleAndGuardrails" -count=1'`
  - `pnpm verify:web`
  - `node --check scripts/headed-mailbox-batch-policy.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-mailbox-batch-policy -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-batch-policy.md`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-mailbox-batch-actions -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-batch-queue.md`
- Checklist: `CHK-21`
- Test Cases: `TC-083`

## TKT-95 Cross-Room Governance Orchestration

- 状态: `done`
- 优先级: `P1`
- 目标: 把 cross-room governance 从“能看见哪些 room 在冒烟”推进到“能直接从 hot room 上发起下一棒 governed handoff”，让 `/mailbox` rollup 成为真正可执行的跨 room 治理面。
- 范围:
  - `workspace.governance.escalationSla.rollup` room-level route metadata
  - `POST /v1/mailbox/governed`
  - `/mailbox` cross-room rollup `Create Governed Handoff`
  - `/agents` orchestration rollup route mirror
  - Windows Chrome walkthrough + report
- 依赖: `TKT-93` `TKT-94`
- Done When:
  - cross-room rollup 不只显示 `room / status / count / latest escalation`，还会给出 `current owner / current lane / next governed route`
  - `/mailbox` 能对 `nextRouteStatus=ready` 的 room 直接发起 room-level governed handoff，而不是逼用户先切回当前 room compose
  - create 后 `/mailbox` 与 `/agents` 都会把 room-level route 从 `ready` 前滚到 `active`，并 deep-link 到新 handoff
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestCreateGovernedHandoffForRoomUsesRoomSpecificSuggestion|TestAdvanceHandoffCanAutoAdvanceGovernedRoute|TestMailboxLifecycleHydratesWorkspaceGovernance" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMailboxRoutesCreateGovernedHandoffForRoom|TestMailboxRoutesCreateAndListLiveTruth|TestStateRouteExposesGovernanceSnapshot|TestMailboxLifecycleUpdatesGovernanceSnapshot" -count=1'`
  - `pnpm verify:web`
  - `node --check scripts/headed-cross-room-governance-orchestration.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-cross-room-governance-orchestration -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-cross-room-governance-orchestration.md`
- Checklist: `CHK-21`
- Test Cases: `TC-084`

## TKT-96 Memory Provider Orchestration

- 状态: `done`
- 优先级: `P1`
- 目标: 把 memory provider 从 PRD 概念推进成正式产品真相，让 `workspace-file / search-sidecar / external-persistent` 的 binding、scope、retention 和 degraded fallback 能被同页编辑并进入 next-run preview。
- 范围:
  - `memory-center.json` provider binding durable state
  - `GET/POST /v1/memory-center/providers`
  - `/memory` provider orchestration editor
  - next-run preview / prompt summary provider projection
  - Windows Chrome walkthrough + report
- 依赖: `TKT-12` `TKT-37` `TKT-42` `TKT-43`
- Done When:
  - `/memory` 能读写 `workspace-file / search-sidecar / external-persistent` provider binding truth，而不是只在文档里提及 provider
  - next-run preview 不只显示 mounted files / tools，还要显式显示 active providers、scope、retention 和 degraded fallback
  - provider enabled/status 在 reload 后保持一致，并有 store / API tests + Windows Chrome evidence
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMemoryCenterBuildsInjectionPreviewAndPromotionLifecycle|TestMemoryCleanupPrunesStaleQueueAndKeepsPromotionPathLive|TestMemoryProviderBindingsPersistAndAnnotatePromptSummary" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMemoryCenterRoutesExposePolicyPreviewAndPromotionLifecycle|TestMemoryCenterCleanupRoutePrunesQueueAndKeepsPromotionFlowLive|TestMemoryCenterProviderRoutesExposeDurableProviderBindings|TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces" -count=1'`
  - `pnpm verify:web`
  - `node --check scripts/headed-memory-provider-orchestration.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-memory-provider-orchestration -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-memory-provider-orchestration.md`
- Checklist: `CHK-10` `CHK-22`
- Test Cases: `TC-085`

## TKT-97 Memory Provider Health Recovery

- 状态: `done`
- 优先级: `P1`
- 目标: 把 memory provider 从“静态 binding”推进成有真实 health / recovery 生命周期的产品面，让 `workspace-file / search-sidecar / external-persistent` 都能显式检查、恢复、记账并持久化。
- 范围:
  - provider health observation / next-action truth
  - `POST /v1/memory-center/providers/check`
  - `POST /v1/memory-center/providers/:id/recover`
  - `/memory` provider health summary、failure count、activity timeline、manual recovery actions
  - Windows Chrome walkthrough + report
- 依赖: `TKT-96`
- Done When:
  - provider 不再在缺少 index / adapter stub / workspace scaffold 时假装健康
  - `/memory` 能逐 provider 执行 health check 和 recovery，并把结果写回 durable `memory-center.json`
  - next-run preview / prompt summary 会显示恢复后的 provider health truth
  - store / API tests、`verify:web`、script syntax 和 Windows Chrome evidence 全部通过
- 最新证据:
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMemoryProviderBindingsPersistAndAnnotatePromptSummary|TestMemoryProviderHealthCheckAndRecoveryLifecycle" -count=1'`
  - `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMemoryCenterProviderRoutesExposeDurableProviderBindings|TestMemoryCenterProviderHealthRoutesRecoverDurableBindings|TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces" -count=1'`
  - `pnpm verify:web`
  - `node --check scripts/headed-memory-provider-health-recovery.mjs`
  - `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-memory-provider-health-recovery -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-memory-provider-health-recovery.md`
- Checklist: `CHK-10` `CHK-22`
- Test Cases: `TC-086`

## TKT-98 Persistent Session Workspace Envelope

- 状态: `done`
- 优先级: `P0`
- 目标: 把 daemon 执行从“只跑一次命令”推进到“每个 session 都有可复用的本地工作区锚点”，让 turn continuity、文件级记忆与恢复链开始落到真实文件上。
- 范围:
  - daemon runtime session workspace root
  - `MEMORY.md / SESSION.json / CURRENT_TURN.md / notes/work-log.md`
  - `OPENSHOCK_AGENT_SESSION_ROOT` override
  - runtime/service 单测
  - daemon exec route 回归
- 依赖: `TKT-13` `TKT-14`
- Done When:
  - 同一 `sessionId` 的多轮执行会复用同一个 daemon-managed 目录
  - 每轮执行都会刷新 `CURRENT_TURN.md`
  - `notes/work-log.md` 会累积多轮 turn 记录，而不是只保留最后一轮
  - `SESSION.json` 会固定暴露 `sessionId / runId / roomId / provider / cwd / appServerThreadId`
  - daemon `/v1/exec` 路由回归能证明这层 envelope 真实落盘
- 最新证据:
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./internal/runtime -run "TestRunPromptPersistsSessionWorkspaceEnvelope|TestStreamPromptRefreshesCurrentTurnAndAccumulatesWorkLog|TestRunPromptSessionWorkspaceRootRespectsEnvOverride" -count=1'`
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./internal/api -run "TestExecRoutePersistsSessionWorkspaceEnvelope|TestExecConflictGuardRejectsSameCwdAndAllowsDifferentCwd|TestExecConflictGuardAllowsReentrantReuseForSameLease" -count=1'`
- Checklist: `CHK-10` `CHK-14`
- Test Cases: `TC-093`

## TKT-99 Local-First Provider Thread Continuity

- 状态: `done`
- 优先级: `P0`
- 目标: 把 Codex resume continuity 做成 daemon 自己的本地真相，让 `resume --last` 只围当前 session 的本地 home 运作，而不是共享全局 CLI 状态。
- 范围:
  - session-scoped `OPENSHOCK_CODEX_HOME`
  - `SESSION.json.codexHome`
  - daemon restart 后的 local resume continuity
  - runtime / API 回归
- 依赖: `TKT-98`
- Done When:
  - 同一 `sessionId` 的 Codex 执行会稳定使用同一个 session-scoped `OPENSHOCK_CODEX_HOME`
  - daemon restart 后再 resume，仍会落回同一个 local home，而不是继续吃全局 `--last`
  - `SESSION.json` 会显式暴露 `codexHome`
- 最新证据:
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./internal/runtime -run "TestRunPromptUsesSessionScopedCodexHome|TestResumeSessionReusesSessionScopedCodexHomeAcrossRestart" -count=1'`
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./internal/api -run "TestExecRouteUsesSessionScopedCodexHome" -count=1'`
- Checklist: `CHK-10` `CHK-14` `CHK-15`
- Test Cases: `TC-094`

## TKT-100 Daemon Real-Process Continuity Harness

- 状态: `done`
- 优先级: `P1`
- 目标: 把多智能体协同、session continuity 与恢复链做成可重复的 daemon system harness，避免关键行为只靠零散 store/api 单测守着。
- 范围:
  - built daemon binary + real daemon subprocess
  - httptest control plane + fake Codex CLI
  - two-turn same-session reuse across daemon restart
  - `CURRENT_TURN.md` refresh、`notes/work-log.md` 累积与 `SESSION.json` continuity assertions
  - provider thread continuity reinjection proof
- 依赖: `TKT-98` `TKT-99` `TKT-102`
- Done When:
  - real daemon process 能稳定重放同一 session 的连续两轮 turn
  - daemon restart 后，同一 session 的 `codex-home`、`CURRENT_TURN.md`、`notes/work-log.md` 与 `appServerThreadId` continuity 都能在 system 级测试里被证明
  - heartbeat、exec bridge 与恢复链在同一 harness 里一起成立，后续恢复票默认接这套 harness
- 最新证据:
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test -tags=integration ./internal/integration -run TestDaemonContinuityHarnessAcrossRestart -count=1'`
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test -tags=integration ./internal/integration -count=1'`
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./... -count=1'`
- Checklist: `CHK-14` `CHK-15`
- Test Cases: `TC-095`

## TKT-101 Phase 0 Shell Subtractive Flow Sweep

- 状态: `active`
- 优先级: `P1`
- 目标: 持续把 chat-first 壳做减法，让常见路径更短、更顺，而不是靠堆更多 summary、tab、sheet 和提示文案解决复杂度。
- 范围:
  - room / inbox / run / governance surface 重复信息清理
  - 二级 sheet / action strip / helper copy 减法
  - message flow / follow-up action / hot path micro-friction 收敛
  - `open-shock-shell.tsx` chrome 层级减法
  - `stitch-chat-room-views.tsx` room 顶部重复 strip 与默认右栏信息量收敛
  - `run-control-surface.tsx` 默认动作块减法
  - `live-detail-views.tsx` topic/run 概览重复块压缩
  - 浏览器级 walkthrough 与对照截图
- 依赖: `TKT-16` `TKT-23` `TKT-88`
- Done When:
  - 房间主面、Inbox 和 run/governance 次级面不再重复展示同一条 owner/status/action truth
  - 首屏默认动作比当前更短，不靠阅读长解释才能继续推进
  - headed walkthrough 能证明主要路径点击次数和视觉干扰都下降
- 当前已收第一刀:
  - shared `RunControlSurface` 已压掉长解释段，改成状态摘要 + 权限信号，避免 room / topic / run 三处重复讲同一套控制说明
  - `/topics/:topicId` 已删除重复的 `topic-resume-context` 卡，避免同页继续入口、run snapshot 与 continuity truth 三次重复
  - headed verification scripts 已对齐当前控制真值，不再把“空草稿发送按钮可点击”当成错误前提
- 当前已收第二刀:
  - room `context` tab 已压成“当前焦点 + 待处理”，不再把 run / PR / 记忆 / timeline / guard / mailbox truth 在同一页重复铺开
  - `RoomWorkbenchRailSummary` 已把 `overview / delivery / system` 的重复双卡压回单卡表达，同时保住 `room-workbench-open-inbox`、`room-workbench-open-mailbox`、`room-workbench-pr-detail-link`、`room-workbench-run-status` 等稳定锚点
  - 房间右栏已补回 `room-workbench-machine-profile` 与 `room-workbench-active-agent-*`，保证减法后 agent / machine profile 仍能从房间工作面直接深链
- 当前已收第三刀:
  - `/mailbox` 的 cross-room governance rollup 已把 owner / current-lane / next-route 的解释收回 `GovernanceEscalationGraph` 主视图，rollup 列表卡只保留 room 热点、route 状态与动作入口
  - `mailbox-governance-escalation-rollup-*`、`mailbox-governance-escalation-graph-*` 与 `route-create` 锚点保持不变；减法后仍能继续 `ready -> active -> done` 的治理前滚
  - headed cross-room regression 已新增“rollup 卡不再重复 current-owner / next-route copy”断言，避免后续又把 graph 与列表卡的真相重新写两遍
- 当前已收第四刀:
  - `/inbox` 的 governed compose 已改成“自动建议优先、手动改写次级展开”；在 route 已可用时，首屏不再同时摊开自由表单与治理建议两套 source / target / title / summary truth
  - `mailbox-compose-governed-route*` 热路径保持不变，approval-center 的 `approval-center-action-*` 与 handoff ledger 的 `mailbox-card/status/action*` 也未受影响
  - headed governed-route regression 已新增“manual compose 默认收起，但可手动展开”断言，避免后续又把 inbox 首屏堆回长表单
- 当前已收第五刀:
  - `/agents` 的 cross-room governance rollup 已把 `current owner / current lane / next-route` 解释收回 `GovernanceEscalationGraph` 主视图，rollup 列表卡只保留 room 热点、双状态与 deep-link 动作入口
  - `orchestration-governance-escalation-rollup-*`、`orchestration-governance-escalation-graph-*`、`orchestration-governance-summary`、`orchestration-governance-human-override` 与 `orchestration-governance-response-aggregation` 锚点保持不变；减法后仍能继续读取同一份治理镜像真相
  - headed cross-room regression 已把 orchestration mirror 也锁进“rollup 卡不再重复 current-owner / next-route copy”断言，避免后续又把 graph 与列表卡的真相重新写两遍
- 当前已收第六刀:
  - `/agents` 的 `responseAggregation` 已删掉重复的 `决策路径 / 接管记录` 尾巴；回复聚合卡只保留 final response、summary、sources 与 audit trail，不再把已由 walkthrough / human override 主面持有的说明再写一遍
  - `/agents` 右栏独立 `协作规则` 卡组已删除；`handoffRules` 不再作为第二块 standalone 面板重复渲染，formal handoff / review / test / blocked / human override 的治理真相继续由 walkthrough、escalation queue、human override 与 response aggregation 主面持有
  - `orchestration-governance-human-override`、`orchestration-governance-response-aggregation`、`orchestration-governance-step-*` 与 orchestration planner queue 锚点保持不变；减法后 `/agents` 仍围同一份治理镜像前滚
  - headed planner replay 已新增“`responseAggregation` 不再重复 `决策路径 / 接管记录` 文案，且 routing rules 已存在时不再渲染第二块 standalone `协作规则` 面板”断言，避免后续又把说明尾巴和辅助规则卡组堆回治理镜像
- 当前已收第七刀:
  - `/agents` 的 walkthrough 卡组已删掉逐步 helper/detail copy，只保留步骤标题、当前摘要和状态，不再把 `Mailbox ledger` / `review verdict` / `final-response aggregation` 这类说明层再重复一遍
  - `orchestration-governance-step-*` 锚点保持不变；planner replay 仍能围 `issue / handoff` 当前摘要前滚，不需要额外 helper 文案才能理解当前治理状态
  - headed planner replay 已新增“walkthrough 不再渲染 handoff / review helper copy”断言，避免后续又把第二层说明堆回关键流程卡
- 当前已收第八刀:
  - `/agents` 的人工接管卡已删掉泛化 `打开接管链路` 动作；blocked 状态继续由 escalation queue 和 Inbox 持有主导航，不再在右栏再堆一层重复入口
  - `orchestration-governance-human-override` 锚点保持不变；planner replay 仍能围 `关注 / 需要处理` 状态前滚，不需要额外 open-link 才能表达当前治理状态
  - headed planner replay 已新增“human-override 不再渲染重复 open-link”断言，避免后续又把第二层人工接管入口堆回右栏
- 当前已收第九刀:
  - `/mailbox` 与 `/agents` 的 cross-room governance rollup 已删掉重复 `latestSummary` 和次级 `查看该讨论` 链接；列表卡继续只保留 room 热点、双状态与主推进动作，room 上下文与导航统一回到 `GovernanceEscalationGraph`
  - `mailbox-governance-escalation-rollup-room-*`、`orchestration-governance-escalation-rollup-room-*`、`...route-status-*`、`...graph-*` 与 `打开下一步` / `创建自动交接` 热路径保持不变；减法后 mailbox / agents 仍围同一份 cross-room governance truth 前滚
  - headed cross-room orchestration 已新增“rollup 卡不再重复 latest-summary，也不再渲染次级 room-link”断言，避免后续又把 graph 已持有的 room context / navigation 再堆回列表卡
- 当前已收第十刀:
  - `/agents` 的升级时限卡已删掉 `下一次升级` helper copy；升级节奏继续由 SLA 摘要和下方 escalation queue 持有，不再在卡头再写一层重复时间提示
  - `orchestration-governance-escalation-entry-*`、`orchestration-governance-escalation-status-*`、`协作规则和通知一页看清`、`升级时限`、`通知策略` 与 escalation queue 主体锚点保持不变；减法后 `/agents` 仍围同一份治理镜像前滚
  - headed escalation queue 已新增“升级时限卡不再渲染 `下一次升级：` helper copy”断言，避免后续又把 queue 已持有的升级真相重新堆回卡头
- 当前已收第十一刀:
  - `/inbox` 的 approval-center 桌面信号卡已删掉右侧重复 `打开详情` 链接；在 `Room / Run / PR / PR Detail` 已经提供主导航时，不再额外堆同一张卡的次级 deep-link
  - `approval-center-room-link-*`、`approval-center-run-link-*`、`approval-center-pr-link-*`、`approval-center-pr-detail-link-*`、`approval-center-action-*` 与移动端 `approval-center-open-context-mobile-*` 热路径保持不变；减法后桌面 triage 仍围同一份 signal truth 前滚
  - headed approval-center lifecycle 已新增“桌面 signal 不再渲染重复 `打开详情` 次级入口”断言，避免后续又把已由 Room/Run/PR 链接持有的导航重复堆回右栏
- 当前已收第十二刀:
  - `/mailbox` 的人工确认卡已删掉泛化 `打开处理入口` 动作；blocked / required 状态继续由 escalation queue、Inbox 和 handoff ledger 持有主导航，不再在右栏再堆一层重复入口
  - `mailbox-governance-human-override`、`mailbox-governance-escalation-queue`、`mailbox-card-*` 与 handoff action 热路径保持不变；减法后 `/mailbox` 仍围同一份治理镜像前滚
  - headed multi-agent governance 已新增“mailbox human-override 不再渲染重复 open-link”断言，避免后续又把第二层人工确认入口堆回右栏
- 当前已收第十三刀:
  - `/mailbox` 的 governance escalation queue 单卡已删掉重复 `nextStep` 和泛化 `打开详情` 入口；active / blocked entry 现在只保留 label、chips、status 与 summary，不再把 handoff ledger、Inbox 已持有的下一步说明和导航再堆一层
  - `mailbox-governance-escalation-entry-*`、`mailbox-governance-escalation-status-*`、`mailbox-governance-escalation-chip-*` 与 escalation queue 主体锚点保持不变；减法后 `/mailbox` 仍能围同一份治理镜像继续 `requested -> blocked -> cleared` 前滚
  - headed escalation queue 已新增“mailbox escalation entry 不再渲染 standalone next-step helper copy，也不再渲染 generic `打开详情` CTA”断言，避免后续又把 queue、Inbox 与 handoff ledger 已持有的导航/动作真相重新堆回列表卡
- 最新证据:
  - `node --check scripts/headed-multi-agent-governance.mjs`
  - `node --check scripts/headed-approval-center-lifecycle.mjs`
  - `node --check scripts/headed-governance-escalation-queue.mjs`
  - `node --check scripts/headed-cross-room-governance-orchestration.mjs`
  - `node --check scripts/headed-planner-dispatch-replay.mjs`
  - `pnpm typecheck:web`
  - `bash -lc 'cd apps/web && pnpm exec eslint src/components/live-mailbox-views.tsx'`
  - `bash -lc 'cd apps/web && pnpm exec eslint src/components/live-orchestration-views.tsx'`
  - `bash -lc 'cd apps/web && pnpm exec eslint src/components/stitch-board-inbox-views.tsx'`
  - `pnpm build:web`
  - `pnpm test:headed-planner-dispatch-replay`
  - `pnpm test:headed-governance-escalation-queue`
  - `pnpm test:headed-governance-escalation-rollup`
  - `pnpm test:headed-cross-room-governance-orchestration`
  - `pnpm test:headed-cross-room-governance-auto-closeout`
- Checklist: `CHK-01` `CHK-16`
- Test Cases: `TC-096`

## TKT-102 Explicit Provider Thread State Persistence

- 状态: `done`
- 优先级: `P0`
- 目标: 把显式 provider thread state 做成 daemon-managed local truth；即便真实 app-server transport 还没接进来，daemon 也要先把 thread state 的写回、持久化和 resume 注入 contract 站住。
- 范围:
  - `SESSION.json.appServerThreadId` 写回与复用
  - thread-state file contract
  - daemon restart 后的 thread state env reinjection
  - runtime / API contract tests
- 依赖: `TKT-99`
- Done When:
  - 同一 session 的 provider thread state 能由执行进程写回 daemon 提供的 thread-state file
  - daemon restart 后再 resume，会把已持久化的 `appServerThreadId` 重新注入执行进程环境
  - `SESSION.json` 不再只有占位 `appServerThreadId`
- 最新证据:
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./internal/runtime -run "TestRunPromptPersistsAppServerThreadIDFromProviderStateFile|TestResumeSessionExportsPersistedAppServerThreadIDAcrossRestart" -count=1'`
  - `bash -lc 'cd apps/daemon && ../../scripts/go.sh test ./internal/api -run "TestExecRoutePersistsAndReusesAppServerThreadID" -count=1'`
- Checklist: `CHK-14` `CHK-15`
- Test Cases: `TC-097`

---

## 五、已完成批次归档

- `TKT-01` `done`
  - Runtime pairing 冷启动一致性已收平，Setup 首跳不再因旧 daemon URL 漂移而 502。
- `TKT-02` `done`
  - `ops:smoke` / release gate 已能显式拦截 pairing 漂移。
- `TKT-03` `done`
  - headed Setup 主链自动化已建立，并能输出截图、trace、日志与报告。
- `TKT-04` `done`
  - GitHub App onboarding / repo binding blocked UX 已在浏览器里可复核。
- `TKT-05` `done`
  - signed webhook replay / review sync exact evidence 已补齐。
- `TKT-06` `done`
  - 真实远端 PR create / sync / merge browser loop 已通过。
- `TKT-07` `done`
  - login / logout / session persistence foundation 已站住。
- `TKT-08` `done`
  - workspace invite / member / role lifecycle 已站住。
- `TKT-09` `done`
  - action-level authz matrix 已接到 live frontend + backend guards。
- `TKT-10` `done`
  - approval center lifecycle 已落到 `/inbox`。
- `TKT-11` `done`
  - browser push / email preference / delivery chain 已站住。
- `TKT-12` `done`
  - memory injection / promotion / governance surface 已站住，并已在 2026-04-08 再次完成 headed 重跑。
- `TKT-13` `done`
  - stop / resume / follow-thread 人类接管链已站住，并已在 2026-04-08 再次完成 headed 重跑。
- `TKT-14` `done`
  - multi-runtime scheduler / lease / failover 已站住。
- `TKT-15` `done`
  - 权限矩阵已站住，但更完整 destructive guard 已拆成新的 `TKT-30`。
- `TKT-16` `done`
  - 统一 workspace shell、shared sidebar/topbar、同源 `/api/control/*` proxy、Work 激活态与 2026-04-08 work-shell smoke 已收口。
- `TKT-17` `done`
  - 原大票已拆分为 `TKT-21` `TKT-22` `TKT-23`，不再把 search / DM / thread / workbench 混成一个不可收口的范围。
- `TKT-18` `done`
  - 原 profile 方向已重组为更清晰的 `TKT-25`。
- `TKT-19` `done`
  - 原 room workbench 方向已重组为更清晰的 `TKT-23`。
- `TKT-20` `done`
  - Board 已降到左下角次级入口；后续轻量 planning cleanup 继续由 `TKT-26` 收尾。

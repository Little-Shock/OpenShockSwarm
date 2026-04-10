# OpenShock Execution Tickets

**版本:** 1.13
**更新日期:** 2026 年 4 月 11 日
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
4. 多 Agent 协作当前已经收进 SLA / routing / aggregation、formal comment、governed next-route default、one-click auto-create、governed auto-advance、delivery closeout backlink、delivery delegation signal、delegated closeout handoff auto-create、delegated closeout lifecycle sync、delivery delegation automation / auto-complete policy、delegated closeout response orchestration，以及 retry attempt truth；下一批继续前滚到更深自动协作策略与跨 Agent closeout orchestration。
5. 长期记忆 provider、后台整理、外部编排和更重的多 Agent 自治策略进入下一批长期 backlog。

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

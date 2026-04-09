# OpenShock Execution Tickets

**版本:** 1.6
**更新日期:** 2026 年 4 月 9 日
**关联文档:** [PRD](./PRD.md) · [Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、使用方式

- 这份文档承接 **当前未完成功能** 的 canonical ticket backlog，并保留刚完成批次的简短归档。
- 已完成能力的详细证据继续以 [Checklist](./Checklist.md) 和记实测试报告为准，不在这里重复展开。
- 每张票必须绑定对应 `Checklist` 和 `Test Case`，否则不能 claim。

### 状态定义

- `todo`: 还没开始
- `active`: 已 claim，正在实现
- `review`: 已提测，等待 reviewer / QA
- `done`: 已过 gate 并进入主线

---

## 二、当前批次优先级

1. 前端继续向 `app.slock.ai` 学结构和密度，但保留 OpenShock 自己的字体、克制度和 room 语义。
2. 聊天、Room、Inbox 永远先于 Board；Board 只做 planning mirror。
3. 当前批次先收真实 quick search / DM / thread / workbench / interaction polish，再去补 profile 和 board 细节。
4. Agent / Machine / Onboarding / Persistence 不能继续躲在 setup 注释或 README 里，必须变成正式产品面。
5. 多 Agent 协作必须通过 mailbox / handoff / governance ledger 被人类看见，不能只停在“以后会编排”。
6. GitHub live callback、设备授权、destructive guard、runtime hardening 作为并行后端批次推进。

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

## 三、下一轮待收口票

## TKT-21 Real Quick Search / Search Result Surface

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `in_review`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

## TKT-32 Agent Profile Editor / Prompt Avatar Memory Binding

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `todo`
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

- 状态: `in_review`
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

- 状态: `active`
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

- 状态: `in_review`
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

- 状态: `review`
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

- 状态: `todo`
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
- Test Cases: `TC-031` `TC-045`

---

## 四、已完成批次归档

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

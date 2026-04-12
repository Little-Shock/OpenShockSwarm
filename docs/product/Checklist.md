# OpenShock Product Checklist

**版本:** 1.28
**更新日期:** 2026 年 4 月 12 日
**关联文档:** [PRD](./PRD.md) · [Phase 0 MVP](./Phase0-MVP.md) · [Execution Tickets](./Execution-Tickets.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、使用方式

- `PRD` 定义完整产品应该是什么
- `Checklist` 把 PRD 拆成可跟踪的能力合同与 GAP
- `Test Cases` 把 Checklist 拆成可执行验证
- `Test Report` 记录本轮真实执行结果，不替代长期合同

### 状态定义

- `已完成`: 当前仓库已经有真实实现，且已有基础验证证据
- `部分完成`: 已有主链或界面，但能力不完整、存在已知缺口，或只站住本地基线
- `未完成`: PRD 已定义，但当前仓库还没有站住

---

## 二、当前总览

- 已完成主链:
  - chat-first 壳的主要路由
  - issue -> room -> run -> session -> worktree lane 基线
  - daemon bridge 同步执行
  - Setup 初始化主链与 headed 浏览器回放
  - 冷启动 pairing 回落与 smoke gate 拦截
  - 真实远端 PR browser loop 与 signed webhook replay
  - 文件级记忆 scaffold 与 API 读取
  - auth/session/member 基础读取与 invite/member role lifecycle
  - state SSE 初始快照
- 部分完成主链:
  - Agent 一等公民模型
  - Blocked / approval 决策面
  - 通知与恢复触达
  - 记忆治理、skill/policy 提升与 provider orchestration
  - 多 runtime 调度与 failover
  - 执行隔离与权限控制
- 主要 GAP:
  - `app.slock.ai` 式 profile-grade 入口、壳层密度和主视觉细节仍可继续收平
  - token / quota / usage / retention 的正式产品面已站住，但更细的时间维度 rollup 仍待补齐
  - onboarding 的首次启动主链已站住，但更细的模板运营与团队默认治理仍可继续增强
- delegated closeout handoff 已能自动起链，且 delivery delegation 已支持 `formal-handoff / signal-only / auto-complete` policy；更深的自动协作策略与 cross-agent closeout 仍待继续前滚
  - 更重的长期记忆整理与外部 provider 编排仍未完成

---

## 三、合同项

### CHK-01 协作壳与信息架构

- PRD 来源: 三、五、六、八
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] `Chat / Board / Inbox / Issues / Rooms / Runs / Agents / Setup / Memory / Access / Settings` 已有真实页面
  - [x] OpenShock 已经是 chat-first 壳，而不是单页看板
  - [x] 主要页面可在浏览器走查中打开
  - [x] room / run 现在已有真实的 `stop / resume / follow-thread` 控制面，不再只停在协作文案
  - [x] Board 已退到左下角次级入口，不再和频道 / room 同层抢主导航
  - [x] 2026-04-08 `TKT-24` 已用 headed Chromium 复核 `channel / room` scrollback、composer 常驻、主要命中区与 1180px 窄屏抽查
- 当前 GAP:
  - [ ] `app.slock.ai` 式 workspace shell、quick search、threads/saved 还未完全成型
  - [ ] `DM / Machine / Topic / Thread` 仍未形成完整的一等入口
  - [ ] Board 虽已退到次级入口，但 planning card 语言和 room / issue 回跳还没收平
- 对应 Test Cases: `TC-001` `TC-007` `TC-018`

### CHK-02 Agent 一等公民模型

- PRD 来源: 五.1、七、十八.3
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] Agent 列表页和详情页存在
  - [x] Agent 与 run、runtime、workspace 关系可见
  - [x] `Agent` 现在可从 shell / room drill-in 到统一 profile surface，并直接看到 presence、runtime capability 与最近 run/room 关系
- 当前 GAP:
  - [ ] Agent profile editor 已落地，但 skill 绑定与更重的 memory profile 编排仍未完整产品化
  - [ ] machine affinity 与 machine capability binding 还不能作为 Agent profile 的正式偏好层被编辑
  - [ ] Agent profile 已可编辑并保留审计，但默认模板与长期配置沉淀仍不完整
- 对应 Test Cases: `TC-008` `TC-014` `TC-030` `TC-036`

### CHK-03 真相分层与核心对象模型

- PRD 来源: 五.4、七、九、十四
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] `Issue / Room / Run / Session / Inbox / Pull Request / Memory` 均已有对象或 API
  - [x] `Run` 作为执行真相在 detail 页面可见
  - [x] SSE 已能返回初始 `snapshot`
  - [x] `/v1/state` 与 `/v1/state/stream` 现在会对 visible truth 做 fail-closed hygiene；placeholder / E2E residue / 内部路径不会再直接漏进 issue / room / run / inbox / memory surface
  - [x] 公开 control-plane 已补齐版本化 `/v1/control-plane/commands`、`/v1/control-plane/events`、`/v1/control-plane/debug/commands/:id`、`/v1/control-plane/debug/rejections` contract，并覆盖稳定 error family、idempotency 与 browser readback
- 当前 GAP:
  - [ ] Issue/Room/Run/PR/Inbox 的跨对象一致性仍需更多回归锁定
  - [ ] 更重的 durable event rollup / 历史时间线产品面仍留后续
- 对应 Test Cases: `TC-009` `TC-011` `TC-012` `TC-042` `TC-047` `TC-048`

### CHK-04 工作流 A: 工作区初始化

- PRD 来源: 十.工作流 A
- 优先级: P0
- 当前状态: 已完成
- 已落地:
  - [x] Setup 页展示 repo binding、GitHub readiness、runtime pairing、live bridge
  - [x] Setup 页可展示 effective auth path、GitHub App install state 与 installation URL
  - [x] 手动配对 runtime 后可以成功执行 bridge prompt
  - [x] 冷启动时 pairing / exec 在 `offline` 与 `stale` 窗口都回到当前活跃 daemon truth
  - [x] headed Setup harness 已能回放 repo binding、GitHub readiness、runtime pairing 与 bridge prompt，并输出截图、trace、报告
  - [x] GitHub App installation 未完成时，Setup 已能在浏览器里展示 missing fields、installation action 与回流步骤，并把 repo binding 收成 blocked contract
- 当前 GAP:
  - [ ] Setup 初始化面本轮无新增 blocker；GitHub App 安装后的 webhook / 远端 PR 回流继续由 `CHK-07` 后续票推进
- 对应 Test Cases: `TC-001` `TC-002` `TC-003` `TC-004`

### CHK-05 工作流 B: 创建 Issue 并派发给 Agent

- PRD 来源: 十.工作流 B
- 优先级: P0
- 当前状态: 已完成
- 已落地:
  - [x] 创建 issue 可联动生成 room / run / session
  - [x] daemon 会尝试为 lane 创建 worktree
  - [x] room 和 run 页面可承接后续协作
  - [x] headed Setup harness 已可从 `/board` 创建 issue 并进入 room，PR entry 保持可继续推进状态
  - [x] `/agents` orchestration board 已直连 `/v1/planner/queue` 与 `workspace.governance`，创建 issue 后可同页看到 assignment、blocked escalation、human override 与 final response replay
- 当前 GAP:
  - [x] 当前工作流 B 主链无新增 blocker；`pnpm test:headed-planner-dispatch-replay` 已覆盖 create issue -> planner dispatch -> blocked escalation -> final response 的 exact replay
- 对应 Test Cases: `TC-005` `TC-006` `TC-026`

### CHK-06 工作流 C: Topic 执行与 Run 真相

- PRD 来源: 十.工作流 C
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] run detail 能展示 runtime、branch/worktree、执行日志等信息
  - [x] bridge 执行链已能跑通同步 prompt
  - [x] room / run 已能真实 stop / resume / follow-thread，并把 paused state 回写到同一条执行真相
  - [x] `/rooms/:roomId` 已收回 chat-first room shell；默认先显示当前讨论，`Topic / Run / PR / Context` 作为次级 sheet 保留在同一条 room URL 上
  - [x] Topic summary、Run control、PR entry 与 inbox / issue / board back-links 已能在 room 内闭环，不再强制跳去独立详情页
  - [x] `pnpm test:headed-room-workbench-topic-context` 已完成 exact replay，验证 chat-first room shell、follow_thread、PR surface、reload persistence 与 inbox back-link
  - [x] `/runs` 已切成 paginated run history surface；run detail 与 room run tab 会共享 session-backed resume context，并保留同 room prior-run reopen/history
- 当前 GAP:
  - [x] Topic 已补齐独立 `/topics/:topicId` route、guidance edit surface 与 resume deep link，不再只困在 room workbench tab 内
  - [ ] token-quota 与更细粒度执行可观测性尚未完成
- 对应 Test Cases: `TC-006` `TC-007` `TC-018` `TC-031` `TC-043` `TC-046`

### CHK-07 工作流 D: PR 与 Review 闭环

- PRD 来源: 十.工作流 D
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] pull request 对象、详情和状态写回接口已存在
  - [x] room / inbox 可承接 review 语义的本地状态
  - [x] server 已支持按 effective auth path 在 `gh CLI / GitHub App` 间切换 PR create / sync / merge
  - [x] GitHub App-backed create / sync / merge 与 review-decision failure path 已有 contract tests
  - [x] Setup 已能展示 GitHub App preferred auth path、missing fields、installation URL 与“安装后如何回来”的 onboarding 提示
  - [x] repo binding 在 preferred path=`github-app` 且 installation 未完成时会返回显式 blocked contract，而不是静默退回旧路径
  - [x] signed webhook replay harness 已可通过真实 HTTP 请求回放 review / comment / check / merge，并验证 failure-path observability
  - [x] headed browser harness 已在安全 sandbox base branch 上完成真实远端 PR create / sync / merge 闭环，并验证 no-auth failure path 的 UI / inbox / room blocked 可见性
  - [x] installation-complete callback 现已把 GitHub App 回跳直接写回 OpenShock，并前滚 repo binding / tracked PR sync / Setup callback UI
  - [x] Setup / `/v1/github/connection` 现已显式暴露 public callback URL 与 webhook URL
  - [x] production-style public ingress harness 已复核 `/setup/github/callback` 回流与 signed webhook / bad-signature delivery 都走同一 public root
- 当前 GAP:
  - [ ] 真正 Internet / DNS / TLS / GitHub SaaS 外网演练仍属于环境级 runbook 范畴，但这不再是产品 contract 缺口
- 对应 Test Cases: `TC-010` `TC-015` `TC-016` `TC-022` `TC-025` `TC-026` `TC-045`

### CHK-08 工作流 E: Blocked 与人工纠偏

- PRD 来源: 十.工作流 E
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] Inbox 已能展示 blocked / approval / review 类卡片
  - [x] `/inbox` 已升级成 approval center，直接消费 `/v1/approval-center` 的 filter / unread / recent lifecycle，并能跳回 Room / Run / PR context
  - [x] 未登录与 viewer 权限已验证 401/403 保护
- 当前 GAP:
  - [ ] review change-request / merge 仍需避免远端副作用并补充安全测试
- 对应 Test Cases: `TC-010` `TC-012`

### CHK-09 工作流 F: 紧急停止与恢复

- PRD 来源: 十.工作流 F
- 优先级: P1
- 当前状态: 已完成
- 已落地:
  - [x] `POST /v1/runs/:id/control` 已支持 `stop / resume / follow_thread`
  - [x] room / run 控制面会把 run / session / issue / room / inbox 同步写回同一条状态链
  - [x] paused run 会冻结普通 room composer，避免普通消息把暂停态悄悄恢复
  - [x] `pnpm test:headed-stop-resume-follow-thread` 已完成 browser exact replay，并验证 `/inbox` recent ledger 写回
- 当前 GAP:
  - [ ] 更重的 multi-runtime scheduler / failover / recover 继续留在 `CHK-14`，不回灌当前 stop/resume contract
- 对应 Test Cases: `TC-018`

### CHK-10 工作流 G: 记忆回收、注入与提升

- PRD 来源: 十.工作流 G、十三.4
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] `MEMORY.md`、`notes/`、`decisions/` 与 `.openshock/agents` 已进入写回路径
  - [x] memory 列表与详情接口可读
  - [x] memory artifact 已有 version / governance / detail contract，并有 store/api tests
  - [x] `/memory` 现在直接消费 `/v1/memory-center`，可展示 injection policy、next-run preview、promotion queue 与 governed ledgers
  - [x] 高价值 memory item 已可经人工 review 提升为 `Skill` / `Policy`，并回写 `notes/skills.md`、`notes/policies.md`
  - [x] memory center 现在还会暴露 `workspace-file / search-sidecar / external-persistent` provider binding truth，并把 `read/write scopes / recall / retention / sharing / last-check / degraded fallback` 同步进 `/memory` 与 next-run preview
  - [x] `/memory` 现在还支持逐 provider health check / recovery，把 failure count、next action、activity timeline 与 reload persistence 收成正式产品真相
- 当前 GAP:
  - [ ] 更重的后台整理任务（去重、压缩、打标签、TTL）仍未完成
  - [ ] 真实 remote external durable adapter 仍未完成；当前 external provider 虽可恢复到 local relay stub，但不会假装已经接上真实外部数据面
  - [ ] Agent 级 memory binding / recall policy / next-run preview 已可编辑，但跨 Agent 的更重治理、批量策略和后台编排仍留后续
- 对应 Test Cases: `TC-019` `TC-023` `TC-036` `TC-085` `TC-086`

### CHK-11 工作流 H: 邀请、通知与恢复触达

- PRD 来源: 十.工作流 H、十三.5
- 优先级: P1
- 当前状态: 部分完成
- 已落地:
  - [x] notifications 基础对象和接口已经出现
  - [x] `/settings` 现在直接消费 `/v1/notifications`，可写 workspace browser/email policy、current browser subscriber、email subscriber，并展示 latest worker receipts
  - [x] browser push / email fanout 已能把 blocked / review / approval 信号主动推出去，失败 / retry 也有 explicit `lastError` / receipt truth
  - [x] `/inbox` 在 mobile web 下现在收成轻量通知处理面：首屏只保留 open / unread / blocked / recent 摘要、直接 decision 与可折叠 backlinks / guard，重策略继续回 `/settings`
  - [x] `invite / verify / reset / blocked recovery` 已通过 `/settings` identity template chain 与 `/access` 恢复链收成同一条 delivery truth，并已有 2026-04-11 Windows Chrome 有头证据
- 当前 GAP:
  - [ ] @提及、mailbox 新消息、跨设备恢复触达等更细粒度通知策略仍未补齐
- 对应 Test Cases: `TC-017` `TC-044`

### CHK-12 工作流 I: 执行隔离与权限控制

- PRD 来源: 十.工作流 I、十三.5
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] worktree 是当前默认隔离单元
  - [x] 本地 CLI 通过 daemon bridge 执行
  - [x] issue 创建类操作具备基本 401/403 权限防护
  - [x] issue / room / run / inbox / repo / runtime 的关键写入口已按 live session permission 进入 allow / disable split
  - [x] destructive action approval、secret / credential scope、越界写保护现在都以统一 guard truth 出现在 room / inbox / run，并且人类决策会回写 run lifecycle
  - [x] workspace / agent / run 现在都可声明 restricted sandbox profile、network / command / tool allowlist，并已有 2026-04-11 Windows Chrome override/retry 证据
- 当前 GAP:
  - [ ] 更重的 OS/container isolation 仍主要继承本地环境；当前 restricted profile 主要负责 policy gate，不等于彻底脱离本机执行边界
- 对应 Test Cases: `TC-011` `TC-024` `TC-027`

### CHK-13 身份、成员、角色与仓库授权

- PRD 来源: 十三.5、十八.8
- 优先级: P1
- 当前状态: 部分完成
- 已落地:
  - [x] auth session 与 workspace members API 可读取
  - [x] `/access` 已消费 live auth session / members / roles truth，并提供 email login / logout 入口
  - [x] auth session persistence 已有 store test 与 browser reload evidence
  - [x] owner 已可在 `/access` 直接 invite 成员，并 live 调整 member role / status
  - [x] invited member 首次登录会转成 `active`，role 变化会同步反映到 session / permissions / browser probes
  - [x] Board / Room / Inbox / Setup 关键动作已和 `issue.create` / `room.reply` / `run.execute` / `inbox.review` / `inbox.decide` / `repo.admin` / `runtime.manage` / `pull_request.*` 真值对齐
  - [x] `/access` 现在已把 device authorization、email verification、password reset、session recovery 与 external identity binding 收进同一条 live identity chain
- 当前 GAP:
  - [ ] Onboarding 还没把 invite / verify / device auth / template bootstrap 收成同一条首次启动旅程
  - [ ] GitHub 仍主要是 readiness probe，不是完整授权模型
- 对应 Test Cases: `TC-014` `TC-016` `TC-024` `TC-035` `TC-038`

### CHK-14 Runtime 注册、心跳与调度

- PRD 来源: 九.3、十三.5
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] runtime registry、selection、pairing 接口存在
  - [x] daemon heartbeat 已接入 server 状态
  - [x] pairing 冷启动一致性已覆盖 `offline` 与 `stale` 窗口
  - [x] server 现在会按 active lease 压力给出显式 runtime scheduler 决策，并把 next-lane truth 带进 `/v1/state` 与 `/v1/runtime/registry`
  - [x] `/setup` 与 `/agents` 现在会直接消费 runtime scheduler / lease / failover truth，不再停在旧的 placeholder 注释窗口
  - [x] offline selected runtime 现在会显式 failover 到可调度的 least-loaded runtime，并把 failover reason 回写到 run / session truth
  - [x] daemon -> server publish 已收成 `/v1/runtime/publish` + `/v1/runtime/publish/replay` contract；cursor dedupe、closeout reason、failure anchor 与 run detail replay panel 已站住
- 当前 GAP:
  - [ ] lease/conflict guard 与更细粒度 scheduler policy / readiness hook 仍需继续加强
- 对应 Test Cases: `TC-003` `TC-004` `TC-020` `TC-049`

### CHK-15 成功指标、验收门与观测

- PRD 来源: 十四、十五、十七
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] `pnpm verify:release` 与 `pnpm ops:smoke` 提供基础回归门
  - [x] `GET /v1/experience-metrics` + `pnpm ops:experience-metrics` 已把 `product / experience / design` 收成一份可复用的持续快照
  - [x] 浏览器走查、API 检查、SSE 验证已经有一轮实际结果
  - [x] 2026 年 4 月 7 日针对 GitHub App effective auth path 和 memory contract 的 go tests / release verify 已通过
  - [x] `ops:smoke` 已会比对 pairing URL、runtime registry、server runtime bridge 与 daemon runtime 的 URL 真值
  - [x] `pnpm test:headed-setup` 已能输出 headed Chromium 截图、trace、日志和 markdown 报告
  - [x] `pnpm check:live-truth-hygiene` 已进入 `verify:web`，会拦 direct mock-data import、placeholder 文案和 tracked live-truth residue
  - [x] 2026-04-10 Windows Chrome 有头链路已补齐 control-plane `/v1`、runtime replay、routing SLA / aggregation 与 dirty projection fail-closed 证据
  - [x] 2026-04-11 Windows Chrome 有头链路已补齐 restricted sandbox `approval_required -> same-target override/retry -> reload persistence` 证据
  - [x] 2026-04-11 Windows Chrome 有头链路已补齐 `/rooms -> /runs -> /settings` 的 workspace plan / usage / quota / retention 证据
  - [x] 2026-04-11 Windows Chrome 有头链路已补齐 PR delivery entry、release gate、operator handoff note 与 evidence bundle 同页复核证据
- 当前 GAP:
  - [ ] 历史型 rate 指标仍有一部分只到 `partial`，后续还要补 durable event rollup / time-series truth
- 对应 Test Cases: `TC-011` `TC-021` `TC-026` `TC-042` `TC-047` `TC-048` `TC-049`

### CHK-16 app.slock.ai 壳层对齐与导航秩序

- PRD 来源: 六、八
- 优先级: P0
- 当前状态: 已完成
- 已落地:
  - [x] 当前 web 已有频道、讨论间、收件箱、Setup、Agent、Machine 数据源与基础左栏骨架
  - [x] `OpenShockShell`、`StitchSidebar`、`StitchTopBar` 已提供可演进的全屏壳层原语
  - [x] `/v1/state` 已能把 channels / agents / machines / inbox / rooms 收成同一份 workspace truth
  - [x] `/setup`、`/inbox`、`/board` 等次级 surface 已统一进入同一套 workspace shell，不再和 chat/room 使用两套左栏
  - [x] web 默认改走同源 `/api/control/*` proxy，Windows 有头浏览器下也能拿到 live workspace truth，不再卡在 `syncing`
  - [x] `Chat / Work` 顶部切换现在会按当前 surface 正确激活，Work 页不再像未激活副按钮
  - [x] `setup / issues / memory / inbox / board / room / run` 已完成 2026-04-08 headed work-shell smoke，统一壳层、去白缝和密度收紧都有当天证据
  - [x] `pnpm test:headed-quick-search` 已把 Quick Search 收成真实 command palette：同一套 search surface 现在既能命中 `channel / room / issue / run / agent`，也能命中 `dm / followed / saved` 三类 message-surface result，并验证跳转、reopen、高亮与 empty state
  - [x] `pnpm test:headed-frontend-interaction-polish` 已锁住 sidebar / topbar hit area、channel / room scrollback、composer 常驻与窄屏无横向溢出
  - [x] sidebar 现在已有 `DM / Followed Threads / Saved Later` 入口，且能在同一套壳层内直达对应消息面
  - [x] sidebar footer 现在新增固定 `Profile Hub`，会把当前 `Human / Machine / Agent` 收成 app.slock.ai 式壳层入口，并一跳进入统一 profile surface
- 对应 Test Cases: `TC-028` `TC-029` `TC-033` `TC-034` `TC-077`

### CHK-17 会话上下文、Presence 与 Profile Surface

- PRD 来源: 七、八、十
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] room / run 已有 live truth，且 stop / resume / follow-thread 已可真实回写
  - [x] room 数据里已有 topic，shell 与 setup 侧已有 machine / agent summary
  - [x] Agent 列表、Room 详情、Run 详情已经存在
  - [x] channel / room 现在都有 message-centric thread rail，message row 可直接打开 reply 子区，composer 保持常驻可见
  - [x] room thread rail 已直接接上 `follow_thread` 控制，不再只是纯展示卡片
  - [x] channel 现在已有 followed thread / saved later 回访面，thread 可在 `follow -> reopen` 与 `save later -> reopen` 闭环
  - [x] room 现在已改成 chat-first 主面 + 次级 sheet 结构；query state 与 room-first back-links 仍留在同一壳层内，但不再把 `Topic / Run / PR / Context` 放成一级 tabs
  - [x] `Agent / Machine / Human` 现在都可从 shell 或 room drill-in 到统一 profile surface，presence / activity / capability / recent room-run 关系直接读取 live truth
- 当前 GAP:
  - [ ] profile 现已可读，但编辑、持久化默认值与 onboarding 绑定仍留后续票推进
- 对应 Test Cases: `TC-029` `TC-030` `TC-031` `TC-034`

### CHK-18 Board 次级规划面

- PRD 来源: 六.3、八、十
- 优先级: P2
- 当前状态: 已完成
- 已落地:
  - [x] `/board` 已接 live issue truth，并可创建 issue 后进入 room
  - [x] board lane 与 issue -> room -> run 主链已联动
  - [x] Board 已从主消息导航挪到左下角次级入口，不再和频道 / room 同层抢主壳心智
  - [x] room / issue 进入 `/board` 时会带上 source-aware planning mirror context，并显式提供回讨论间 / 看 Issue 回跳
  - [x] Board 顶栏、摘要条和 lane 已压成更轻的 planning mirror，只保留状态、PR、owner 与回 room / issue 的最短动作，不再像独立后台详情页
- 对应 Test Cases: `TC-032`

### CHK-19 Agent / Machine Profile 与本地能力配置

- PRD 来源: 五.1、七、十.工作流 J、十三.4、十三.5、十八.3、十八.10
- 优先级: P1
- 当前状态: 部分完成
- 已落地:
  - [x] `/agents`、`/agents/:id` 已有基础 Agent surface
  - [x] `/setup`、`/agents` 已有 runtime pairing、scheduler 与 machine summary
  - [x] daemon 已能探测本地 `codex` / `claude` CLI，并把 runtime truth 暴露到 server
  - [x] `Agent / Machine / Human` 已有统一 read-only profile surface，可看到 presence、capability 与最近 room/run 关系
  - [x] Agent profile 现在可直接编辑 `prompt / avatar / role / operating instructions / memory binding / recall policy / provider preference`，并同步写回 audit 与 next-run preview
  - [x] `/setup`、machine profile、`/agents` 与 Agent profile editor 现在会回读同一份 machine shell / daemon / provider-model catalog truth
  - [x] Agent 现在可声明 default provider / model / runtime affinity，并与 machine/provider truth 对齐后直接写回后端 state；model catalog 只作 suggestion，不按静态列表硬拒绝
- 当前 GAP:
  - [ ] 上述配置还不能作为 onboarding 默认值长期保存
- 对应 Test Cases: `TC-030` `TC-036` `TC-037`

### CHK-20 Onboarding、场景模板与团队启动

- PRD 来源: 十.工作流 A、十.工作流 J、十一、十三.5、十八.10
- 优先级: P1
- 当前状态: 部分完成
- 已落地:
  - [x] `/setup` 已集中 repo binding、GitHub readiness、runtime pairing、bridge
  - [x] `/access` 已有 invite / member / role lifecycle 基线
  - [x] Setup / Access 已为 onboarding 提供最基础的数据真相
  - [x] `/setup` 现在提供 `开发团队 / 研究团队 / 空白自定义` 模板选择，并把 channels / roles / agents / notification policy / onboarding notes 收成同一份 workspace onboarding truth
  - [x] onboarding progress、current step、resume route 会跟随 repo binding / GitHub readiness / runtime pairing 的 live truth 前滚，而不是只停在本地步骤卡
  - [x] 完成首次启动后，reload、server restart 与 second browser context 继续从同一份 durable workspace snapshot 读回 template bootstrap 与 onboarding status
  - [x] `/access` 身份恢复链与 `/settings` identity template delivery 现在会围同一份 onboarding / first-start truth 前滚，不再把 invite / verify / reset 留成脱节旁路
- 当前 GAP:
  - [ ] `开发团队 / 研究团队` 当前先收成 bootstrap package，不包含正式多 Agent role topology / mailbox / reviewer-tester loop；这部分继续留给 `TC-041` / `TKT-36`
- 对应 Test Cases: `TC-035` `TC-038` `TC-041`

### CHK-21 Agent Mailbox、多 Agent 协作与治理

- PRD 来源: 五.5、五.11、十.工作流 B、十.工作流 K、十三.5、十八.4、十八.11
- 优先级: P1/P2
- 当前状态: 部分完成
- 已落地:
  - [x] issue -> room -> run、Inbox、stop/resume/follow-thread、人类纠偏基线已站住
  - [x] Skill / Policy / memory governance 已有基础产品面
  - [x] Agent Mailbox 已补成正式通信面，handoff request / ack / blocked / complete lifecycle 可在 Room / Inbox / Mailbox 同步追踪
  - [x] Mailbox 现在支持 source / target 双边 formal comment；comment 会写入同一条 handoff ledger、room trace 与 inbox 摘要，但不会偷偷改 lifecycle status 或冲掉 blocked / complete note
  - [x] workspace governance 现已显式暴露 routing policy、escalation SLA、notification policy、response aggregation audit 与 human override trace，并已有 Windows Chrome 有头证据
  - [x] `workspace.governance.routingPolicy.suggestedHandoff` 现在会围当前 room/run truth 和 team topology 派生默认下一棒 governed route；`/mailbox` 与 Inbox compose 都会读取同一条建议，并在 active / blocked 时显式提示而不是静默随机回退
  - [x] governed route 在 `ready` 状态下现在可直接一键创建 formal handoff；`/mailbox` 与 Inbox compose 都会给出 `Create Governed Handoff` 入口，并在起单后同步切到 `active`
  - [x] governed handoff 在 `acknowledged` 后现在可直接 `Complete + Auto-Advance`；若下一条 lane 已有合法 default agent，就会自动创建 followup handoff，并让 `/mailbox` 与 Inbox compose 一起切到新 ledger 的 `active`
  - [x] final lane 收口后，governed surface 现在会显式给出 PR delivery entry / closeout 回链；PR detail 的 operator handoff note 与 evidence 也会直接带上最新 governed closeout note
  - [x] final lane closeout 后，PR detail 现在还会显式派生 `Delivery Delegation` card，并把 delivery delegate 以 deterministic inbox signal 接回 related inbox / PR detail
  - [x] final lane closeout 后，系统现在还会自动创建 `delivery-closeout` formal handoff；这条 handoff 会进入 Mailbox / Inbox ledger，并从 PR detail delegation card 直接 deep-link 回去
  - [x] delegated closeout handoff 现在也会把 `blocked -> completed` lifecycle 即时回写到 PR detail delegation card 与 deterministic inbox signal；governed route 会继续维持 final-lane done-state，不会被额外 closeout handoff 冲回 active
  - [x] workspace governance 现在也支持 `formal-handoff / signal-only` 两种 delivery delegation automation policy；`/settings`、PR detail 和 Mailbox 会读取同一份 durable truth，`signal-only` 下只派 delegation signal，不自动物化 delegated closeout handoff
  - [x] workspace governance 现在还支持 `auto-complete` delivery delegation automation policy；final lane closeout 后 PR detail / related inbox 会直接把 delivery delegate 收成 `delegation done`，且不会额外物化 delegated closeout handoff
  - [x] delegated closeout handoff 上的 source / target formal comment 现在也会同步回 PR detail `Delivery Delegation` summary 与 related inbox signal，且不会把 `handoff requested` lifecycle 偷偷改坏
  - [x] delegated closeout handoff 在 target `blocked` 后，现在会自动物化一条 `delivery-reply` formal handoff，把 unblock response 回给 source；PR detail delegation card 会同步显示 `reply requested / reply completed` 与 deep link，且 response 完成后原 closeout handoff 仍保持 blocked，直到 target 重新 acknowledge
  - [x] delegated closeout handoff 现在还会把第二轮及后续 `blocked -> response -> re-ack -> blocked` retry attempt 收成正式 truth；PR detail delegation card 会显式显示 `reply xN` attempt 计数，并始终回链到最新一轮 response handoff
  - [x] `delivery-reply` response handoff 上的 source / target formal comment 现在也会同步回 PR detail `Delivery Delegation` summary 与 related inbox signal，且 comment sync 过程中 `reply requested` lifecycle 会保持不变
  - [x] `delivery-reply` 的 response progress 现在还会直接回推父级 delegated closeout handoff、其 handoff inbox signal 与 run/session next action；target 不必只盯 PR detail，也能在 Mailbox / Inbox 看到“source 已回复，轮到你 re-ack”这条 resume signal
  - [x] Mailbox 现在也会直接显示 delegated closeout parent/child orchestration：父级 closeout card 会出现 `reply requested / reply completed` 与 `reply xN`，child `delivery-reply` card 则会显式给出 parent chip 和 `Open Parent Closeout` 回跳
  - [x] child `delivery-reply` 完成后，Mailbox 现在还可以直接 `Resume Parent Closeout`；blocker agent 可从 child ledger 一键把父级 delegated closeout 重新 `acknowledged`，且 parent card 会继续保留 `reply completed`
  - [x] parent delegated closeout 被重新 `acknowledged` / `completed` 后，PR detail `Delivery Delegation` summary 与 related inbox signal 现在也会继续保留这段 `reply xN / 第 N 轮 unblock response` 历史，而不是只剩抽象 active/done 状态
  - [x] child `delivery-reply` card 现在也会直接显示 parent 当前是 `blocked / acknowledged / completed`；source agent 不必离开 child ledger，也能知道主 closeout 后续到底有没有被接住并最终收口
  - [x] parent delegated closeout 被重新 `acknowledged` / `completed` 后，parent handoff 自己的 Mailbox card、handoff inbox signal 与 run/session context 现在也会继续保留 `reply xN / 第 N 轮 unblock response` 历史；target 不会在 parent surface 上被通用 resume/done 文案洗掉 child response 上下文
  - [x] parent delegated closeout 被重新 `acknowledged` / `completed` 后，child `delivery-reply` 自己的 `lastAction` 与 child handoff inbox summary 现在也会同步前滚到 parent follow-through 真相；source 不会只看到一个已更新的 parent chip，却还读到过期正文
  - [x] parent delegated closeout 被重新 `acknowledged` / `completed` 后，child `delivery-reply` 的 lifecycle messages 现在也会显式追加 `parent-progress` 事件；source 深看 child ledger 历史时，不会再像 parent 后续从未接住过这条 closeout
  - [x] `Delivery Delegation` summary 里的 latest formal comment 现在会在 response complete、parent resume、parent complete 之后继续保留；后续 lifecycle event 不会把 formal comment 真相洗掉
  - [x] child `delivery-reply` 的 formal comment / response complete 现在也会显式落进 parent delegated closeout 自己的 lifecycle messages，作为 `response-progress` timeline；target 深看 parent ledger 时，不再只剩一条不断被覆盖的 `lastAction`
  - [x] child `delivery-reply` 的 formal comment / response complete 现在也会显式写进 Room 主消息流，作为 `[Mailbox Sync]` orchestration 叙事；房间里不再只靠 Mailbox / PR / Inbox 才知道 parent closeout 已收到这轮 unblock progress
  - [x] child `delivery-reply` 如果自己再次 `blocked`，Room 主消息流现在也会显式追加 `[Mailbox Sync]` 阻塞叙事，并保留 child blocker note 与“主 closeout 继续保持 blocked”的 parent guidance；房间里不再只会看到乐观的 comment / complete sync
  - [x] PR detail 现在也会把 parent delegated closeout 与 child `delivery-reply` 收成同一条 `Delivery Collaboration Thread`；request / blocker / formal comment / response progress / parent-progress 会按真实时间顺序同屏回放，并可直接 deep-link 回对应 Mailbox handoff
  - [x] PR detail 里的当前 delegated closeout / `delivery-reply` 现在也能直接变成正式 action surface；用户可同页做 `acknowledged / blocked / comment / completed`，child reply 完成后还能直接 `Resume Parent Closeout`，并以 live mailbox truth 刷新同页状态
  - [x] `/mailbox` 现在支持在当前可见 room ledger 中多选 open handoff，并顺序执行 batch `acknowledged / comment / completed`；selection、closeout note 与 inbox summary 会沿同一份正式 handoff truth 前滚
  - [x] `workspace.governance.escalationSla` 现在已补正式 queue entry；active handoff 与 blocked inbox signal 会带着 `label / source / owner / next-step / deep-link` 同时进入 `/mailbox` 与 `/agents` 的治理面，不再只剩 aggregate SLA 计数
  - [x] `workspace.governance.escalationSla.rollup` 现在还会把整个 workspace 里仍在冒烟的 room 收成同一份 cross-room rollup；`/mailbox` 与 `/agents` 会同时显示 `room / status / count / latest escalation / deep-link`，不再只盯当前 room
  - [x] `/mailbox` 的 pure governed selection 现在会读正式 routing policy，显示 `Governed Batch Policy`，并允许 `Batch Complete + Auto-Advance` 在同一条 batch queue 里顺序收口多条 governed handoff，同时只物化一条 next-lane followup
  - [x] cross-room rollup 现在还会补 `current owner / current lane / next governed route` 元数据；`/mailbox` 可直接从 `ready` room 上 `Create Governed Handoff`，`/agents` 会镜像同一条 room-level route truth
  - [x] room-auto 的顺序交接当前已补专门回归：`A -> B -> C` 时，第二次 auto-followup 会围最新 owner 路由，不再因为 stale `RecentRunIDs` 把 provider、identity prompt 或 agent prompt scaffold 锚回上一位 Agent
  - [x] 当前 owner 的 room continuity 也已补重启恢复回归；store / server reload 后，下一条房间消息仍会继续路由给最新接手者，而不是掉回旧 owner 或旧 provider
  - [x] PR detail 现在也已升级成 single delivery contract：release gate、operator handoff note、delivery template 与 evidence bundle 可在同页复核
  - [x] `/settings` 现在可直接编辑 team topology，并把 lane / role / default agent / handoff path 写回 durable workspace truth；`/setup` `/mailbox` `/agents` 会继续读取同一份配置，且已补 Windows Chrome 有头证据
  - [x] `/settings` 当前已改成 `core settings -> advanced governance / credentials / notifications` 的信息层级；高频路径先看 workspace/member 真值，重治理能力继续保留在高级区
- 当前 GAP:
  - [ ] 更重的 multi-room dependency graph、cross-room auto-closeout 和跨 room 依赖治理仍留后续；当前已不再缺“当前 room ledger 的 bulk closeout”“policy-based batch orchestration”“显式 escalation queue”“跨 room escalation rollup”以及“room-level governed create action”
  - [ ] `handoff -> clarification wait -> memory preview/provider choice -> restart resume` 这条跨链连续性还没有被一条完整回归完全锁死；目前已补 `顺序 handoff + restart owner continuity`，但 clarification/memory 两段仍要继续收紧
- 对应 Test Cases: `TC-039` `TC-041` `TC-050` `TC-051` `TC-052` `TC-053` `TC-054` `TC-055` `TC-056` `TC-057` `TC-058` `TC-059` `TC-060` `TC-061` `TC-062` `TC-063` `TC-064` `TC-065` `TC-066` `TC-067` `TC-068` `TC-069` `TC-070` `TC-071` `TC-072` `TC-073` `TC-074` `TC-075` `TC-076` `TC-078` `TC-079` `TC-080` `TC-081` `TC-082` `TC-083` `TC-084` `TC-087`

### CHK-22 配置持久化、数据库与恢复真相

- PRD 来源: 五.10、十.工作流 L、十三.5、十四、十八.11
- 优先级: P1
- 当前状态: 已完成
- 已落地:
  - [x] server 已有文件状态存储
  - [x] auth session persistence 已成立
  - [x] memory artifact 已有 version / governance / external edit sync contract
  - [x] memory provider binding 现在也会回到同一份 durable `memory-center.json`，reload 后仍能恢复 `enabled / status / degraded fallback`
  - [x] provider health/recovery 的 `failure count / last-check source / activity timeline / last recovery` 现在也会回到同一份 durable `memory-center.json`
  - [x] workspace / member preference、GitHub identity 与既有 agent profile edit 现在可回到统一 durable store / database schema
  - [x] onboarding progress、template selection、repo binding snapshot、GitHub installation snapshot 已经回到同一份 state/store 真相
  - [x] restart / 换设备后的 config recovery 已有 browser + API 级验证
  - [x] room 当前 owner 的 auto-handoff 连续性也已补 targeted restart 回归；最新接手者会随 durable state 一起恢复，不再依赖进程内临时顺序
  - [x] workspace plan / usage / retention 现在也直接从同一份 durable snapshot 投影到 `/settings`、room workbench 与 run detail
- 对应 Test Cases: `TC-040` `TC-085` `TC-086` `TC-087`

---

## 四、近期收口顺序

1. 先补 `CHK-21` `CHK-22` 的跨链连续性回归，把 `handoff -> clarification -> memory preview/provider -> restart resume` 串成一条真正完整的 TDD 验证链。
2. 再推进 `CHK-10` 的后台记忆整理、真实 remote external provider adapter，以及更深的 memory compaction / retention automation。
3. 然后继续做 `CHK-21` 更重的 multi-room dependency graph、cross-room auto-closeout 与跨 Agent closeout orchestration。

---

## 五、拆票映射

- `CHK-04` `CHK-14` `CHK-15` -> `TKT-01` `TKT-02` `TKT-03`
- `CHK-07` -> `TKT-04` `TKT-05` `TKT-06`
- `CHK-13` `CHK-12` -> `TKT-07` `TKT-08` `TKT-09`
- `CHK-08` `CHK-11` -> `TKT-10` `TKT-11` `TKT-47`
- `CHK-10` -> `TKT-12`
- `CHK-09` -> `TKT-13`
- `CHK-14` -> `TKT-14`
- `CHK-12` -> `TKT-15` `TKT-30`
- `CHK-01` `CHK-16` -> `TKT-16` `TKT-21` `TKT-24` `TKT-38` `TKT-88`
- `CHK-02` `CHK-06` `CHK-17` -> `TKT-22` `TKT-23` `TKT-25` `TKT-27`
- `CHK-05` `CHK-18` -> `TKT-20` `TKT-26`
- `CHK-07` -> `TKT-28`
- `CHK-13` -> `TKT-29`
- `CHK-12` -> `TKT-30`
- `CHK-14` `CHK-15` -> `TKT-31`
- `CHK-19` -> `TKT-25` `TKT-32` `TKT-33`
- `CHK-20` -> `TKT-29` `TKT-34`
- `CHK-21` -> `TKT-35` `TKT-36` `TKT-61` `TKT-62` `TKT-63` `TKT-64` `TKT-65` `TKT-66` `TKT-67` `TKT-68` `TKT-69` `TKT-70` `TKT-71` `TKT-72` `TKT-73` `TKT-74` `TKT-75` `TKT-76` `TKT-77` `TKT-78` `TKT-79` `TKT-80` `TKT-81` `TKT-82` `TKT-83` `TKT-84` `TKT-85` `TKT-86` `TKT-87` `TKT-89` `TKT-90` `TKT-91` `TKT-92` `TKT-93` `TKT-94` `TKT-95`
- `CHK-22` -> `TKT-37`
- `CHK-07` `CHK-08` -> `TKT-39`
- `CHK-06` -> `TKT-40` `TKT-52`
- `CHK-10` `CHK-22` -> `TKT-42` `TKT-43` `TKT-96`
- `CHK-11` `CHK-13` `CHK-20` -> `TKT-44`
- `CHK-12` `CHK-13` -> `TKT-45`
- `CHK-12` `CHK-15` -> `TKT-46`
- `CHK-15` `CHK-22` -> `TKT-48`
- `CHK-15` `CHK-21` -> `TKT-49`
- `CHK-03` `CHK-15` -> `TKT-38` `TKT-58` `TKT-59`
- `CHK-14` `CHK-15` -> `TKT-31` `TKT-60`

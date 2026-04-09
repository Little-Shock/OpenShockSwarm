# OpenShock Product Checklist

**版本:** 1.6
**更新日期:** 2026 年 4 月 9 日
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
  - 记忆治理与 skill/policy 提升
  - 多 runtime 调度与 failover
  - 执行隔离与权限控制
- 主要 GAP:
  - `app.slock.ai` 式真实 quick search / search result、DM、saved/later、profile surface 仍未收平
  - Room workbench tabs 和 Board 轻量 planning card 仍未收完
  - Agent / Machine profile、prompt/avatar、memory binding、本地 CLI/model 偏好还没产品化
  - 场景化 onboarding、开发团队/研究团队模板、user/workspace config 持久化仍未建立
  - Agent Mailbox、多 Agent handoff、角色治理与 response aggregation 仍未收口
  - GitHub App installation-complete 后的 live webhook / repo 持续同步
  - 设备授权 / 完整邮箱验证 / 更完整成员权限链路
  - destructive action approval、secrets 分层、越界写保护
  - 更重的长期记忆整理与外部 provider 编排

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
- 当前 GAP:
  - [ ] Issue/Room/Run/PR/Inbox 的跨对象一致性仍需更多回归锁定
  - [ ] 实时事件目前只站住 Phase 0 基线，缺少更完整的事件 contract
- 对应 Test Cases: `TC-009` `TC-011` `TC-012` `TC-042`

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
- 当前 GAP:
  - [ ] 多 Agent 自动派发仍未建立
  - [ ] “进入讨论间并发送第一条指令” 之后的 agent 协作回放仍未进入 headed 自动化
- 对应 Test Cases: `TC-005` `TC-006` `TC-026`

### CHK-06 工作流 C: Topic 执行与 Run 真相

- PRD 来源: 十.工作流 C
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] run detail 能展示 runtime、branch/worktree、执行日志等信息
  - [x] bridge 执行链已能跑通同步 prompt
  - [x] room / run 已能真实 stop / resume / follow-thread，并把 paused state 回写到同一条执行真相
  - [x] `/rooms/:roomId` 已升级成 query-driven room workbench，`Chat / Topic / Run / PR / Context` 可在同一页切换
  - [x] Topic summary、Run control、PR entry 与 inbox / issue / board back-links 已能在 room 内闭环，不再强制跳去独立详情页
  - [x] `pnpm test:headed-room-workbench-topic-context` 已完成 exact replay，验证切 tab、follow_thread、PR surface、reload persistence 与 inbox back-link
  - [x] `/runs` 已切成 paginated run history surface；run detail 与 room run tab 会共享 session-backed resume context，并保留同 room prior-run reopen/history
- 当前 GAP:
  - [x] Topic 已补齐独立 `/topics/:topicId` route、guidance edit surface 与 resume deep link，不再只困在 room workbench tab 内
  - [ ] token-quota 与更细粒度执行可观测性尚未完成
- 对应 Test Cases: `TC-006` `TC-007` `TC-018` `TC-031` `TC-043` `TC-045`

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
- 当前 GAP:
  - [ ] GitHub-hosted callback URL 与真实公网 webhook delivery 还没有在公共 ingress 上做当天复核；当前先以 installation callback contract + signed webhook replay 近实机证据收口
- 对应 Test Cases: `TC-010` `TC-015` `TC-016` `TC-022` `TC-025` `TC-026`

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
- 当前 GAP:
  - [ ] 更重的后台整理任务（去重、压缩、打标签、TTL）仍未完成
  - [ ] 长期记忆引擎与外部 provider 编排仍停留在设计层
  - [ ] Agent 级 memory binding / recall policy / next-run preview 已可编辑，但跨 Agent 的更重治理与后台编排仍留后续
- 对应 Test Cases: `TC-019` `TC-023` `TC-036`

### CHK-11 工作流 H: 邀请、通知与恢复触达

- PRD 来源: 十.工作流 H、十三.5
- 优先级: P1
- 当前状态: 部分完成
- 已落地:
  - [x] notifications 基础对象和接口已经出现
  - [x] `/settings` 现在直接消费 `/v1/notifications`，可写 workspace browser/email policy、current browser subscriber、email subscriber，并展示 latest worker receipts
  - [x] browser push / email fanout 已能把 blocked / review / approval 信号主动推出去，失败 / retry 也有 explicit `lastError` / receipt truth
  - [x] `/inbox` 在 mobile web 下现在收成轻量通知处理面：首屏只保留 open / unread / blocked / recent 摘要、直接 decision 与可折叠 backlinks / guard，重策略继续回 `/settings`
- 当前 GAP:
  - [ ] 邀请、邮箱验证、密码重置仍未接到同一 notification template / delivery chain
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
- 当前 GAP:
  - [ ] 沙盒能力目前仍主要继承本地环境
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
- 当前 GAP:
  - [ ] lease/conflict guard 与更细粒度 scheduler policy 仍需继续加强
- 对应 Test Cases: `TC-003` `TC-004` `TC-020`

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
- 当前 GAP:
  - [ ] 历史型 rate 指标仍有一部分只到 `partial`，后续还要补 durable event rollup / time-series truth
- 对应 Test Cases: `TC-011` `TC-021` `TC-026` `TC-042`

### CHK-16 app.slock.ai 壳层对齐与导航秩序

- PRD 来源: 六、八
- 优先级: P0
- 当前状态: 部分完成
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
- 当前 GAP:
  - [ ] 仍缺 `app.slock.ai` 式 profile 级入口
- 对应 Test Cases: `TC-028` `TC-029` `TC-033` `TC-034`

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
  - [x] room 现在已有稳定的 `Chat / Topic / Run / PR / Context` 工作台 tabs，query state 与 room-first back-links 都能留在同一壳层内
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
  - [x] Board card 已压成更轻的 planning 语言，只保留状态、owner、room 摘要与最短动作，不再像独立后台详情页
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
- 当前 GAP:
  - [ ] device auth / verify 已进入 `/access` 的 live identity chain，但还没和 template bootstrap 收成同一条首次启动旅程
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
- 当前 GAP:
  - [ ] PM / Architect / Splitter / Developer / Reviewer / QA 等角色拓扑还未成为可配置 team topology
  - [ ] 更完整的多 Agent handoff routing / escalation SLA / notification policy 还未收口
  - [ ] 多 Agent response aggregation 和 human override 还未形成正式治理面
- 对应 Test Cases: `TC-039` `TC-041`

### CHK-22 配置持久化、数据库与恢复真相

- PRD 来源: 五.10、十.工作流 L、十三.5、十四、十八.11
- 优先级: P1
- 当前状态: 已完成
- 已落地:
  - [x] server 已有文件状态存储
  - [x] auth session persistence 已成立
  - [x] memory artifact 已有 version / governance / external edit sync contract
- [x] workspace / member preference、GitHub identity 与既有 agent profile edit 现在可回到统一 durable store / database schema
- [x] onboarding progress、template selection、repo binding snapshot、GitHub installation snapshot 已经回到同一份 state/store 真相
- [x] restart / 换设备后的 config recovery 已有 browser + API 级验证
- 对应 Test Cases: `TC-040`

---

## 四、近期收口顺序

1. 先收 `CHK-16` 剩余的 quick search / result surface，把当前统一壳层真正打磨到高频可用。
2. 再收 `CHK-17`，把 DM / followed thread / profile / room workbench tabs 接成统一前台工作面。
3. 并行启动 `CHK-19` 和 `CHK-22`，把 Agent / Machine 配置面与持久化真相先补出来。
4. 然后处理 `CHK-20`，把 onboarding、团队模板和首次启动路径产品化。
5. 再推进 `CHK-21`，把 Agent Mailbox、多 Agent handoff 和治理链收口。
6. 最后处理 `CHK-18`，把 Board 的 planning card 和回跳关系轻量化。
7. 并行保留 `CHK-07/CHK-12/CHK-13/CHK-14/CHK-15` 的 GitHub live callback、设备授权、destructive guard、scheduler hardening 与持续观测。

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
- `CHK-01` `CHK-16` -> `TKT-16` `TKT-21` `TKT-24`
- `CHK-02` `CHK-06` `CHK-17` -> `TKT-22` `TKT-23` `TKT-25` `TKT-27`
- `CHK-05` `CHK-18` -> `TKT-20` `TKT-26`
- `CHK-07` -> `TKT-28`
- `CHK-13` -> `TKT-29`
- `CHK-12` -> `TKT-30`
- `CHK-14` `CHK-15` -> `TKT-31`
- `CHK-19` -> `TKT-25` `TKT-32` `TKT-33`
- `CHK-20` -> `TKT-29` `TKT-34`
- `CHK-21` -> `TKT-35` `TKT-36`
- `CHK-22` -> `TKT-37`
- `CHK-03` `CHK-15` -> `TKT-38`

# OpenShock Test Cases

**版本:** 1.28
**更新日期:** 2026 年 4 月 16 日
**关联文档:** [Product Checklist](../product/Checklist.md) · [PRD](../product/PRD.md)

---

## 一、执行状态定义

- `Pass`: 本轮已执行，结果符合预期
- `Fail`: 本轮已执行，但结果不符合预期
- `Not Run`: 功能存在或部分存在，但本轮没有完整执行
- `Blocked`: PRD 已定义，但当前仓库尚无可验收闭环

---

## 二、测试用例

## TC-001 Setup 壳层可见性

- 业务目标: 确认工作区初始化入口已经集中承载 repo、GitHub、runtime 和 bridge 四条主链。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-01` `CHK-04`
- 前置条件: web、server、daemon 已启动。
- 测试步骤:
  1. 打开 `/setup`。
  2. 检查页面是否存在 repo binding、GitHub readiness、runtime pairing、live bridge 四个区块。
- 预期结果: Setup 页能作为初始化控制台使用，不需要切换多个页面。
- 业务结论: Phase 0 初始化壳已经成立。

## TC-002 Repo Binding 绑定当前仓库

- 业务目标: 确认用户可以从 Setup 完成仓库绑定，不需要手工改后端状态。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-04`
- 前置条件: 当前仓库未绑定或允许重新绑定。
- 测试步骤:
  1. 打开 `/setup`。
  2. 点击“绑定当前仓库”。
  3. 刷新页面并检查绑定状态。
- 预期结果: server 写回 repo binding，页面显示当前仓库已绑定。
- 业务结论: 2026 年 4 月 7 日的 headed Setup harness 已重放这条路径；repo binding 写回后，Setup 会稳定显示“已绑定”。

## TC-003 Runtime Pairing 手动配对成功

- 业务目标: 确认 Setup 可以把 server 与当前活跃 daemon 重新配对。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-04` `CHK-14`
- 前置条件: daemon 在线，已知 daemon URL。
- 测试步骤:
  1. 打开 `/setup`。
  2. 输入 `http://127.0.0.1:18090`。
  3. 点击“配对 Runtime”。
  4. 读取 pairing 状态或继续执行 bridge prompt。
- 预期结果: pairing 状态更新为当前 daemon，后续 bridge 请求可达。
- 业务结论: 手动修正路径有效，但不能替代冷启动正确性。

## TC-004 Runtime Pairing 冷启动一致性

- 业务目标: 确认 server 冷启动后展示的 pairing URL 与真实活跃 daemon 一致。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-04` `CHK-14`
- 前置条件: server 和 daemon 使用非默认端口启动，且工作区已有 pairing 历史。
- 测试步骤:
  1. 启动 server 与 daemon。
  2. 读取 `GET /v1/runtime/pairing`。
  3. 直接调用 `POST /v1/exec` 验证 bridge。
- 预期结果: pairing URL 与活跃 daemon 一致，bridge 首次即可成功。
- 业务结论: 已通过 blocker 修复验收。当前冷启动在 `offline` 与 `stale` 两种窗口下都会回落到当前 daemon truth，pairing 与 bridge 首次一致。

## TC-005 创建 Issue 生成执行 lane

- 业务目标: 确认新需求可以从 board 或 API 直接进入执行链。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-05`
- 前置条件: server、daemon 在线，仓库可写。
- 测试步骤:
  1. 创建一条新 issue。
  2. 检查是否自动生成 room、run、session。
  3. 打开 `/agents`，检查 planner queue / governance replay 是否围同一条 issue 前滚。
  4. 检查 daemon 是否尝试创建对应 worktree lane。
- 预期结果: issue 创建后进入完整执行主链；人类能在 orchestration page 看到 planner dispatch、blocked escalation 与 closeout replay，而不是只剩隐式状态。
- 业务结论: 2026 年 4 月 9 日 `TKT-53` 新增 `pnpm test:headed-planner-dispatch-replay -- --report docs/testing/Test-Report-2026-04-09-planner-dispatch-replay.md`。当前 exact replay 已记录 `/board` 创建 issue、`/v1/planner/queue` visible item、`/agents` 上的 assignment / auto-merge guard / governed walkthrough，以及 `blocked` without note 的 `400` fail-closed probe 与 final response aggregation，因此这条工作流 B 主链现在不再只停在 Phase 0 的 room/run/session 基线，而是已经有 planner dispatch / first-instruction replay 证据。

## TC-006 Room / Run 详情可见性

- 业务目标: 确认执行真相能在 room 与 run detail 里被人类读到。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-05` `CHK-06`
- 前置条件: 至少存在一条 run。
- 测试步骤:
  1. 打开 `/rooms/:roomId`。
  2. 打开 `/runs/:runId` 或 `/rooms/:roomId/runs/:runId`。
  3. 检查 runtime、worktree、timeline、日志等执行信息。
- 预期结果: 人类能够从房间和 run detail 追踪执行上下文。
- 业务结论: 执行真相可见性基线成立。

## TC-007 全路由浏览器走查

- 业务目标: 确认 chat-first 壳的主要路由都能在 headed 浏览器中打开。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-01`
- 前置条件: web 服务在线。
- 测试步骤:
  1. 依次访问 `/`、`/setup`、`/chat/all`、`/board`、`/inbox`、`/issues`、`/rooms`、`/runs`、`/agents`、`/access`、`/memory`、`/settings`。
  2. 抽查 issue、room、run、agent 详情页。
- 预期结果: 主要页面可正常渲染，无整页崩溃。
- 业务结论: 壳层路由基线可用。

## TC-008 Agent 列表与详情

- 业务目标: 确认 Agent 已经是用户可见对象，而不是隐藏在 run 内的字段。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-02`
- 前置条件: 系统中存在预置 agent 数据。
- 测试步骤:
  1. 打开 `/agents`。
  2. 打开 `/agents/:agentId`。
  3. 检查 agent 与 runtime / run / workspace 的可见关系。
- 预期结果: 用户可以直接浏览 Agent 视图。
- 业务结论: Agent 一等对象的壳层基线成立，但画像与策略能力还未完整。

## TC-009 SSE 初始快照

- 业务目标: 确认前后台有最小实时 contract，而不是全靠页面刷新。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-03` `CHK-15`
- 前置条件: server 在线。
- 测试步骤:
  1. 请求 `GET /v1/state/stream`。
  2. 观察首个事件类型。
- 预期结果: 服务端立即返回 `event: snapshot` 的初始状态快照。
- 业务结论: 最小实时能力已存在。

## TC-010 Inbox 决策与 PR 收口

- 业务目标: 确认 blocked / approval / review 卡片可以成为人类收口面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-07` `CHK-08`
- 前置条件: 系统中存在 inbox 卡片，且不会触发真实远端 GitHub 变更。
- 测试步骤:
  1. 打开 `/inbox`。
  2. 对本地安全的卡片执行 `Approve`、`Defer` 或 `Resolve`。
  3. 检查状态是否回写到相关对象。
- 预期结果: Inbox 能完成本地决策闭环，并能跳回上下文。
- 业务结论: 2026 年 4 月 7 日 `TKT-10` 新增 `pnpm test:headed-approval-center-lifecycle`，在本地安全 state 上完成 approval / blocked / review lifecycle 的浏览器级回放；报告记录了 `/inbox` 直接消费 `/v1/approval-center`、Room / Run / PR back-link、recent resolution ledger，以及 `run_runtime_01`、`run_memory_01`、`pr-inbox-22` / `OPS-19` 的状态回写，因此这条本地决策闭环当前已可独立复核并通过。

## TC-011 未登录/低权限写入保护

- 业务目标: 确认关键写操作至少具备基础权限防线。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-08` `CHK-12`
- 前置条件: 准备 signed-out 与 viewer 两种身份。
- 测试步骤:
  1. 以未登录身份调用 `POST /v1/issues`。
  2. 以 viewer 身份调用同一接口。
  3. 检查 issue 总数是否变化。
- 预期结果: 分别返回 `401` 与 `403`，且数据不被写入。
- 业务结论: 基础 authz guard 已成立。

## TC-012 Access / Session / Members 基础读取

- 业务目标: 确认身份与成员相关的基础读取面已经进入产品壳。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-03` `CHK-13`
- 前置条件: server 在线。
- 测试步骤:
  1. 访问 `/access`。
  2. 请求 `/v1/auth/session` 与 `/v1/workspace/members`。
- 预期结果: 页面和 API 都能返回当前会话与成员基线数据。
- 业务结论: 2026 年 4 月 7 日 `TKT-07` 已把 auth session / member / role truth 正式接进 `/access` 前台；页面不再停在静态边界说明，而会直接显示当前 session、member roster、role definitions 与权限差异。基础读取面继续保持 Pass。

## TC-013 Memory 列表与详情

- 业务目标: 确认文件级记忆不只是 PRD 口号，而有真实可见面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-10`
- 前置条件: 工作区存在 memory 数据。
- 测试步骤:
  1. 访问 `/memory`。
  2. 请求 `/v1/memory` 与 `/v1/memory/:id`。
- 预期结果: 能看到 memory 列表和详情。
- 业务结论: 文件级记忆读取面已成立。

## TC-014 邮箱登录、成员角色、邀请

- 业务目标: 确认团队级身份体系已经产品化。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-02` `CHK-13`
- 前置条件: server 在线，当前 session 具备 owner 身份。
- 测试步骤:
  1. 在 `/access` 以 owner 邀请成员加入 workspace。
  2. 调整其 role / status，并用 quick login 验证首次登录激活。
  3. 验证 suspended 成员会被 fail-closed 挡回，而不是静默放行。
- 预期结果: 团队成员 invite / role / status / login 生命周期形成真实闭环。
- 业务结论: 2026 年 4 月 7 日 `TKT-08` 新增 `pnpm test:headed-workspace-member-role`，在浏览器里完成 `invite -> role change -> member login activation -> suspend blocked` 回放；owner-side `/access` roster mutation 已直接接到 live API，invited member 首次登录会转成 `active`，suspended login 会显式返回 `workspace member is suspended`。设备授权与完整邮箱验证流程继续留在后续范围，但这条团队成员基础生命周期当前已可独立复核并通过。

## TC-015 GitHub App 安装与 Webhook

- 业务目标: 确认 GitHub 授权和事件回流进入真实产品闭环。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-07` `CHK-13`
- 前置条件: 存在 GitHub App 安装流、webhook ingest 与签名校验。
- 测试步骤:
  1. 完成 GitHub App 安装。
  2. 触发 webhook 事件。
  3. 检查 state / inbox / room / PR 是否同步更新。
- 预期结果: GitHub 事件可以持续同步回 OpenShock。
- 业务结论: 2026 年 4 月 8 日 `TKT-28` 新增 `/v1/github/installation-callback` 与 `/setup/github/callback`，把 installation-complete 回跳直接写回 installation truth，并在同一次 callback 内前滚 repo binding 与 tracked PR backfill；同日 exact-head 还新增了 fail-closed 的空 `installationId` 探测与 `repo.admin` 权限 guard。2026 年 4 月 9 日 `TKT-57` 又补了 production-style public ingress harness：Setup 直接暴露 public callback / webhook URL，`/setup/github/callback` 与 signed webhook delivery 都能通过同一 public root exact replay，bad-signature 继续 401 fail-closed。因此这条用例现在不只停在近实机 contract，而是已经有 public ingress 级证据。

## TC-045 GitHub Public Ingress Callback / Webhook Delivery

- 业务目标: 确认 GitHub callback / webhook 不只在内网 server contract 可用，而是能在 public ingress 根路径下被同一套产品 surface 复核。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-07`
- 前置条件: server 已配置 `OPENSHOCK_CONTROL_URL`、GitHub App install surface、webhook secret 与本地 public ingress proxy。
- 测试步骤:
  1. 在 Setup 检查 surfaced public callback URL / webhook URL。
  2. 通过 public ingress 打开 `/setup/github/callback?installation_id=...`，确认 installation truth 写回并回跳 Setup。
  3. 通过 public ingress POST signed webhook，并再做一次 bad-signature adversarial probe。
- 预期结果: callback / webhook 都能走同一 public ingress 根路径；错误签名继续 fail-closed。
- 业务结论: 2026 年 4 月 9 日 `TKT-57` 新增 `pnpm test:headed-github-public-ingress`，用 local ingress proxy 同时代理 web + API，验证 public callback / webhook URL surface、callback return page 回流，以及 signed webhook / bad-signature 都走 ingress `/v1/github/webhook`。这条 public ingress exact evidence 现已可独立复核并通过；若后续还要做真正 Internet / DNS / TLS 演练，那属于环境级演练，不再是产品 contract GAP。

## TC-016 真实远端 PR 创建、同步与合并

- 业务目标: 确认 PR 真相不止停留在本地状态对象。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-07`
- 前置条件: 存在真实远端仓库与安全测试环境。
- 测试步骤:
  1. 从 room 发起 PR。
  2. 观察远端 PR 是否创建。
  3. 执行 review / merge 并检查状态回流。
- 预期结果: PR 生命周期能在 OpenShock 与 GitHub 间双向同步。
- 业务结论: 2026 年 4 月 7 日 `TKT-06` 新增 `pnpm test:headed-remote-pr-loop`，在安全 sandbox base branch 上完成 `/setup -> issue -> room -> remote PR create -> merge` 的浏览器级实机回放；报告已记录真实远端 PR `#9` 从 `OPEN -> MERGED`，且 safe base / remote head 清理通过，因此这条真实远端 PR 闭环当前已可独立复核并通过。

## TC-017 浏览器 Push / 邮件通知

- 业务目标: 确认高时效事件能主动触达，而不是等人刷新页面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-11`
- 前置条件: 存在通知发送器、模板与订阅模型。
- 测试步骤:
  1. 在 `/settings` 写入 workspace browser/email policy，并接入 current browser / email subscribers。
  2. 先用 invalid email target 执行一次 fanout，确认 failed receipts 与 subscriber `lastError` 显式可见。
  3. 修正 email target 后重跑 fanout，确认 browser push / email receipts 转成 delivered。
- 预期结果: 高时效事件有可靠通知，失败和重试状态也能被人类显式看到。
- 业务结论: 2026 年 4 月 7 日 `TKT-11` 新增 `pnpm test:headed-notification-preference-delivery`，在 headed browser 里把 `/settings` 上的 workspace policy、current browser subscriber、email subscriber、fanout receipts 与 retry contract 串成同一条 exact replay。invalid email target 会 fail closed 并留下 `lastError` / failed receipts，修正为 `ops@openshock.dev` 后 same-page retry 会转成 delivered；current browser subscriber 也会把 sent browser receipts 落成 local notification。当前这条 browser push / email delivery loop 已可独立复核并通过；invite / verify / reset password 继续留在后续身份链路范围。

## TC-018 Stop / Resume / Follow Thread

- 业务目标: 确认人类可以在执行中真正接管、暂停和恢复。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-01` `CHK-06` `CHK-09`
- 前置条件: 存在 stop / resume / follow-thread UI 与后端状态机。
- 测试步骤:
  1. 让一条 run 进入执行中。
  2. 执行暂停、恢复、接续线程。
  3. 检查 room、run、inbox 是否同步更新。
- 预期结果: 人类纠偏能力成为产品能力，而不是文案。
- 业务结论: 2026 年 4 月 7 日 `TKT-13` 新增 `POST /v1/runs/:id/control`、room / run 控制面与 `pnpm test:headed-stop-resume-follow-thread`。当前浏览器 exact replay 已在 `/rooms/room-runtime` 和 `/runs/run_runtime_01` 上独立验证 `stop -> follow_thread -> resume`，并确认 paused run 会冻结普通 room composer、follow-thread 会跨 resume 保持、`/inbox` recent ledger 会按顺序写回 `Run 已暂停` / `已锁定当前线程` / `Run 已恢复`。这条人类接管闭环当前已可独立复核并通过。

## TC-019 记忆注入与 Skill / Policy 提升

- 业务目标: 确认记忆不仅可写回，也能被检索、提升和治理。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-10`
- 前置条件: 存在 memory injection、promotion、review 机制。
- 测试步骤:
  1. 执行一条带记忆写回的任务。
  2. 在下一条任务中验证记忆注入。
  3. 将高价值经验提升为 skill 或 policy。
- 预期结果: 记忆形成可治理的增强循环。
- 业务结论: 2026 年 4 月 7 日 `TKT-12` 新增 `/v1/memory-center`、`pnpm test:headed-memory-governance` 和对应浏览器级 report；当前 `memory` 页已能直接展示 session-level injection preview、policy mutation、skill/policy promotion queue，并把 approve 后的 `notes/skills.md`、`notes/policies.md` 重新带回 next-run preview，所以这条 memory injection / governance / promotion loop 当前已可独立复核并通过。

## TC-020 多 Runtime 调度与 Failover

- 业务目标: 确认系统可以管理多个 runtime，而不是只有单机配对。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-12` `CHK-14`
- 前置条件: 存在多个活跃 runtime、scheduler 与 selection 策略。
- 测试步骤:
  1. 注册多个 runtime。
  2. 创建 run 并观察调度决策。
  3. 模拟一个 runtime offline，检查 failover。
- 预期结果: 调度、离线态、切换都可见且可验证。
- 业务结论: 2026 年 4 月 7 日 `TKT-14` 新增 lease-aware runtime scheduler、显式 failover summary，以及 `pnpm test:headed-multi-runtime-scheduler-failover` 浏览器级回放；当前 `/setup` 与 `/agents` 已能直接展示 next-lane、active leases、scheduler strategy，selected runtime offline 时也会显式 failover 到 least-loaded runtime，并把 failover reason 回写到 run detail truth，所以这条 multi-runtime scheduler / failover 验证当前已可独立复核并通过。

## TC-021 Release Gate 对 pairing 漂移的拦截

- 业务目标: 确认工程回归门能识别 Setup 主链上的真实失败，而不是假绿。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-15`
- 前置条件: `ops:smoke` 与真实 daemon 运行在非默认端口。
- 测试步骤:
  1. 执行 `pnpm ops:smoke`。
  2. 对比 pairing URL 与 runtime registry/实际 bridge 结果。
- 预期结果: smoke 失败并指出 pairing 漂移。
- 业务结论: 当前 smoke 会显式比对 pairing URL、runtime registry、server runtime bridge 与 daemon runtime 的 daemon URL；pairing 漂移时会 fail-closed 并指出 mismatch。2026 年 4 月 11 日 `TKT-41` 又新增 `pnpm test:headed-pr-conversation-usage-observability`，在 Windows Chrome 中继续把 `/rooms/:id?tab=run -> /runs/:id -> /settings` 的 run / room / workspace usage、quota、retention 与 warning 一次性回放，因此这条 `CHK-15` 已不再只靠 release smoke，而是也有正式产品面证据；同一份 headed evidence 也把 `TKT-48` 的 workspace plan / usage / retention surface 一并收口。

## TC-022 GitHub App Effective Auth PR Contract

- 业务目标: 确认配置 GitHub App 后，PR create / sync / merge 会切到 app-backed 路径，而不是硬依赖 `gh`。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-07`
- 前置条件: 配置 `OPENSHOCK_GITHUB_APP_*` 环境变量，并准备可控的 GitHub API 假服务。
- 测试步骤:
  1. 以 contract test 方式触发 PR create。
  2. 再触发 PR sync / merge。
  3. 验证请求使用 installation token，并在 review-decision GraphQL 失败时返回 blocked escalation。
- 预期结果: effective auth path 为 `github-app` 时，PR create / sync / merge 走 app-backed 逻辑，失败路径可被显式捕获。
- 业务结论: 服务器端 GitHub App PR contract 已落地；2026 年 4 月 7 日又补齐了 Setup 对 preferred auth path、missing fields、installation URL 和 repo binding blocked contract 的浏览器级 onboarding 证据，但 webhook / live repo 回放仍未完成。

## TC-023 Memory Version / Governance Contract

- 业务目标: 确认 memory 不只是文件落盘，还具备版本、治理和详情读取合同。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-10`
- 前置条件: store 在测试工作区初始化成功。
- 测试步骤:
  1. 读取 `MEMORY.md` 的 memory detail。
  2. 触发 issue / conversation 写回。
  3. 重启 store 并模拟外部文件修改。
- 预期结果: memory artifact 版本递增，带 governance 元数据，并能把外部编辑同步成新版本。
- 业务结论: 2026 年 4 月 14 日又补了 `TestMemoryCleanupDueRunExecutesOnlyWhenQueueNeedsPruning` 与 `TestMemoryCenterCleanupRouteSupportsDueModeAndSchedule`，把 memory center 的 `due / dueCount / nextRunAt` schedule truth，以及 safe `POST /v1/memory-center/cleanup?mode=due` 合同一起锁进 store/API。现在 cleanup 不再只是“手动点一下看看”，而是已经能稳定暴露“当前是否到期、下一次大概何时该跑”的 durable truth，因此这条 memory version / governance contract 继续保持 `Pass`。

## TC-024 Role / Permission Action Matrix

- 业务目标: 确认不同角色对 issue、room、run、repo binding、PR、inbox 的动作边界清楚。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-12` `CHK-13`
- 前置条件: 存在 admin / reviewer / viewer 三种角色。
- 测试步骤:
  1. 分别以三种角色访问关键写接口和对应前端入口。
  2. 检查允许、拒绝、禁用状态是否一致。
- 预期结果: 权限矩阵在 UI 和 API 两侧一致，不存在越权写入。
- 业务结论: 2026 年 4 月 7 日 `TKT-09` 把 Board / Room / Inbox / Setup 的关键 mutation 入口正式接到 live auth session permission truth，并新增 `pnpm test:headed-action-authz-matrix` 独立回放 owner / member / viewer / signed-out 四个窗口下的前台 enable / disable / deny state；同次还用 targeted `go test ./internal/api -run 'TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces' -count=1` 锁住 `/v1/issues`、`/v1/rooms/:id/messages`、`/v1/exec`、`/v1/inbox/:id`、`/v1/repo/binding`、`/v1/runtime/*`、`/v1/pull-requests/:id` 的 allow/deny contract。当前这条跨 issue / room / run / inbox / repo / runtime 的 action matrix 已可独立复核并通过。

## TC-025 GitHub Webhook Replay / Review Sync

- 业务目标: 确认 webhook 事件可以把 review / comment / merge 状态同步回 OpenShock。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-07`
- 前置条件: 存在 webhook fixture 或可控 replay 环境。
- 测试步骤:
  1. 回放 pull request、review、comment、merge 事件。
  2. 检查 state / inbox / room / pull request 是否更新。
- 预期结果: webhook 事件被规范化、验签、写回，且失败态可见。
- 业务结论: 2026 年 4 月 7 日新增 `pnpm test:webhook-replay`，会起临时 `openshock-server` 并对 `/v1/github/webhook` 回放 signed review / comment / check / merge 事件，同时验证 bad-signature 与 untracked PR failure contract。2026 年 4 月 11 日 `TKT-39` 又补了 `pnpm test:headed-pr-conversation-usage-observability`：同一条 review replay 现在会把 `changes_requested -> review_comment -> review_thread(resolved)` 回写进 PR conversation ledger，并在浏览器里验证 `Inbox -> Room PR tab -> PR Detail` 三处都沿同一条 review 上下文回链。因此这条 webhook review sync 现在不只停在 API replay，而是已有产品面 back-link 证据。

## TC-026 Headed Setup 到 PR Journey

- 业务目标: 在非无头浏览器里串起 Setup 主链、Issue lane 和 PR 前置链。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-04` `CHK-05` `CHK-07` `CHK-15`
- 前置条件: headed browser automation harness 已存在，server / daemon / web 可启动。
- 测试步骤:
  1. 打开 `/setup`，完成 repo binding、GitHub readiness、runtime pairing、bridge prompt。
  2. 创建一条 issue，进入 room / run。
  3. 验证 PR 入口处于可继续推进状态。
- 预期结果: Setup 到执行 lane 的用户旅程可稳定自动化回放。
- 业务结论: 2026 年 4 月 7 日已先用 headed Chromium harness 稳定回放 `Setup -> Issue -> Room`，验证 room 内 PR 入口保持可继续推进状态；同日 `TKT-06` 又把 `/setup -> issue -> room -> remote PR create -> merge` 接成真实远端浏览器闭环，并把 no-auth failure path 显式打到 room / inbox / blocked surface。2026 年 4 月 11 日 `TKT-39` `TKT-41` `TKT-48` 进一步补了 `pnpm test:headed-pr-conversation-usage-observability`，把 room 之后的 `PR Detail / Room PR tab / Inbox back-link / run-room-workspace usage` 再串成一条 headed walkthrough；同日 `TKT-49` 又新增 `pnpm test:headed-delivery-entry-release-gate`，把 PR detail 上的 release gate、handoff note、delivery template 与 evidence bundle 做成独立的 Windows Chrome drill-in。因此这条 PR journey 当前不仅能到 PR 入口，还能继续验证交付判断与 closeout contract 的后半段收口。

## TC-027 Sandbox / Destructive Approval Guard

- 业务目标: 确认 destructive git、越界写入、敏感凭证使用会进入审批保护，而不是默认执行。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-12`
- 前置条件: 存在 sandbox mode 与 approval-required contract。
- 测试步骤:
  1. 触发 destructive git 或越界写入动作。
  2. 检查系统是否拦截并生成 approval item。
- 预期结果: 高风险动作不会直接执行，系统产生显式审批记录。
- 业务结论: 2026 年 4 月 8 日 `TKT-30` 已新增 `pnpm test:headed-destructive-guard -- --report docs/testing/Test-Report-2026-04-08-destructive-guard.md`。当前 destructive git 与跨 scope 写入都会先进入显式 guard truth，`/inbox` 能看到 `Action / Sandbox / Secrets / Target` 边界，`/rooms/:roomId` 与 `/runs/:runId` 也会复用同一 guard 状态；并且 non-happy `defer` 路径会把 destructive run 保持在 `blocked + approval_required`，不会静默继续执行。2026 年 4 月 11 日 `TKT-46` 又用 `pnpm test:headed-restricted-sandbox-policy` 补了 Windows Chrome 有头证据，把 `restricted profile -> allowlist check -> approval_required -> same-target override/retry -> reload persistence` 收成同一条 run-level policy loop，因此这条安全 gate 继续保持 `Pass`。

## TC-028 app.slock.ai Shell / Sidebar / Search Entry

- 业务目标: 确认 OpenShock 已从“多页面控制台”收成 `app.slock.ai` 式 workspace shell。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-01` `CHK-16`
- 前置条件: 新壳已接到 live workspace state。
- 测试步骤:
  1. 打开默认入口，确认先进入统一 workspace shell。
  2. 检查 sidebar 是否存在 workspace context、频道、讨论间、inbox、board、presence 和 `Chat / Work` 切换。
  3. 检查 Quick Search 入口是否常驻可见，且 `setup / issues / memory / inbox / board / room / run` 都处于同一套壳层内。
- 预期结果: 用户在同一层级完成主要协作导航，不需要先跳到 setup/board 之类 utility page。
- 业务结论: 2026 年 4 月 8 日新的 work shell smoke 已在有头浏览器下连续走查 `/chat/all`、`/setup`、`/issues`、`/memory`、`/inbox`、`/board`、`/rooms/room-runtime`、`/runs/run_runtime_01`；当前统一壳层、`Chat / Work` 激活态、同源 proxy 与次级 Board 位置都已站住，因此这条用例当前转为 `Pass`。真正的 search result / command palette 能力继续拆给后续票，不和这条壳层收口混写。

## TC-029 DM / Thread / Saved Workflow

- 业务目标: 确认 DM、followed thread、saved/later 已形成完整消息工作流。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-16` `CHK-17`
- 前置条件: 存在 DM、线程关注和 saved/later 的前台入口与状态模型。
- 测试步骤:
  1. 从 sidebar 进入一条 DM。
  2. 在频道中打开并 follow 一条 thread。
  3. 从 saved/later 或 followed threads 再次回到该 thread。
- 预期结果: DM、线程回访和暂存面在同一套壳层里闭环可用。
- 业务结论: 2026 年 4 月 8 日 `TKT-22` 已用 `pnpm test:headed-dm-followed-thread-saved-later -- --report docs/testing/Test-Report-2026-04-08-dm-followed-thread-saved-later.md` 完成有头 exact replay；当前 sidebar 已能直达 DM，channel thread rail 可直接 `follow` 与 `save later`，并且 `Followed Threads` / `Saved Later` 两个回访面都能把同一条 thread 重新打开回 chat，因此这条用例当前转为 `Pass`。`TKT-27` 继续负责把这条前台工作流补成正式 server contract，而不是否定当前前台闭环已经成立。

## TC-030 Agent / Machine / Human Profile Surface

- 业务目标: 确认人物与机器不只是列表项，而是可直接 drill-in 的资料面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-02` `CHK-17`
- 前置条件: `Agent / Machine / Human` 至少都有 profile route 或 profile panel。
- 测试步骤:
  1. 从 shell 或 room 中点击一个 Agent。
  2. 再点击一个 Machine 和一个 Human。
  3. 检查 presence、activity、runtime/capability、最近 run/room 关系是否可见。
- 预期结果: `Agent / Machine / Human` 都成为可导航的一等对象。
- 业务结论: `TKT-25` 已把 shell / room 的 Agent、Machine、Human summary 接成统一 profile drill-in；这条用例现在按 headed `room -> agent profile -> machine profile -> human profile` 回放转 `Pass`，后续 editor / persistence 仍留 `TKT-32/33/37`。

## TC-031 Room Context Tabs / Topic Workbench

- 业务目标: 确认 Room 已经成为主工作台，而不是聊天页再跳多个详情页。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-06` `CHK-17`
- 前置条件: room 已提供 chat-first 主面，并保留 `Topic / Run / PR / Context` 的次级 sheet 或等价切换面。
- 测试步骤:
  1. 打开一条 room。
  2. 默认确认聊天主面直接可用，再在不离开 room 的情况下打开 `Topic / Run / PR / Context` 次级 sheet。
  3. 验证 run control、PR entry、inbox back-link 仍保持可用。
- 预期结果: 用户围绕同一条 room 完成讨论、执行、交付和回溯，不需要频繁跨页。
- 业务结论: `TKT-23` 已用 `pnpm test:headed-room-workbench-topic-context` 完成有头 exact replay，并在 2026 年 4 月 11 日收成 chat-first room shell。当前 `/rooms/:roomId` 默认先回到聊天主面，`Topic / Run / PR / Context` 退成 room 内的次级 sheet；`follow_thread` 仍可在 Run sheet 使用，PR entry 不再强制跳独立详情页，Context sheet 也能在 reload 与 inbox 往返后保留 room-first 状态。2026 年 4 月 14 日又新增 `pnpm test:headed-room-chat-reload-continuity -- --report output/testing/headed-room-chat-reload-continuity-report.md`，把 room 内 thread 选择、reply target、thread rail 与未发送 draft 的 reload continuity 也补成有头证据，因此这条用例当前继续保持 `Pass`。

## TC-032 Board Planning Mirror Surface

- 业务目标: 确认 Board 仍可用，但已经退到次级 planning surface。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-05` `CHK-18`
- 前置条件: board 已与 room / issue context 建立回跳关系，且主导航优先级已下调。
- 测试步骤:
  1. 从 room 或 issue 进入 planning surface。
  2. 查看 board lane 并创建或打开一条 issue。
  3. 返回 room，确认 Board 不是默认首页心智中心。
- 预期结果: Board 服务于规划，不抢占协作壳主路径。
- 业务结论: 2026 年 4 月 11 日 `TKT-26` 已用 `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-board-planning-surface -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-board-planning-surface.md` 完成有头 exact replay。当前 `/board` 会带上 room / issue context 并显式提供回跳按钮，顶栏与摘要条已压成紧凑 planning mirror，lane 区也从超宽 6 栏主工作台收成 room-return 优先的次级规划面，因此这条用例当前继续保持 `Pass`。

## TC-033 Quick Search / Search Result Surface

- 业务目标: 确认 Quick Search 不只是静态入口，而是可真正切换 channel / room / issue / run / agent 的结果面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-16`
- 前置条件: 存在 Quick Search 数据源、结果列表与跳转动作。
- 测试步骤:
  1. 打开 Quick Search。
  2. 输入 channel、room、issue、run、agent、dm、followed-thread、saved-later 关键词。
  3. 选择结果并验证跳转、reopen 与高亮。
- 预期结果: 用户不需要人工翻左栏，就能快速切换到目标工作面，并能从 search result 直接重新打开 followed / saved 的消息回访面。
- 业务结论: 2026 年 4 月 8 日 `TKT-21` 新增 `pnpm test:headed-quick-search`，先在 headed Chromium 里完成 `channel -> room -> issue -> run -> agent` 的跨类型搜索回放，并验证三种打开方式（侧栏 trigger、顶部 trigger、`Ctrl+K`）、命中高亮与 `No matches yet` empty state。2026 年 4 月 9 日 `TKT-27` 再用同一条脚本把 `dm -> followed -> saved` 三类 message-surface result 补成 server-backed exact replay，报告见 `docs/testing/Test-Report-2026-04-09-quick-search-message-surface-contract.md`。当前 Quick Search 已不再只是静态入口，而是可独立复核的真实 search result surface。

## TC-034 Frontend Interaction Polish Sweep

- 业务目标: 确认聊天工作台的滚动、下拉、字号、输入框与高亮位置都符合高频使用习惯。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-01` `CHK-16` `CHK-17`
- 前置条件: 统一壳层已经存在，并可在浏览器里持续操作 channel / room / inbox / setup。
- 测试步骤:
  1. 在 channel 和 room 中来回滚动历史消息，确认滚动位置不会异常丢失。
  2. 检查 sidebar / channel / room 下拉与高亮位置是否稳定、紧凑、易读。
  3. 检查 composer 是否始终可见，字号和间距是否不会把信息打散。
- 预期结果: 产品在高频聊天和切换场景下保持顺手，而不是只有静态截图好看。
- 业务结论: 2026 年 4 月 8 日 `TKT-24` 已新增 `pnpm test:headed-frontend-interaction-polish`，在 headed Chromium 下连续复核了 sidebar / topbar 命中区、`channel / room` scrollback、composer 常驻、room 现有 `Issue / Board / Thread` 动作命中区，以及 `1180px` 窄屏无横向溢出。当前 `docs/testing/Test-Report-2026-04-08-frontend-interaction-polish.md` 已记录命中区尺寸、viewport 可见性与截图证据，因此这条用例当前转为 `Pass`。

## TC-035 Device Authorization / Email Verification Lifecycle

- 业务目标: 确认设备授权、邮箱验证、密码重置和外部身份绑定进入同一条产品化身份链。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-13`
- 前置条件: 存在 device authorization、email verify / reset、session recovery 的真实产品流。
- 测试步骤:
  1. 新成员首次登录后触发邮箱验证或设备授权。
  2. 在另一设备上恢复登录并验证权限链。
  3. 触发邮箱重置并确认 session / member state 同步更新。
- 预期结果: 身份链不再只停留在 invite / role / quick login，而是具备完整恢复和验证能力。
- 业务结论: 2026 年 4 月 8 日 `TKT-29` 已新增 `pnpm test:headed-device-auth-email-recovery`，在 headed Chromium 下把 invited member 登录、email verify、current-device authorization、password reset on another device、external identity binding 串成同一条 exact replay。2026 年 4 月 11 日 `TKT-44` 又新增 `pnpm test:headed-identity-template-recovery-journey`，把 `/settings` identity template chain 与 `/access` invite / verify / reset / blocked recovery 合成同一条 Windows Chrome delivery journey。当前 `docs/testing/Test-Report-2026-04-08-device-auth-email-recovery.md` 与 `docs/testing/Test-Report-2026-04-11-windows-chrome-identity-template-recovery-journey.md` 已共同覆盖恢复状态与模板投递证据，因此这条用例继续保持 `Pass`。

## TC-036 Agent Profile / Prompt / Avatar / Memory Binding Edit

- 业务目标: 确认 Agent 已经从只读对象升级成可配置执行者。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-02` `CHK-10` `CHK-19`
- 前置条件: 至少存在一个可编辑的 Agent profile surface。
- 测试步骤:
  1. 打开某个 Agent profile。
  2. 编辑 `role / avatar / prompt / memory binding / provider preference`。
  3. 保存后刷新页面，并检查 next-run preview 与 file-level `SOUL.md / MEMORY.md / notes/*` stack 是否读取新配置与挂载关系。
- 预期结果: Agent profile edit 会持久化并影响下一次 run 的配置注入，且 profile 会显式暴露 file-backed memory/rule stack 与 preview linkage。
- 业务结论: `TKT-32` 已把 Agent profile editor、memory binding / recall policy / provider preference、file-level `SOUL.md / MEMORY.md / notes/*` stack、next-run preview 与 profile audit 接成同一条链；这条用例现在按 headed `profile -> edit -> save -> reload` 回放转 `Pass`，machine inventory 继续留 `TKT-33`，更宽的 workspace / member durable config 与 recovery truth 继续留 `TKT-37`。

## TC-037 Machine Profile / Local CLI Model Capability Binding

- 业务目标: 确认 Runtime / Machine 的真实能力可以被人类看到，并和 Agent 偏好绑定。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-14` `CHK-19` `CHK-22`
- 前置条件: 存在 machine profile、capability catalog 和 Agent capability preference surface。
- 测试步骤:
  1. 打开 machine profile 或 setup capability 面。
  2. 读取本地 CLI / provider truth 与 provider model catalog suggestion。
  3. 为某个 Agent 绑定 default provider / model / runtime affinity，并验证保存结果；model 字段允许输入 catalog 外的本机配置值。
- 预期结果: Machine capability truth 和 Agent 偏好使用同一份后端配置真相；provider/model catalog 只做 suggestion，不按静态列表硬拒绝。
- 业务结论: 2026 年 4 月 9 日 `TKT-33` 已新增 `pnpm test:headed-machine-profile-capability-binding`，在 headed Chromium 下把 `/setup`、machine profile、Agent profile editor 和 `/agents` 串成同一条 exact replay。当前 `docs/testing/Test-Report-2026-04-09-machine-profile-capability-binding.md` 已记录 shell / daemon / provider-model catalog 与 agent provider+model+runtime affinity 的同源读写证据，并覆盖 catalog 外 model 仍可保存的回放，因此这条用例当前转为 `Pass`；更重的 durable config / database recovery 继续留给 `TKT-37 / TC-040`。

## TC-038 Onboarding Wizard / Scenario Template Bootstrap

- 业务目标: 确认新团队可以通过模板完成首次启动，而不是手工拼页面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-20`
- 前置条件: 存在 onboarding wizard、template selection 与 resumable progress。
- 测试步骤:
  1. 创建或进入一个全新 Workspace。
  2. 选择 `开发团队`、`研究团队` 或 `空白自定义` 模板。
  3. 完成 repo / GitHub / runtime pairing，并检查默认 channels、roles、agents、policy 是否被物化。
- 预期结果: 用户可以在一个连续 flow 内完成团队启动，并在中断后继续。
- 业务结论: 2026 年 4 月 9 日 `TKT-34` 已新增 `pnpm test:headed-onboarding-studio`，把 `/setup` 上的模板选择、onboarding progress refresh、finish flow 与 durable recovery 串成 exact replay。当前 `docs/testing/Test-Report-2026-04-09-onboarding-studio.md` 已记录 `研究团队` 模板的 bootstrap package、finish 后 `/rooms` resume route，以及 browser reload、server restart、second browser context 继续读取同一份 onboarding truth 的证据，因此这条用例当前转为 `Pass`；更重的多 Agent team topology / reviewer-tester loop 继续留给 `TC-041 / TKT-36`。

## TC-039 Agent Mailbox / Handoff Governance Ledger

- 业务目标: 确认 Agent-to-Agent 正式通信和交接可被追踪，而不是藏在隐式提示词里。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 存在 Agent Mailbox、handoff lifecycle 和 human-visible ledger。
- 测试步骤:
  1. 让一个 Agent 向另一个 Agent 发起 handoff。
  2. 观察 `ack / blocked / complete` 生命周期。
  3. 在 Room / Inbox / Mailbox 中检查上下文回链和人类 override。
- 预期结果: 正式交接可见、可回放、可审计。
- 业务结论: 2026 年 4 月 9 日 `TKT-35` 已新增 `/v1/mailbox` create/detail/update contract、Mailbox ledger UI，以及 headed `pnpm test:headed-agent-mailbox-handoff`。当前 `docs/testing/Test-Report-2026-04-09-agent-mailbox-handoff.md` 已记录 create -> blocked(note required) -> acknowledged -> completed 的 exact replay，并验证 room backlink、`/inbox?handoffId=...` 聚焦、owner transfer 与 closeout writeback 都读同一份 truth，因此这条用例当前转为 `Pass`；更重的多 Agent team topology / reviewer-tester loop 继续留给 `TC-041 / TKT-36`。

## TC-040 Config Persistence / Recovery

- 业务目标: 确认 workspace / member durable config 与 onboarding recovery truth 能跨刷新、重启和换设备恢复。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-22`
- 前置条件: 存在 durable store / database schema 与相关 API contract。
- 测试步骤:
  1. 编辑一组 workspace 或 member 配置。
  2. 刷新浏览器并重启 server。
  3. 在同设备或另一设备重新进入，检查配置是否保持一致。
- 预期结果: workspace / member 配置与 onboarding 恢复真相不依赖浏览器本地临时状态，且恢复后 `/settings`、`/access`、`/setup` 读取到同一份 durable snapshot。
- 业务结论: 2026 年 4 月 9 日 `TKT-37` 已新增 `/v1/workspace` durable config patch、`/v1/workspace/members/:id/preferences` member preference patch，以及 headed `pnpm test:headed-config-persistence-recovery`。当前 `docs/testing/Test-Report-2026-04-09-config-persistence-recovery.md` 已记录 `/settings` 写回 workspace/member config 后，`/access` 与 `/setup` 同源投影、browser reload、server restart、second browser context recovery 的 exact evidence，因此这条用例当前转为 `Pass`。

## TC-041 Multi-Agent Role Topology / Reviewer-Tester Loop

- 业务目标: 确认 `开发团队 / 研究团队` 这类模板不只是静态角色表，而能形成受治理的多 Agent 响应链。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-20` `CHK-21`
- 前置条件: 存在 team topology、Agent Mailbox、handoff policy 和 response aggregation。
- 测试步骤:
  1. 选择一个团队模板并创建 issue。
  2. 观察 PM / Architect / Developer / Reviewer / QA 或研究团队变体的 handoff 流。
  3. 检查 review / test / blocked escalation 与 human override 是否可见。
- 预期结果: 多 Agent 分工和最终响应被治理，而不是只有一串不可解释的自动消息。
- 业务结论: 2026 年 4 月 9 日 `TKT-36` 已新增 `workspace.governance` 派生快照、`/setup` governance preview、`/mailbox` 上的 topology / review-test-blocked-human-override surface，以及 headed `pnpm test:headed-multi-agent-governance -- --report docs/testing/Test-Report-2026-04-09-multi-agent-governance.md`。当前 exact replay 已记录模板起链、formal handoff、blocked escalation、final response aggregation 与显式 human override gate 的同源证据，因此这条用例当前转为 `Pass`。

## TC-042 Live Truth Hygiene / Placeholder Leak Guard

- 业务目标: 确认 `/v1/state`、`/v1/state/stream` 与前台 state adapter 不会把 placeholder、乱码、fixture / test residue 或内部 worktree 路径直接漏到用户可见面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-03` `CHK-15`
- 前置条件: 存在 dirty live-state copy，且前台通过 Phase Zero state / SSE 消费当前真相。
- 测试步骤:
  1. 用带 placeholder / E2E residue / internal path 的 dirty state copy 启动临时 server。
  2. 读取 `/v1/state` 与 `/v1/state/stream`，只围用户可见字段做 negative scan。
  3. 运行 `pnpm check:live-truth-hygiene` 与 `pnpm verify:release`，确认 release gate 会拦脏 truth 回灌。
- 预期结果: 用户可见字段全部 fail-closed；release gate 对 placeholder wording、direct mock-data import 和 tracked live-truth residue 给出硬失败。
- 业务结论: 2026 年 4 月 9 日 `TKT-38` 已把 state / SSE visible truth sanitization、client-side state adapter guard、copy cleanup 与 `check:live-truth-hygiene` release gate 接成同一条验证链。当前 `docs/testing/Test-Report-2026-04-09-live-truth-hygiene.md` 已记录 dirty-state adversarial probe、targeted go tests 和 `verify:release` 结果，因此这条用例转为 `Pass`。

## TC-043 Run History / Incremental Fetch / Resume Context

- 业务目标: 确认 `/runs` 不再一次性倾倒全量 run ledger，且人类可以围绕同一条 room 回看历史 run、打开 prior run，并拿到可恢复的 session context。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-06`
- 前置条件: 存在 `/v1/runs/history`、`/v1/runs/:id/detail`、`Load Older Runs` UI，以及 run detail / room run tab 的 resume context surface。
- 测试步骤:
  1. 打开 `/runs`，确认首屏只显示最新一页 history，并通过 `Load Older Runs` 增量展开更早 run。
  2. 打开当前 run detail，检查 session id、branch/worktree、memory paths 与同 room prior-run history。
  3. 从 room history 里 reopen 一条 prior run，再跳回 room run tab，确认 room 重新锚定当前 active continuity，而不是停在旧 session。
- 预期结果: `/runs` 是 paginated history surface；run detail / room run tab 能稳定暴露 resume context；prior-run reopen 不会把 room continuity 锚错到 stale session。
- 业务结论: 2026 年 4 月 9 日 `TKT-40` 新增 `/v1/runs/history`、`/v1/runs/:id/detail`、`pnpm test:headed-run-history-resume-context` 与对应 `docs/testing/Test-Report-2026-04-09-run-history-resume-context.md`。当前浏览器 exact replay 已验证 `/runs` 首屏只展示最新 history page，`Load Older Runs` 才会展开 `run_runtime_00`，run detail 会显示 `session-runtime` 的 resume context 与 same-room history，reopen prior run 后 room run tab 也会重新锚定当前 `session-runtime` 而不是旧 continuity，因此这条用例当前转为 `Pass`。

## TC-044 Mobile Web Notification Triage

- 业务目标: 确认 mobile web 不需要独立工作台，也能在 `/inbox` 上完成轻量通知查看与处理，而不会被桌面密度直接压垮。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-11`
- 前置条件: web、server 可启动，`/inbox` 已直接消费 `/v1/approval-center`。
- 测试步骤:
  1. 以 390px mobile viewport 打开 `/inbox`。
  2. 检查 mobile triage 卡片是否直接给出 `open / unread / blocked / recent` 摘要，并保留回跳 `/settings` 的入口。
  3. 抽查首张 signal card 的 `Open Context`、decision 与 details disclosure，确认 guard / backlinks 展开后仍无横向溢出。
  4. 展开 mobile recent ledger，确认 recent resolution/status 回写仍可被查看。
- 预期结果: `/inbox` 在手机上可以被打开、查看并完成轻量 triage；更重的策略编辑继续回 `/settings`，而不是把桌面工作台整块复制到 mobile。
- 业务结论: 2026 年 4 月 9 日 `TKT-47` 新增 `pnpm test:headed-mobile-notification-triage` 与对应 `docs/testing/Test-Report-2026-04-09-mobile-notification-triage.md`。当前 headed Chromium mobile replay 已验证 `/inbox` 在 390px 视口下无横向溢出、mobile triage 摘要初始值为 `3 / 3 / 1 / 1`，首张 signal card 高度压到 640px 以下，并把 guard / backlinks / recent ledger 收成按需展开，因此这条 mobile light-notification 路径当前可按 `Pass` 收口。

## TC-046 Topic Route / Edit Lifecycle / Resume Deep Link

- 业务目标: 确认 Topic 不再只作为 room workbench 的子 tab 存在，而是可独立直达、可写回 guidance、可直接恢复 continuity 的一等 route。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-06`
- 前置条件: 存在 `/topics/:topicId`、topic guidance edit surface、room/run backlink 与 same-topic run control。
- 测试步骤:
  1. 从 run detail 或 Quick Search 打开某条 Topic。
  2. 在 Topic route 提交一条 guidance，并确认最近 guidance ledger 直接回写到同一条 room truth。
  3. 在 Topic route 上暂停当前 run，刷新页面，再从同一路由恢复执行。
  4. 从 Topic route 回跳到 room topic workbench，确认 route drill-in 与 room-first collaboration 没有断链。
- 预期结果: Topic 成为可独立直达的一等对象；人类可在同一路由完成 guidance edit、reload persistence 与 resume，不需要再绕回 room tab 才能继续。
- 业务结论: 2026 年 4 月 9 日 `TKT-52` 新增 `pnpm test:headed-topic-route-resume-lifecycle` 与对应 `docs/testing/Test-Report-2026-04-09-topic-route-resume-lifecycle.md`。当前 headed Chromium exact replay 已验证 `run detail -> /topics/topic-runtime` deep link、topic guidance 写回、topic route 上的 stop/reload/resume continuity，以及回跳 `/rooms/room-runtime?tab=topic` 的 backlink，因此这条 Topic route / edit lifecycle / resume deep-link 路径当前可按 `Pass` 收口。

## TC-047 Control-Plane `/v1` Command / Event / Debug Read Model

- 业务目标: 确认公开 control-plane 不再把 command、timeline 和 debug 语义混在同一个入口里，而是形成稳定的 `/v1` contract。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-03` `CHK-15`
- 前置条件: 存在版本化 `/v1` 资源、command 写入口、event read-model 与 debug/rejection read-model。
- 测试步骤:
  1. 通过 `/v1` 创建或更新一条 control-plane 资源，并记录 request / idempotency key。
  2. 分别读取 event timeline、debug history、rejection reason / replay anchor。
  3. 对同一请求重试，确认 write contract、event cursor 与 error family 保持稳定。
- 预期结果: 外部 consumer 能在不依赖前台壳层私有逻辑的前提下写 command、读 event、读 debug history，并得到稳定的 HTTP / error family / replay 语义。
- 业务结论: 2026 年 4 月 10 日 `TKT-58` 已新增 `/v1/control-plane/commands`、`/v1/control-plane/events`、`/v1/control-plane/debug/commands/:id`、`/v1/control-plane/debug/rejections` 与对应 go contract tests；同日 Windows Chrome 有头 `docs/testing/Test-Report-2026-04-10-windows-chrome-control-plane-runtime-governance.md` 还补了 `write -> replay -> rejection/debug readback -> issue browser readback` 证据。因此这条 `/v1` command / event / debug read-model 现在可按 `Pass` 收口。

## TC-048 Shell Adapter / No-Shadow-Truth Boundary

- 业务目标: 确认 shell adapter 只消费稳定真相做投影，而不会悄悄长成第二套正式状态源。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-03` `CHK-15`
- 前置条件: shell 存在 adapter / projection 层，且至少一条 surface 同时依赖 server truth 与 adapter fan-in。
- 测试步骤:
  1. 对同一组对象分别读取底层 `/v1` truth 与 shell adapter projection。
  2. 注入缺字段、脏字段或 stale projection，观察 shell 是否 fail-closed 回退到产品级 fallback。
  3. 验证 shell 不会因为本地 projection 或 mock residue 继续显示与 `/v1` 冲突的状态。
- 预期结果: adapter 只能投影稳定真相；一旦上游 truth 不完整，shell 选择 fail-closed，而不是留下 shadow truth 或局部假状态。
- 业务结论: 2026 年 4 月 10 日 `TKT-59` 已把 live truth hygiene 扩到 governance / control-plane / runtime publish 新字段，并把 `check-live-truth-hygiene` 固定进 `pnpm verify:web`；同日 Windows Chrome 有头报告还在 `/agents` 上对 dirty `/v1/state` 做了对抗性注入，确认 adapter 会 fail-closed 回退到产品级 fallback，而不是继续展示 placeholder / mock / path residue。因此这条 no-shadow-truth boundary 现在可按 `Pass` 收口。

## TC-049 Runtime Publish Cursor / Replay Evidence Packet

- 业务目标: 确认 daemon -> server 的 publish、replay、closeout 具备 cursor、去重和 evidence packet 语义，而不是只靠一次性状态写回。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-14` `CHK-15`
- 前置条件: 存在 runtime publish cursor、run closeout/read-model 与 replay/debug evidence surface。
- 测试步骤:
  1. 启动一条 run，并让 daemon 连续 publish 多条事件。
  2. 重复发送部分事件，验证 server 不会重复落账或破坏 sequence。
  3. 读取 closeout / replay evidence packet，检查 failure anchor、closeout reason 与 publish cursor 是否一致。
- 预期结果: runtime publish 在重复、恢复、closeout 三种路径下都保持可重放、可解释、可复核；release gate 可以围 evidence packet 做回归验证。
- 业务结论: 2026 年 4 月 10 日 `TKT-60` 已新增 `/v1/runtime/publish`、`/v1/runtime/publish/replay` 与对应 go contract tests；同日 Windows Chrome 有头报告已在 `run_memory_01` 上回放 `publish -> retry -> replay/closeout readback -> run detail browser evidence`，确认 cursor dedupe、closeout reason、failure anchor 与 replay packet 一致。因此这条 runtime publish / replay evidence contract 现在可按 `Pass` 收口。

## TC-050 Multi-Agent Routing SLA / Response Aggregation Hardening

- 业务目标: 确认多 Agent 协作不只存在 team topology 和 handoff ledger，还具备正式 routing policy、escalation SLA、notification policy 与 final-response aggregation contract。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 team topology、Agent Mailbox、human override、blocked escalation 与 final response 基线。
- 测试步骤:
  1. 以 `开发团队` 或等价多 Agent 模板起一条需要 reviewer / tester 接力的 issue。
  2. 检查 handoff routing、blocked escalation、notification fanout 与 human override 是否遵守同一条 policy。
  3. 观察 final response aggregation 是否保留参与 Agent、decision path、override trace 与 closeout explanation。
- 预期结果: 多 Agent 协作具备正式 routing / SLA / aggregation 语义；人类能知道“为什么发给谁、谁超时、最后答案由谁聚合”。
- 业务结论: 2026 年 4 月 10 日 `TKT-61` 已把 routing matrix、escalation SLA、notification policy、response aggregation audit 与 human override trace 补进同一份 `workspace.governance` 快照；同日 Windows Chrome 有头报告已串起 `/setup -> /mailbox -> /agents`，验证 blocked escalation、notification targets、routing rules 和 aggregated final response 同页前滚。因此这条治理硬化用例现在可按 `Pass` 收口。

## TC-051 Configurable Team Topology / Governance Persistence

- 业务目标: 确认 team topology 不再只是模板只读预览，而是可编辑、可持久化、可被多治理面同源读取的 workspace truth。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21` `CHK-22`
- 前置条件: 存在 `/settings` workspace config writeback、`workspace.governance` 派生快照，以及 `/setup` `/mailbox` `/agents` governance replay surface。
- 测试步骤:
  1. 在 `/settings` 编辑 team topology，修改既有 lane，并新增一条新 lane。
  2. 打开 `/setup`、`/mailbox`、`/agents`，检查三处 governance surface 是否都读取到同一份新 topology。
  3. 刷新浏览器并重启 server，再次检查 topology 和 lane label 是否保持一致。
- 预期结果: team topology 会作为 durable workspace truth 被持久化；治理预览和治理回放都围同一份 lane / role / default-agent 配置前滚，不会退回固定模板。
- 业务结论: 2026 年 4 月 11 日 `TKT-62` 已新增 `/settings` team topology editor、workspace durable topology persistence，以及 headed `pnpm test:headed-configurable-team-topology`。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-configurable-team-topology.md` 已记录 `/settings -> /setup -> /mailbox -> /agents` 的 exact replay，并验证 reload / server restart / second browser context 后仍保持同一份 Builder/Ops topology，因此这条可配置治理拓扑用例当前转为 `Pass`。

## TC-052 Mailbox Formal Comment / Bilateral Handoff Communication

- 业务目标: 确认 mailbox 不只支持 target agent 的单向状态推进，而是允许 source / target 围绕同一条 handoff 做正式评论，并保持 lifecycle truth 不被污染。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 `/v1/mailbox` create/update contract、Mailbox ledger UI 与 room / inbox backlink。
- 测试步骤:
  1. 创建一条 handoff，并在 `requested` 状态下由 source agent 提交 formal comment。
  2. 直接尝试 `blocked` 且不填 note，确认 server fail-closed 拒绝。
  3. 提交 blocker note 进入 `blocked`，再由 target agent 继续追加 formal comment。
  4. 最后执行 `acknowledged -> completed`，检查 Room / Inbox / Mailbox 是否还能回放完整链路。
- 预期结果: source / target 都能在同一条 handoff 上补 formal comment；comment 只追加 ledger / room trace / inbox summary，不会偷偷改 lifecycle status，也不会冲掉 blocked tone 或 closeout note。
- 业务结论: 2026 年 4 月 11 日 `TKT-63` 已把 `comment` action 补进 `/v1/mailbox/:id`，并更新 `/mailbox`、`/inbox` 上的 mailbox surface。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-formal-comment.md` 已记录 `create -> source comment -> blocked(note required probe) -> target comment -> acknowledged -> completed` 的 Windows Chrome 有头 exact replay，并验证 comment 会同步写入 handoff ledger、room agent trace 与 inbox summary，同时保留 blocked / complete 的 lifecycle 语义，因此这条双边正式通信用例当前转为 `Pass`。

## TC-053 Governed Mailbox Route / Default Role Handoff

- 业务目标: 确认 mailbox 不再围空白默认值或随机 Agent 起单，而是按当前 room / run truth 与 team topology 给出下一棒 governed handoff suggestion，并在缺少合法接收方时显式 fail-closed。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 `workspace.governance` 派生快照、team topology、Mailbox lifecycle，以及至少一条可映射到 reviewer -> QA 的治理链。
- 测试步骤:
  1. 打开 `/mailbox?roomId=room-runtime`，检查 compose form 是否自动读取当前 governed suggestion，并默认填入 `Developer -> Reviewer` 的 source / target。
  2. 应用 governed route 并创建 handoff，确认 surface 切成 `active`，且可回链聚焦当前正在进行的 handoff。
  3. 在同一条 handoff 上执行 `acknowledged -> completed`，让当前 reviewer lane 正式收口。
  4. 检查下一条 governed suggestion 是否前滚到 `Reviewer -> QA`；若当前 topology 缺少合法 QA target，状态必须显式为 `blocked`，而不是随机挑现有 Agent。
- 预期结果: governed route 会围当前 room truth 稳定建议下一棒 handoff；已存在 handoff 时不会重复创建；缺目标 Agent 时显式 `blocked` 并要求人工选择或补 topology truth。
- 业务结论: 2026 年 4 月 11 日 `TKT-64` 已新增 `workspace.governance.routingPolicy.suggestedHandoff`，并把 `/mailbox` 与 Inbox compose 接到同一条 governed suggestion truth。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-route.md` 已记录 `ready -> active -> blocked` 的 Windows Chrome 有头 exact replay，同时 `go test ./internal/store ./internal/api` 已锁住 current-room lane resolution、active handoff focus 与 missing QA target fail-closed，因此这条默认角色治理用例当前转为 `Pass`。

## TC-054 Governed Mailbox Auto-Create / Compose Shortcut

- 业务目标: 确认 governed route 不只会推荐 source/target，而是允许人类在 `/mailbox` 与 Inbox compose 上直接一键起单，并保持两处 surface 的 lifecycle 同步。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 `workspace.governance.routingPolicy.suggestedHandoff`、Mailbox create contract，以及同一 room 上的 `/mailbox` / Inbox compose governed route surface。
- 测试步骤:
  1. 打开 `/inbox?roomId=room-runtime`，确认 compose governed route 处于 `ready`，并显示 `Create Handoff` 一键入口。
  2. 再打开 `/mailbox?roomId=room-runtime`，点击 `Create Governed Handoff`，直接创建 formal handoff。
  3. 返回 Inbox，检查 compose governed route 是否同步转为 `active`，并能聚焦同一条 handoff。
  4. 完成当前 reviewer handoff，确认 `/mailbox` 与 Inbox compose 两处 governed route 都同步前滚到 `blocked QA` fallback。
- 预期结果: governed route 在两处 surface 上都能一键起单；起单后不会出现一处 active、一处还停在 ready 的分裂状态；完成后也会围同一条 topology truth 前滚到下一 lane。
- 业务结论: 2026 年 4 月 11 日 `TKT-65` 已把 governed auto-create shortcut 补进 `/mailbox` 与 Inbox compose。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-autocreate.md` 已记录 `compose ready -> mailbox one-click create -> both active -> blocked replay` 的 Windows Chrome 有头 exact replay，因此这条 friction-reduction 增强当前转为 `Pass`。

## TC-055 Governed Mailbox Auto-Advance / Followup Handoff

- 业务目标: 确认 acknowledged handoff 在 governed topology 下完成时，可以直接自动前滚到下一条 formal handoff，而不是要求人类重复去 compose/create。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 `workspace.governance.routingPolicy.suggestedHandoff`、governed auto-create surface，且 team topology 中下一条 lane 已映射到合法 default agent。
- 测试步骤:
  1. 打开 `/mailbox?roomId=room-runtime`，通过 governed route 创建 `Developer -> Reviewer` 的 formal handoff，并确认 `/mailbox` 与 Inbox compose 都切到同一条 `active` handoff。
  2. 在 reviewer handoff 上执行 `acknowledged`，然后点击 `Complete + Auto-Advance`。
  3. 检查 server / UI 是否自动创建下一条 `Reviewer -> QA` followup handoff，而不是停在 `ready` 让人手工再起一单。
  4. 返回 Inbox，确认 compose governed route 与 `/mailbox` 一起指向这条新的 `active` followup，并能直接 focus 回新 handoff。
- 预期结果: auto-advance 走 server-side truth，不依赖前端拼接两次 mutation；followup handoff 被创建后，两处 surface 都会围同一条 active ledger 前滚，不会出现旧 handoff 已完成但 governed route 仍停在 ready / blocked 的分裂状态。
- 业务结论: 2026 年 4 月 11 日 `TKT-66` 已新增 `continueGovernedRoute` mailbox contract，并把 `/mailbox` 与 Inbox mailbox ledger 补成 `Complete + Auto-Advance`。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-auto-advance.md` 已记录 `reviewer closeout -> auto-create QA followup -> dual-surface active replay` 的 Windows Chrome 有头 exact walkthrough，同时 `go test ./internal/store ./internal/api` 已锁住 governed followup creation 与 active pointer，因此这条自动前滚用例当前转为 `Pass`。

## TC-056 Governed Closeout / Delivery Entry Backlink

- 业务目标: 确认 final lane 收口后，governed surface 不会停在抽象的 `done` 状态，而是直接把人类带回 PR delivery entry，并把 closeout note 带进 handoff note / evidence。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 governed auto-advance、可映射 QA lane、PR delivery entry、以及 final response / closeout aggregation。
- 测试步骤:
  1. 通过 governed route 创建 `Developer -> Reviewer` handoff，并用 `Complete + Auto-Advance` 自动生成 `Reviewer -> QA` followup。
  2. 由 QA acknowledge 并完成 final lane handoff，写入 closeout note。
  3. 返回 `/mailbox` 与 Inbox，检查 governed surface 是否都切到 `done`，并提供同一条 `Open Delivery Entry` closeout 回链。
  4. 打开 PR delivery entry，检查 operator handoff note 与 evidence 是否直接带上这条 governed closeout note。
- 预期结果: final lane 收口后，治理链会把 closeout 直接委托回 delivery entry；人类不需要自己从 mailbox 再去找 PR detail，且 PR handoff note / evidence 不会丢失最新 QA closeout note。
- 业务结论: 2026 年 4 月 11 日 `TKT-67` 已把 governed done-state closeout 回链补进 `/mailbox` 与 Inbox compose，并把 PR delivery handoff note / evidence 接到同一条 governed closeout truth。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-closeout.md` 已记录 `reviewer auto-advance -> QA closeout -> PR delivery entry backlink` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 已锁住 governed done href、delivery note 与 governed-closeout evidence，因此这条治理收口回链用例当前转为 `Pass`。

## TC-057 Governed Delivery Delegation / Inbox Signal

- 业务目标: 确认 final lane closeout 后，delivery entry 不只出现 closeout backlink，还会基于 topology 明确交付委派目标，并把这条委派信号写进 PR related inbox。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 governed auto-advance、done-state delivery backlink、PR delivery entry，以及可解析的 team topology / owner lane。
- 测试步骤:
  1. 通过 governed route 创建 `Developer -> Reviewer` handoff，并用 `Complete + Auto-Advance` 自动生成 `Reviewer -> QA` followup。
  2. 由 QA acknowledge 并完成 final lane handoff，写入 closeout note。
  3. 打开 `/pull-requests/pr-runtime-18`，检查 `Delivery Delegation` card 是否显式显示 `delegate ready`、`PM · Spec Captain` 与对应 summary。
  4. 检查 PR detail 的 related inbox 是否出现 `inbox-delivery-delegation-pr-runtime-18`，并确认它回链到同一条 PR detail。
- 预期结果: final lane closeout 后，delivery delegate 会从治理拓扑中被正式派生出来；人类既能在 delivery card 看到委派目标，也能在 related inbox 看到同一条 deterministic signal，不再需要靠隐式约定记住“最后谁来收口”。
- 业务结论: 2026 年 4 月 11 日 `TKT-68` 已把 `PullRequestDeliveryEntry.delegation`、final-closeout delegation fallback 与 related inbox signal 接进同一条 delivery truth。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegation.md` 已记录 `QA closeout -> delivery delegate ready -> related inbox signal` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 已锁住 `PM / Spec Captain` fallback、`delivery-delegate` evidence 与 deterministic inbox item，因此这条交付委派用例当前转为 `Pass`。

## TC-058 Delegated Closeout Handoff Auto-Create

- 业务目标: 确认 final QA closeout 后，系统会把 delivery delegate 继续升级成 formal handoff，而不是只给一条信号让人类自己再起单。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 governed auto-advance、done-state delivery backlink、delivery delegation signal，以及可解析的 owner/final-response delegate lane。
- 测试步骤:
  1. 通过 governed route 创建 `Developer -> Reviewer` handoff，并用 `Complete + Auto-Advance` 自动生成 `Reviewer -> QA` followup。
  2. 由 QA acknowledge 并完成 final lane handoff，写入 closeout note。
  3. 打开 `/pull-requests/pr-runtime-18`，检查 `Delivery Delegation` card 是否新增 `handoff requested` 状态与 handoff deep link。
  4. 点击 handoff deep link，确认 Inbox / Mailbox 会直接聚焦到自动创建的 `Memory Clerk -> Spec Captain` formal closeout handoff，且 governed route 仍维持 done-state closeout backlink。
- 预期结果: delegate signal 会继续升级成 formal mailbox contract；人类既能在 PR detail 看到 delegated handoff 状态，也能一跳进入对应 ledger，不需要再手工重新 compose 一条 closeout handoff。
- 业务结论: 2026 年 4 月 11 日 `TKT-69` 已把 `delivery-closeout` handoff kind、delegate agent auto-materialization 与 PR detail handoff deep-link 接进同一条 closeout orchestration。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-handoff.md` 已记录 `QA closeout -> auto-created delegated handoff -> Inbox/Mailbox focus` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 已锁住 `Memory Clerk -> Spec Captain` requested handoff、delegation handoff status 与 governance done-state 不回退，因此这条 delegated closeout contract 用例当前转为 `Pass`。

## TC-059 Delegated Closeout Lifecycle Sync

- 业务目标: 确认 delegated closeout handoff 后续进入 `blocked` 或 `completed` 时，PR detail 的 `Delivery Delegation` card 和 deterministic related inbox signal 会即时同步，而不是停留在初始 `handoff requested`。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 governed auto-advance、done-state delivery backlink、delivery delegation signal，以及自动创建 delegated closeout handoff 的 contract。
- 测试步骤:
  1. 通过 governed route 创建 `Developer -> Reviewer` handoff，并用 `Complete + Auto-Advance` 自动生成 `Reviewer -> QA` followup。
  2. 由 QA acknowledge 并完成 final lane handoff，生成自动 delegated closeout handoff。
  3. 进入 delegated handoff，将其标记为 `blocked` 并写入 blocker note。
  4. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` card 变为 `delegate blocked` / `handoff blocked`，且 summary 与 related inbox signal 同步带回 blocker note。
  5. 回到 delegated handoff，重新 acknowledge 并完成 closeout。
  6. 再次打开 `/pull-requests/pr-runtime-18`，确认 delegation card 变为 `delegation done` / `handoff completed`，related inbox signal 也同步显示完成态。
- 预期结果: delegated closeout handoff 不会成为只在 Mailbox 内可见的孤岛 lifecycle；blocked 和 completed 都应回写到同一条 PR delivery contract，同时 governed route 继续维持 final-lane closeout done-state。
- 业务结论: 2026 年 4 月 11 日 `TKT-70` 已把 delegated closeout handoff 的 lifecycle sync 接回 `PullRequestDeliveryEntry.delegation` 与 deterministic inbox signal。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-lifecycle.md` 已记录 `delegated handoff blocked -> PR detail blocked -> re-ack -> completed -> PR detail done` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 已锁住 blocker note 回写、completed 状态回写与 governance done-state 隔离，因此这条 delegated lifecycle contract 用例当前转为 `Pass`。

## TC-060 Delivery Delegation Automation Policy

- 业务目标: 确认 final lane closeout 之后的 delivery delegate 不再只有单一硬编码行为，而是至少支持显式的 `formal-handoff / signal-only` automation policy，并且 `signal-only` 模式下不会偷偷自动起 delegated closeout handoff。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 governed auto-advance、done-state delivery backlink、delivery delegation signal，以及可编辑的 workspace governance topology。
- 测试步骤:
  1. 将 workspace governance 的 `deliveryDelegationMode` 切到 `signal-only`，并保留可解析的 PM / Spec Captain owner lane。
  2. 通过 governed route 创建 `Developer -> Reviewer` handoff，并用 `Complete + Auto-Advance` 自动生成 `Reviewer -> QA` followup。
  3. 由 QA acknowledge 并完成 final lane handoff，写入 closeout note。
  4. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` card 仍显示 `delegate ready`，summary 明确写回 `signal-only` policy，且 related inbox signal 同步出现。
  5. 检查 Mailbox ledger，确认没有自动新建 `delivery-closeout` handoff。
  6. 打开 `/settings`，确认 delivery delegation policy 读回同一条 `signal only` durable truth。
- 预期结果: delivery delegation automation policy 必须是显式可配置的产品行为；`signal-only` 模式下系统只派 delegation signal，不自动物化 delegated closeout handoff，但 PR detail、Mailbox 和 Settings 仍读同一份 workspace truth。
- 业务结论: 2026 年 4 月 11 日 `TKT-71` 已把 `formal-handoff / signal-only` delivery delegation automation policy 接进 workspace governance durable config。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-policy.md` 已记录 `signal-only policy -> PR delegation signal -> no auto-created handoff -> settings policy truth` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 与 `pnpm verify:web` 已锁住 policy persistence、PR detail delegation summary 与 Mailbox no-auto-create contract，因此这条 delivery delegation automation policy 用例当前转为 `Pass`。

## TC-061 Delivery Delegation Auto-Complete Policy

- 业务目标: 确认 final lane closeout 之后的 delivery delegate 还支持更重的 `auto-complete` automation policy，让系统直接把 delivery closeout 收成 `delegation done`，而不是继续额外物化 delegated closeout handoff。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 governed auto-advance、done-state delivery backlink、delivery delegation signal，以及可编辑的 workspace governance topology / delivery policy。
- 测试步骤:
  1. 将 workspace governance 的 `deliveryDelegationMode` 切到 `auto-complete`，并保留可解析的 PM / Spec Captain owner lane。
  2. 通过 governed route 创建 `Developer -> Reviewer` handoff，并用 `Complete + Auto-Advance` 自动生成 `Reviewer -> QA` followup。
  3. 由 QA acknowledge 并完成 final lane handoff，写入 closeout note。
  4. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` card 直接显示 `delegation done`，summary 明确写回 `auto-complete` policy，且相关 inbox signal 同步出现。
  5. 检查 Mailbox ledger，确认没有自动新建 `delivery-closeout` handoff。
  6. 读取 workspace durable config，确认 delivery delegation policy 仍保持同一条 `auto-complete` truth；若走前台页面，则 `/settings` 的治理摘要也应继续读回同一配置。
- 预期结果: 更重的 auto-closeout 策略必须是显式可配置的产品行为；`auto-complete` 模式下系统直接把 delivery delegate 收口成 done，不额外物化 delegated closeout handoff。与此同时，PR detail、Mailbox、related inbox 与 durable workspace policy truth 必须继续围同一份配置前滚；当别的 hot room 仍在冒烟时，`delivery-closeout / delivery-reply` sidecar 也不得污染 cross-room rollup / dependency graph。
- 业务结论: 2026 年 4 月 11 日 `TKT-72` 已把 `auto-complete` delivery delegation automation policy 接进 workspace governance durable config。2026 年 4 月 14 日又新增 `TestAutoCompleteDeliveryDelegationDoesNotPolluteCrossRoomEscalationRollup`、`TestAutoCompleteDeliveryDelegationKeepsBlockedRuntimeRoomHotButMarksRouteDone`、`TestAutoCompleteDeliveryDelegationDoesNotPolluteCrossRoomGovernanceSnapshot` 与 `TestAutoCompleteDeliveryDelegationKeepsBlockedRuntimeRoomHotButMarksRouteDoneInGovernanceSnapshot`，并补了 `docs/testing/Test-Report-2026-04-14-windows-chrome-governed-mailbox-delegate-auto-complete-regression.md` 与 `docs/testing/Test-Report-2026-04-14-windows-chrome-cross-room-governance-auto-closeout.md` 两份回归证据。当前旧报告已锁住 `auto-complete policy -> PR delegation done -> no auto-created handoff`，新增 store/API 合同又锁住“有别的 hot room 时，runtime room 的 auto-closeout 不会把 `delivery-closeout / delivery-reply` sidecar 污染进 cross-room rollup / dependency graph，并且当 runtime room 仍被真实 blocker 卡住时，route 会切到 `done` 而不是把 room 误判成已冷却”；新的 cross-room Windows Chrome 报告则继续确认 runtime room 会保留原 blocker hot truth、route 切到 `done`、同时 PR detail 直接显示 closeout 已收口。因此这条更重 auto-closeout policy 用例当前继续保持 `Pass`。

## TC-062 Delegated Closeout Comment Sync

- 业务目标: 确认 delegated closeout handoff 上的 source / target formal comment 不再只留在 Mailbox 局部 ledger，而是会同步回 PR detail `Delivery Delegation` summary 与 related inbox signal，形成真实可回放的跨 Agent closeout 沟通。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 formal delegated closeout handoff auto-create、delegation lifecycle sync，以及 source / target 都能在同一条 handoff 上补 formal comment 的 contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 `delivery-closeout` handoff。
  2. 在 delegated handoff 上先以 source agent 身份补一条 formal comment。
  3. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` summary 与 related inbox signal 已同步出现这条 source comment，且 handoff 仍保持 `requested`。
  4. 回到 delegated handoff，切换为 target agent 再补一条 formal comment。
  5. 再次打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` summary 与 related inbox signal 已更新为最新 target comment，且 handoff lifecycle 仍保持 `requested`，没有被 comment 意外改坏。
- 预期结果: delegated closeout 上的 formal comment 必须进入同一份 delivery contract；PR detail 和 related inbox 都应显示最新 closeout comment，同时 comment sync 不能偷偷篡改 delegated handoff lifecycle。
- 业务结论: 2026 年 4 月 11 日 `TKT-73` 已把 delegated closeout latest formal comment 接回 PR detail `Delivery Delegation` summary 与 related inbox signal。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-comment-sync.md` 已记录 `source comment -> PR detail sync -> target comment -> related inbox latest-comment sync` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 与 `pnpm verify:web` 已锁住 latest-comment contract 与 lifecycle preservation，因此这条跨 Agent closeout comment sync 用例当前转为 `Pass`。

## TC-063 Delegated Closeout Blocked Response Handoff

- 业务目标: 确认 delegated closeout handoff 被 target `blocked` 后，系统会自动创建一条 `delivery-reply` response handoff 把 unblock work 回给 source，并把这条 response lifecycle 继续同步回 PR detail `Delivery Delegation` contract。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 formal delegated closeout handoff auto-create、delegation lifecycle sync，以及 source / target 的 formal mailbox closeout contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 `delivery-closeout` handoff。
  2. 进入 delegated closeout handoff，由 target agent 将其标记为 `blocked` 并写入 blocker note。
  3. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` card 仍显示 `delegate blocked / handoff blocked`，并新增 `reply requested` 状态与 unblock response deep link。
  4. 通过 response deep link 打开自动创建的 `delivery-reply` handoff，确认它是 `target -> source` 的 formal response ledger，且 parent 指回原 delegated closeout handoff。
  5. 由 source acknowledge 并完成 response handoff，补充 unblock note。
  6. 再次打开 `/pull-requests/pr-runtime-18`，确认 delegation card 变为 `reply completed`，summary 写回“等待 target 重新 acknowledge final delivery closeout”，且原 delegated closeout 仍保持 `blocked`。
- 预期结果: blocked delegated closeout 不能只停在 blocker note；系统必须把 unblock work 物化成独立的 response handoff，并把 response status / link 回写到 PR detail，但 response completion 不能越权篡改原 delegated closeout lifecycle。
- 业务结论: 2026 年 4 月 11 日 `TKT-74` 已把 `delivery-reply` response handoff、parent linkage 与 PR detail `reply requested / reply completed` contract 接回同一条 delivery orchestration。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-response.md` 已记录 `blocked delegated closeout -> auto-created response handoff -> response completed -> main handoff still blocked` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 与 `pnpm verify:web` 已锁住 response handoff auto-create、PR detail writeback 与 governance done-state 隔离，因此这条 blocked response orchestration 用例当前转为 `Pass`。

## TC-064 Delegated Closeout Retry Attempt Visibility

- 业务目标: 确认 delegated closeout 在第二轮及后续 `blocked -> response -> re-ack -> blocked` 时，系统不会复用旧 response ledger，而是会新建最新 response handoff，并把 retry attempt 数直接写回 PR detail `Delivery Delegation`。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动 response handoff，以及 response completion 后主 closeout 继续保持 blocked 的 contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 让 target 将 delegated closeout 标记为 `blocked`，再由 source 完成第一轮 response handoff。
  3. 让 target 重新 acknowledge 主 delegated closeout，然后再次标记为 `blocked`。
  4. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` card 现在显示 `reply x2`，summary 明确写回“第 2 轮”，且 response deep link 已指向最新一轮 handoff。
  5. 打开第二轮 response handoff，完成 response。
  6. 再次打开 `/pull-requests/pr-runtime-18`，确认 delegation card 仍显示 `reply completed` + `reply x2`，主 delegated closeout 则继续保持 blocked，等待 target 再次 acknowledge。
- 预期结果: delegated closeout retry 不能只留在 Mailbox 历史列表里；产品必须把“这是第几轮 unblock response”显式写回 PR detail，并且最新 deep link 必须始终指向当前生效的 response handoff，不能误指旧 attempt。
- 业务结论: 2026 年 4 月 11 日 `TKT-75` 已把 delegated closeout retry attempt counting、最新 response deep-link rollover 与 PR detail `reply xN` truth 接回 delivery contract。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-retry.md` 已记录 `first blocked -> first response -> re-ack -> second blocked -> reply x2 -> second response completed` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 与 `pnpm verify:web` 已锁住 second-attempt response handoff recreation、`reply x2` 可见性与主 lifecycle 保持，因此这条 retry visibility 用例当前转为 `Pass`。

## TC-065 Delegated Response Handoff Comment Sync

- 业务目标: 确认 `delivery-reply` response handoff 上的 source / target formal comment 不只留在 response ledger 本身，而是会同步回 PR detail `Delivery Delegation` summary 与 related inbox signal。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 retry / response lifecycle 的正式 contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`，确认系统自动生成 `delivery-reply` response handoff。
  3. 以 source agent 身份在 response handoff 上补一条 formal comment。
  4. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` summary 与 related inbox signal 已同步出现这条 source response comment，且 response status 仍保持 `reply requested`。
  5. 切换为 target agent，在同一条 response handoff 上补一条新的 formal comment。
  6. 再次打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` summary 与 related inbox signal 已更新为最新 target response comment，且 response lifecycle 仍保持 `reply requested`。
- 预期结果: response handoff 上的 formal comment 必须进入同一份 delivery contract；PR detail 与 related inbox 都应显示最新 response comment，同时 comment sync 不能偷偷篡改 response lifecycle。
- 业务结论: 2026 年 4 月 11 日 `TKT-76` 已把 `delivery-reply` response handoff latest formal comment 接回 PR detail `Delivery Delegation` summary 与 related inbox signal。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-response-comment-sync.md` 已记录 `blocked -> source response comment sync -> target response comment supersede -> reply requested preserved` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 与 `pnpm verify:web` 已锁住 latest response-comment contract 与 lifecycle preservation，因此这条跨 Agent response comment sync 用例当前转为 `Pass`。

## TC-066 Delegated Response Resume Signal

- 业务目标: 确认 `delivery-reply` 的 response progress 不只回写到 PR detail，而是会进一步回推父级 delegated closeout handoff、它自己的 inbox signal 与 run next action，让 target 在 Mailbox / Inbox 里就能知道 source 已回复、现在该重新 acknowledge 主 closeout。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 PR detail / related inbox 对 response lifecycle 的正式 contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`，确认系统自动生成 `delivery-reply` response handoff。
  3. 以 source agent 身份在 response handoff 上补一条 formal comment。
  4. 打开父级 delegated closeout handoff 所在的 `/inbox` / Mailbox 视图，确认父级 handoff card 与它自己的 inbox signal 都已同步出现这条 latest response comment，同时仍保留原 blocker。
  5. 由 source acknowledge 并完成 response handoff，写入 unblock note。
  6. 再次查看父级 delegated closeout handoff、其 inbox signal 与 run next action，确认都已切到“response 已完成，等待 target 重新 acknowledge 主 closeout”的同一条 resume guidance，且父级 handoff lifecycle 仍保持 `blocked`。
- 预期结果: response orchestration 不能只停在 child ledger 或 PR detail；父级 delegated closeout 必须直接收到最新 unblock progress，Mailbox / Inbox / run 也要一起告诉 target 什么时候重新接回主 closeout，同时不能偷改父级 blocked lifecycle。
- 业务结论: 2026 年 4 月 11 日 `TKT-77` 已把 `delivery-reply` response progress 接回父级 delegated closeout handoff、其 inbox signal 与 run/session next action。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-resume.md` 已记录 `response comment -> parent handoff sync -> response completed -> re-ack guidance visible` 的 Windows Chrome 有头 walkthrough，同时 `go test ./internal/store ./internal/api` 与 `pnpm verify:web` 已锁住 parent handoff latest-action sync、parent inbox resume signal 与 next-action guidance，因此这条跨 Agent resume signal 用例当前转为 `Pass`。

## TC-067 Delegated Response Mailbox Visibility

- 业务目标: 确认 delegated closeout 和 `delivery-reply` 的 parent/child orchestration 已经直接进入 Mailbox 壳层，而不是必须切去 PR detail 才能理解 reply 状态和回链。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 response progress 回推父级 handoff / inbox / next action 的正式 contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`。
  3. 留在父级 delegated closeout 的 Mailbox card，确认它直接显示 `reply requested` 与 `reply x1`，并提供 `Open Unblock Reply`。
  4. 打开 child `delivery-reply` handoff，确认 card 上显式出现 parent closeout 标识与 `Open Parent Closeout` 回跳。
  5. 完成 response handoff 后，再通过 parent link 回到父级 delegated closeout card。
  6. 确认父级 card 已更新为 `reply completed`，同时主 closeout handoff 仍保持 `blocked`。
- 预期结果: delegated closeout 的 parent/child orchestration 必须在 Mailbox 壳层直接可见；父级 card 应显示 reply status / attempt，child card 应能回跳 parent，且 response 完成后主 closeout 仍保持 blocked，直到 target 显式 re-ack。
- 业务结论: 2026 年 4 月 11 日 `TKT-78` 已把 delegated closeout / `delivery-reply` 的 parent-child mailbox visibility 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-visibility.md` 已记录 `parent reply chip -> child parent link -> response complete -> parent reply completed` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web` 与 `go test ./internal/store ./internal/api` 已锁住 mailbox parent/child deep-link、reply attempt 可见性与主 blocked lifecycle 保持，因此这条 mailbox visibility 用例当前转为 `Pass`。

## TC-068 Delegated Response Resume Parent Action

- 业务目标: 确认 child `delivery-reply` 完成后，blocker agent 可以直接从 child ledger 一键恢复父级 delegated closeout，而不是再手动回找 parent card。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 mailbox parent/child visibility contract。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`，并完成 child `delivery-reply`。
  3. 打开 child `delivery-reply` card，确认它出现 `Resume Parent Closeout`。
  4. 点击 `Resume Parent Closeout`。
  5. 回到父级 delegated closeout card，确认它已切到 `acknowledged`。
  6. 确认父级 card 仍保留 `reply completed`，没有把 child response evidence 冲掉。
- 预期结果: child `delivery-reply` 不应只是“说明下一步是什么”；它必须能直接触发 parent closeout 的恢复动作。恢复后父级应进入 `acknowledged`，同时继续保留 child response 的完成证据。
- 业务结论: 2026 年 4 月 11 日 `TKT-79` 已把 child-ledger `Resume Parent Closeout` 收成正式产品能力。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-resume-parent.md` 已记录 `response completed -> child resume button -> parent acknowledged` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web` 与 `go test ./internal/store ./internal/api` 已锁住 child-ledger resume action、parent re-ack orchestration 与 response chip preservation，因此这条跨 Agent resume action 用例当前转为 `Pass`。

## TC-069 Delegated Response History Preservation After Parent Resume

- 业务目标: 确认 child `delivery-reply` 帮 parent closeout 恢复甚至最终收口后，PR detail 与 related inbox 这条统一交付合同仍会保留 reply 历史，而不是只在 Mailbox 里可见。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 child-ledger `Resume Parent Closeout` 动作。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`，并完成 child `delivery-reply`。
  3. 让 parent delegated closeout 重新进入 `acknowledged`（可通过 child-ledger resume action 或同源 mailbox action）。
  4. 打开 `/pull-requests/pr-runtime-18`，确认 `Delivery Delegation` summary 仍显示 `第 1 轮 unblock response / reply x1` 历史，并明确 parent 已重新接住 closeout。
  5. 打开同页 related inbox signal，确认它也同步保留这段 response 历史。
  6. 完成 parent delegated closeout，再次检查 PR detail 与 related inbox，确认这段 reply 历史会随着 closeout 一起收口，而不是被 done-state 覆盖掉。
- 预期结果: response handoff 不应只在 blocked 阶段短暂可见。即使 parent 已恢复或完成，PR detail 和 related inbox 也必须继续保留这段 `reply xN / 第 N 轮 unblock response` 历史，保证 single delivery contract 能完整回放跨 Agent closeout 尾链。
- 业务结论: 2026 年 4 月 11 日 `TKT-80` 已把 parent resume / complete 之后的 response history preservation 收进统一交付合同。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-history-sync.md` 已记录 `reply completed -> parent resumed -> PR detail preserved -> parent completed -> related inbox preserved` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web` 与 `go test ./internal/store ./internal/api -count=1` 已锁住 PR detail summary、related inbox summary 与 done-state closeout 后的 response history retention，因此这条跨 Agent history preservation 用例当前转为 `Pass`。

## TC-070 Delivery Reply Parent Status Visibility

- 业务目标: 确认 child `delivery-reply` 卡片自己就能显示 parent closeout 当前是 `blocked / acknowledged / completed`，让 source agent 不必离开 child ledger 才知道主 closeout 的真实进度。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 child card 的 parent chip / parent deep-link。
- 测试步骤:
  1. 让 delegated closeout 进入 `blocked`，并自动生成 child `delivery-reply`。
  2. 完成 child `delivery-reply` 后，打开 child card，确认它显示 `parent blocked`。
  3. 让 parent delegated closeout 重新进入 `acknowledged`，刷新 child card，确认它切到 `parent acknowledged`。
  4. 让 parent delegated closeout 最终进入 `completed`，再次刷新 child card，确认它切到 `parent completed`。
- 预期结果: child `delivery-reply` 不应只告诉用户“这是谁的 parent”。它还必须直接展示 parent 当前真实状态，让 source agent 能在 child ledger 内读懂整条跨 Agent closeout 尾链。
- 业务结论: 2026 年 4 月 11 日 `TKT-81` 已把 child-ledger parent-status visibility 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-parent-status.md` 已记录 `parent blocked -> parent acknowledged -> parent completed` 在同一张 child `delivery-reply` card 上的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web` 已锁住 live mailbox / inbox mailbox 两个 surface 上的 parent-status chip，因此这条 child-ledger parent progress visibility 用例当前转为 `Pass`。

## TC-071 Delegated Parent Surface Context Preservation

- 业务目标: 确认 child `delivery-reply` 带来的 unblock 历史不只留在 PR detail / related inbox，而是会继续保留在 parent delegated closeout 自己的 Mailbox card、handoff inbox signal 与 Run detail 上。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建并完成的 `delivery-reply` response handoff，以及 parent resume / complete 后的 PR detail history preservation。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`，并完成 child `delivery-reply`。
  3. 让 parent delegated closeout 重新进入 `acknowledged`。
  4. 打开 parent handoff 的 Mailbox card，确认它仍显示 `第 1 轮` 与 `已重新 acknowledge final delivery closeout`，而不是退回通用 resume 文案。
  5. 打开对应 Run detail，确认 `下一步` 与 resume context 仍保留这段 reply history。
  6. 完成 parent delegated closeout。
  7. 再次检查 parent Mailbox card 与 Run detail，确认它们继续显示 `第 1 轮` 与 `也已完成 final delivery closeout`。
- 预期结果: child response history 不应只在统一 delivery contract 里可见。parent closeout 自己的执行面也必须带着这段上下文继续前滚和收口，否则 target 在 parent surface 会重新掉回“只看见一条抽象 done/resume 文案”的黑盒状态。
- 业务结论: 2026 年 4 月 11 日 `TKT-82` 已把 parent delegated closeout 自己的 Mailbox / run context history preservation 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-parent-context.md` 已记录 `parent resume mailbox -> run detail -> parent completed mailbox -> run detail` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store ./internal/api -count=1` 与对抗性回归 `go test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1` 已锁住普通 handoff 不受污染、retry truth 不回退，以及 parent surface history preservation，因此这条 parent-surface context 用例当前转为 `Pass`。

## TC-072 Delivery Reply Child Context Sync

- 业务目标: 确认 child `delivery-reply` 不只会显示 parent-status chip；当 parent delegated closeout 重新被接住或最终完成时，child ledger 自己的正文和 child inbox summary 也会同步前滚到同一份真相。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建并完成的 `delivery-reply` response handoff，以及 child card 的 parent-status chip / parent deep-link。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 由 target 将 delegated closeout 标记为 `blocked`，并完成 child `delivery-reply`。
  3. 打开 child `delivery-reply` card，确认它先显示 `parent blocked`。
  4. 让 parent delegated closeout 重新进入 `acknowledged`，刷新 child card，确认 `lastAction` 切到“已重新 acknowledge 主 closeout”且包含 `第 1 轮`。
  5. 检查 child 对应 inbox item，确认 summary 也切到同样的 parent acknowledged 文案。
  6. 完成 parent delegated closeout，再次刷新 child card 与 child inbox item，确认两者都前滚到“已完成主 closeout”且仍保留 `第 1 轮`。
- 预期结果: child `delivery-reply` 不应出现“chip 说 parent 已接住 / 已完成，但正文和 child inbox 还停在旧 response 文案”的真相撕裂。source agent 必须在 child ledger 内看到一致的 parent follow-through 上下文。
- 业务结论: 2026 年 4 月 11 日 `TKT-83` 已把 child-ledger context sync 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-child-context.md` 已记录 `parent blocked -> parent acknowledged child-context sync -> parent completed child-context sync` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store ./internal/api -count=1` 与对抗性回归 `go test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1` 已锁住 child `lastAction`、child inbox summary、普通 handoff lifecycle 与 retry truth 不被污染，因此这条 child-context follow-through 用例当前转为 `Pass`。

## TC-073 Delivery Reply Parent Progress Timeline

- 业务目标: 确认 child `delivery-reply` 不只会改卡片摘要；当 parent delegated closeout 重新被接住或最终完成时，child ledger 自己的 lifecycle messages 也会显式记录这些 parent follow-through 事件，并且 PR detail 里的 latest formal comment 不会因此丢失。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建并可完成的 `delivery-reply` response handoff，以及 response handoff formal comment sync 已成立。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff，并让它进入 `blocked`。
  2. 在 child `delivery-reply` 上补一条 formal comment，作为最新 comment truth。
  3. 完成 child `delivery-reply`，确认 PR detail `Delivery Delegation` summary 仍保留这条最新 formal comment。
  4. 让 parent delegated closeout 重新进入 `acknowledged`，刷新 child ledger，确认 lifecycle messages 追加一条 `parent-progress` entry，内容明确写出“已重新 acknowledge 主 closeout”。
  5. 再完成 parent delegated closeout，确认 child ledger 再追加一条 `parent-progress` completion entry。
  6. 回到 PR detail，确认 `Delivery Delegation` summary 同时保留最新 formal comment 与 parent completed 的 follow-through 文案。
- 预期结果: child `delivery-reply` 的时间线不应在 parent 恢复后仍停留在“response 自己完成了”的阶段；它必须把 parent 后续接住和收口也记录进去。同时，这些后续 lifecycle event 不能把 latest formal comment 从 PR detail 摘要里洗掉。
- 业务结论: 2026 年 4 月 11 日 `TKT-84` 已把 child-ledger timeline sync 与 latest-comment preservation 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-child-timeline.md` 已记录 `latest comment preserved -> parent acknowledged timeline -> parent completed timeline` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store ./internal/api -count=1`、定向回归 `go test ./internal/store ./internal/api -run "TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff|TestDelegatedCloseoutCommentsSyncToDeliveryContract|TestDelegatedCloseoutHandoffLifecycleReflectsInPullRequestDetail|TestDelegatedResponseCommentsReflectInPullRequestDetail" -count=1` 与对抗性回归 `go test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1` 已锁住 child `parent-progress` ledger、comment preservation、普通 handoff 与 retry truth 不被污染，因此这条 child timeline / comment preservation 用例当前转为 `Pass`。

## TC-074 Delegated Parent Response Timeline

- 业务目标: 确认 parent delegated closeout 自己的 lifecycle messages 不只记录 parent 本人的动作；child `delivery-reply` 的 formal comment 和 response complete 也必须显式进入 parent ledger 的 timeline。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 parent / child mailbox orchestration 主链已成立。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff，并让 parent 进入 `blocked`。
  2. 在 child `delivery-reply` 上补一条 formal comment。
  3. 打开 parent delegated closeout card，确认 lifecycle messages 新增一条 `response progress` entry，内容包含这条 child comment。
  4. 完成 child `delivery-reply`，再次打开 parent card，确认 lifecycle messages 再新增一条 `response progress` completion entry。
  5. 让 parent delegated closeout 自己重新 `acknowledged` 并最终 `completed`。
  6. 再次打开 parent card，确认前面的 `response progress` timeline entry 仍然保留，没有被 parent 自己后续的新动作洗掉。
- 预期结果: parent delegated closeout 不应只靠一条不断被覆盖的 `lastAction` 来表达 child response 的进度。target 深看 parent ledger 历史时，必须能直接回放 child comment / child complete 这些关键节点。
- 业务结论: 2026 年 4 月 11 日 `TKT-85` 已把 parent-ledger response timeline 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-parent-timeline.md` 已记录 `child comment -> parent response-progress timeline -> child complete -> parent follow-through history preserved` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store ./internal/api -count=1` 与定向回归 `go test ./internal/store ./internal/api -run "TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff|TestDelegatedCloseoutHandoffLifecycleReflectsInPullRequestDetail|TestDelegatedResponseProgressReflectsInParentMailboxAndRun|TestDelegatedResponseCommentsReflectInPullRequestDetail" -count=1` 已锁住 parent `response-progress` ledger、既有 summary contract 与 parent/child lifecycle 不被污染，因此这条 parent timeline visibility 用例当前转为 `Pass`。

## TC-075 Delegated Response Room Trace Sync

- 业务目标: 确认 child `delivery-reply` 对 parent delegated closeout 的关键 progress 不只会写进 Mailbox / PR / Inbox；Room 主消息流也必须同步追加显式 `[Mailbox Sync]` 叙事，让房间里直接可回放“child 已回复、parent 现在该怎么接”的 orchestrated trace。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 parent / child mailbox orchestration 主链已成立。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff，并让 parent 进入 `blocked`。
  2. 在 child `delivery-reply` 上补一条 formal comment。
  3. 打开 `/rooms/room-runtime?tab=chat`，确认 Room 主消息流新增一条 `[Mailbox Sync]` 叙事，内容明确写出 parent closeout 已同步这条 child comment，并提示后续重新 acknowledge 主 closeout。
  4. 完成 child `delivery-reply`。
  5. 刷新 Room 主消息流，确认又新增一条 `[Mailbox Sync]` completion 叙事。
  6. 检查 Room 历史，确认 comment sync 和 completion sync 两条记录同时保留。
- 预期结果: Room 不应继续是这条跨 Agent closeout 尾链的盲区。即使人类不打开 Mailbox / PR / Inbox，也必须能在 Room 主消息流里直接回放 child response 已经回推 parent 的关键轨迹。
- 业务结论: 2026 年 4 月 11 日 `TKT-86` 已把 room main-trace sync 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-room-trace.md` 已记录 `child comment -> room [Mailbox Sync] -> child complete -> room [Mailbox Sync] preserved` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store ./internal/api -run "TestDeliveryDelegationResponseProgressSyncsBackToParentHandoff|TestDelegatedResponseProgressReflectsInParentMailboxAndRun" -count=1` 与对抗性回归 `go test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1` 已锁住 room trace writeback、既有 parent/inbox/run sync 以及普通 handoff / retry truth 不被污染，因此这条 room-trace sync 用例当前转为 `Pass`。

## TC-076 Delegated Blocked Response Room Trace

- 业务目标: 确认 child `delivery-reply` 如果自己再次 `blocked`，Room 主消息流也会同步追加正式 `[Mailbox Sync]` 阻塞叙事，而不是只把这层二次阻塞留在 Mailbox / PR / Inbox。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 已存在 delegated closeout formal handoff、blocked 后自动创建的 `delivery-reply` response handoff，以及 child response progress 已能回写 parent handoff / inbox / run / room。
- 测试步骤:
  1. 使用 `formal-handoff` policy，让 final QA closeout 自动生成 delegated closeout handoff，并让 parent 进入 `blocked`。
  2. 打开 child `delivery-reply`，由 source agent 再次提交 `blocked`，写入新的 blocker note。
  3. 打开 `/rooms/room-runtime?tab=chat`，确认 Room 主消息流新增一条 `[Mailbox Sync]` 阻塞叙事。
  4. 检查这条 room trace，确认同时包含 child blocker note 与“当前也 blocked / 主 closeout 继续保持 blocked”的 parent guidance。
  5. 刷新 Room 历史，确认这条 blocked-response trace 没有丢失。
- 预期结果: Room 不应只显示 unblock 链顺利推进时的乐观同步。即使 child response 本身再次受阻，房间里也必须能直接看到这条正式阻塞真相，便于人类快速判断下一步该由谁继续接力或介入。
- 业务结论: 2026 年 4 月 11 日 `TKT-87` 已把 blocked child-response room trace 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-room-trace-blocked.md` 已记录 `parent blocked -> child response blocked -> room [Mailbox Sync] blocked trace` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store ./internal/api -run "TestDeliveryDelegationBlockedResponseSyncsIntoParentRoomTrace|TestDelegatedBlockedResponseReflectsInParentRoomTrace" -count=1` 与对抗性回归 `go test ./internal/store -run "TestAdvanceHandoffLifecycleUpdatesOwnerAndLedger|TestDeliveryDelegationResponseRetryAttemptsSyncBackToPullRequest" -count=1` 已锁住 blocked response 的 room trace、parent/inbox/run sync 与普通 handoff / retry truth 不被污染，因此这条 blocked-response room trace 用例当前转为 `Pass`。

## TC-077 Shell Profile Hub / Current People Machine Entry

- 业务目标: 确认 workspace shell 已补齐 app.slock.ai 式 profile 级入口；当前 `Human / Machine / Agent` 必须在左栏 footer 常驻可见，并一跳进入统一 profile surface。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-16`
- 前置条件: unified `Agent / Machine / Human` profile surface 已成立，workspace shell sidebar 已接 live workspace truth。
- 测试步骤:
  1. 打开 `/rooms/room-runtime?tab=context` 或任一 workspace shell 路由。
  2. 确认左栏 footer 存在 `Profile Hub`，且能看到当前 `Human / Machine / Agent` 三个入口。
  3. 依次点击 `Human`、`Machine`、`Agent` entry。
  4. 验证 URL 会分别进入 `/profiles/human/:id`、`/profiles/machine/:id`、`/profiles/agent/:id`，并能看到对应 presence / capability / recent activity。
  5. 回到 room context，确认 active agent / machine 的 room drill-in 仍保持可用。
- 预期结果: profile 入口不再散落在右栏 summary 或独立列表页里。用户在任何主工作面都能从同一套壳层 footer 进入当前人物 / 机器 profile，同时不破坏 room context 的既有 drill-in。
- 业务结论: 2026 年 4 月 11 日 `TKT-88` 已把 shell-level profile hub 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-shell-profile-hub.md` 已记录 `Profile Hub -> human -> machine -> agent -> room context regression` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web` 已锁住壳层类型、构建与 live truth hygiene，因此这条 shell profile-entry 用例当前转为 `Pass`。

## TC-078 PR Detail Delivery Collaboration Thread

- 业务目标: 确认 PR detail 已把 parent `delivery-closeout` 与 child `delivery-reply` 的正式沟通收成同一条 `Delivery Collaboration Thread`，而不是只靠一段 delegation summary 字串拼接。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: final lane closeout 已自动创建 delegated closeout handoff；parent 被 `blocked` 后，会自动生成 child `delivery-reply`。
- 测试步骤:
  1. 使用 `formal-handoff` delivery policy，让 final QA closeout 自动生成 delegated closeout handoff。
  2. 将 parent delegated closeout 标记为 `blocked`，打开 `/pull-requests/pr-runtime-18`。
  3. 确认 `Delivery Collaboration Thread` 先后出现 `Parent Closeout request -> blocker -> Unblock Reply x1 request` 三条 thread entry。
  4. 让 child `delivery-reply` 追加 source comment、完成 unblock response，并让 parent 重新 `acknowledged`。
  5. 刷新 PR detail，确认 thread 继续出现 child formal comment、parent resume 以及 child `parent-progress`，且顺序保持 `parent blocker -> child comment -> parent resume -> child parent-progress`。
  6. 点击任一 thread entry 的回链按钮，确认能 deep-link 回对应 Mailbox handoff。
- 预期结果: PR detail 不应再只把跨 Agent closeout 压成一段不断被覆盖的摘要。用户必须能在同一屏直接回放 parent / child 两条 ledger 的 request、blocker、formal comment、resume 与 progress，并能一跳回到对应 Mailbox 上下文。
- 业务结论: 2026 年 4 月 11 日 `TKT-89` 已把 unified delivery collaboration thread 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-communication-thread.md` 已记录 `parent request -> blocker -> child request -> child comment -> parent resume -> child parent-progress` 的 Windows Chrome 有头 walkthrough，同时 `pnpm verify:web`、`go test ./internal/store -run "TestDeliveryDelegationCommunicationThreadAggregatesParentAndReplyMessages" -count=1` 与 `go test ./internal/api -run "TestDeliveryDelegationCommunicationThreadRoute" -count=1` 已锁住 store/API contract、前端 type/build 与 chronological thread truth，因此这条 PR detail collaboration-thread 用例当前转为 `Pass`。

## TC-079 PR Detail Delivery Thread Actions

- 业务目标: 确认 PR detail 不只是回放 parent / child delivery thread，而是能直接驱动当前 delegated closeout 与 `delivery-reply` 的正式 mutation。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: final lane closeout 已自动创建 delegated closeout handoff；parent 被 `blocked` 后，会自动生成 child `delivery-reply`；当前会话具备 `run.execute` 权限。
- 测试步骤:
  1. 使用 `formal-handoff` delivery policy，让 final QA closeout 自动生成 delegated closeout handoff，并打开 `/pull-requests/pr-runtime-18`。
  2. 在 PR detail `Thread Actions` 内给 parent delegated closeout 填写 blocker note，执行 `blocked`。
  3. 确认同页长出 child `delivery-reply` action card，且 `Delivery Delegation` summary 与 `Delivery Collaboration Thread` 一起出现这条 blocker 上下文。
  4. 在 child action card 内直接执行 formal comment、`acknowledged`、`completed`，确认 PR detail summary / thread count / card status 同页同步刷新。
  5. 点击 `Resume Parent Closeout`，确认 parent handoff 在同页切到 `handoff acknowledged`，且 thread 继续保留 child response 完成后的历史。
  6. 点击 action card 的 `Open In Mailbox`，确认仍能 deep-link 回对应 Mailbox handoff。
- 预期结果: PR detail 必须成为正式 closeout 执行入口，而不是只读旁观面。用户应能在同一页完成 parent block、child reply comment/ack/complete、以及 parent resume，并看到这些 mutation 直接以前台 live truth 回刷。
- 业务结论: 2026 年 4 月 11 日 `TKT-90` 已把 PR detail thread action surface 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-delegate-thread-actions.md` 已记录 `parent blocked -> child comment -> child completed -> resume parent` 的 Windows Chrome 有头 walkthrough，同时 `pnpm --dir apps/web typecheck`、`bash -lc 'cd apps/web && pnpm exec eslint src/components/pull-request-detail-view.tsx'` 与 `pnpm verify:web` 已锁住前端类型、lint、构建和 live truth hygiene，因此这条 PR detail inline-action 用例当前转为 `Pass`。

## TC-080 Mailbox Batch Queue

- 业务目标: 确认 `/mailbox` 已能围当前可见 room ledger 的多条 open handoff 做统一批量处理，而不是让 reviewer / tester lane 逐卡重复点 `acknowledged / comment / completed`。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 当前 room 已存在至少两条 open handoff；当前会话具备 `run.execute` 权限。
- 测试步骤:
  1. 打开 `/mailbox?roomId=room-runtime`，确认两条 open handoff 已出现在当前 room ledger。
  2. 点击 `Select Open`，确认 `Batch Queue` 会把当前可见 open handoff 全部锁定，并出现对应 selected chip。
  3. 执行 `Batch Acknowledge`，确认两条 handoff 都切到 `acknowledged`。
  4. 填写统一 note，选择 `source agent`，执行 `Batch Formal Comment`，确认每条 handoff 都追加 formal comment，且 lifecycle 继续保持 `acknowledged`。
  5. 再填写统一 closeout note，执行 `Batch Complete`，确认两条 handoff 都切到 `completed`，open queue 清零、selection 自动清空。
  6. 回读 state / inbox，确认 closeout note 进入 handoff truth 与 inbox summary。
- 预期结果: Mailbox 必须提供真实可用的批量 closeout 面。多条 handoff 的批量动作应继续沿既有单条 handoff contract 顺序写回，不允许出现前端 fake batch state、selection 残留或 inbox 摘要不同步。
- 业务结论: 2026 年 4 月 11 日 `TKT-91` 已把 mailbox batch queue 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-batch-queue.md` 已记录 `requested -> selected -> batch acknowledged -> batch comment -> batch completed` 的 Windows Chrome 有头 walkthrough，同时 `pnpm --dir apps/web typecheck`、`bash -lc 'cd apps/web && pnpm exec eslint src/components/live-mailbox-views.tsx src/components/stitch-board-inbox-views.tsx'` 与 `node --check scripts/headed-mailbox-batch-actions.mjs` 已锁住前端类型、lint 与脚本合法性，因此这条 mailbox bulk-closeout 用例当前转为 `Pass`。

## TC-081 Governance Escalation Queue

- 业务目标: 确认 workspace governance 的 escalation 不再只剩 SLA summary，而是把 active handoff 与 blocked inbox signal 收成正式 queue truth，并在 `/mailbox` 与 `/agents` 同源展示。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: 当前 workspace 已启用 governance snapshot；存在至少一条 formal handoff；当前会话具备 `run.execute` 权限。
- 测试步骤:
  1. 打开 `/mailbox?roomId=room-runtime`，确认 baseline 下 escalation queue 为空或只显示当前真实 queue entry。
  2. 创建一条 formal handoff，确认 governance panel 会新增 `mailbox handoff` entry，并带出 `label / source / owner / next-step / deep-link`。
  3. 打开 `/agents`，确认 orchestration governance 面会镜像同一条 escalation queue entry，而不是另一套本地状态。
  4. 将 handoff 标记为 `blocked`，确认 queue 会同时出现 blocked handoff 与 related `inbox blocker` entry。
  5. 将 handoff 重新 `acknowledged -> completed`，确认 `/mailbox` 与 `/agents` 的 escalation queue 一起清空，state snapshot 的 queue truth 同步归零。
- 预期结果: escalation queue 必须成为正式治理对象，而不是 aggregate SLA 的装饰性解释。queue entry 应持续引用既有 handoff / inbox 真相，并在 closeout 后自动消退。
- 业务结论: 2026 年 4 月 11 日 `TKT-92` 已把 governance escalation queue 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-queue.md` 已记录 `requested -> blocked -> cleared` 的 Windows Chrome 有头 walkthrough，同时 `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMailboxLifecycleHydratesWorkspaceGovernance" -count=1'`、`bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestStateRouteExposesGovernanceSnapshot|TestMailboxLifecycleUpdatesGovernanceSnapshot" -count=1'`、`pnpm --dir apps/web typecheck`、`bash -lc 'cd apps/web && pnpm exec eslint src/components/live-mailbox-views.tsx src/components/live-orchestration-views.tsx src/lib/phase-zero-helpers.ts src/lib/live-phase0.ts src/lib/phase-zero-types.ts'` 与 `node --check scripts/headed-governance-escalation-queue.mjs` 已锁住 store/API contract、前端类型、lint 与脚本合法性，因此这条 escalation queue 用例当前转为 `Pass`。

## TC-082 Governance Escalation Rollup

- 业务目标: 确认 governance escalation 不只围当前焦点 queue，而是会把整个 workspace 里仍在冒烟的 room 收成正式 rollup，并在 `/mailbox` 与 `/agents` 同源展示。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: workspace baseline 已存在治理快照；至少有两个不同 room 可用于制造 blocked + active 的 cross-room hot path；当前会话具备 `run.execute` 权限。
- 测试步骤:
  1. 读取 baseline governance rollup，确认当前 workspace 的既有 hot-room 数量。
  2. 在 primary room 创建 formal handoff 并标记为 `blocked`，确认 primary room 会作为 blocked room 进入 rollup。
  3. 在另一个未出现在 baseline rollup 的 room 创建 active handoff，确认 secondary room 也会进入同一条 rollup，而不是只认 blocker。
  4. 打开 `/mailbox` 与 `/agents`，确认两处都显示 `room / status / count / latest escalation / deep-link` 的同源 rollup。
  5. 先收口 primary room，再收口 secondary room，确认 rollup 会先减一，再回退到 baseline hot-room 数量。
- 预期结果: cross-room escalation rollup 必须成为正式治理对象，而不是当前 queue 的附注。用户应该能从任一治理面立刻发现“别的 room 也在冒烟”，同时 closeout 后 rollup 要沿同一份 handoff truth 自动清退。
- 业务结论: 2026 年 4 月 11 日 `TKT-93` 已把 governance escalation room rollup 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-rollup.md` 已记录 `baseline -> primary blocked + secondary active -> primary cleared -> baseline restored` 的 Windows Chrome 有头 walkthrough，同时 `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMailboxLifecycleHydratesWorkspaceGovernance" -count=1'`、`bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestStateRouteExposesGovernanceSnapshot|TestMailboxLifecycleUpdatesGovernanceSnapshot" -count=1'`、`pnpm verify:web`、`node --check scripts/headed-governance-escalation-rollup.mjs` 与 `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governance-escalation-queue -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-queue.md` 已锁住 store/API contract、前端构建与相邻 queue 回归，因此这条 cross-room governance rollup 用例当前转为 `Pass`。

## TC-083 Mailbox Governed Batch Policy

- 业务目标: 确认 batch queue 不只会批量 closeout，而是会围 governed handoff 读取正式 routing policy，并支持 `Batch Complete + Auto-Advance` 把下一棒拉起来。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: workspace 已启用 dev-team governance；当前 room 存在至少两条 governed handoff；QA lane 已映射到真实默认 Agent；当前会话具备 `run.execute` 权限。
- 测试步骤:
  1. 通过正式 create contract 创建两条 `kind=governed` 的 reviewer handoff，确认 `/mailbox` 能读到 governed selection。
  2. 选中这两条 open governed handoff，确认 `Governed Batch Policy` 先显示 `watch`，提示当前 selection 还不能 bulk auto-advance。
  3. 对 selection 先做 batch `acknowledged`，确认 policy 状态切到 `ready`。
  4. 执行 `Batch Complete + Auto-Advance`，确认两条源 handoff 顺序完成并保留同一份 closeout note。
  5. 验证系统只物化一条 reviewer -> QA followup handoff，selection 自动清空，routing policy 把 followup 标成新的 active suggestion。
- 预期结果: governed batch policy 必须成为正式产品面，而不是单卡 `Complete + Auto-Advance` 的孤立快捷方式。用户应能一眼分辨“当前 selection 是否可 bulk auto-advance”，并在 bulk closeout 后看到唯一的 next-lane followup。
- 业务结论: 2026 年 4 月 11 日 `TKT-94` 已把 mailbox governed batch policy 收进正式产品面。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-batch-policy.md` 已记录 `requested -> acknowledged -> batch complete + auto-advance -> reviewer -> QA followup` 的 Windows Chrome 有头 walkthrough，同时 `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMailboxRoutesCreateAndListLiveTruth|TestMailboxRoutesAdvanceLifecycleAndGuardrails" -count=1'`、`pnpm verify:web`、`node --check scripts/headed-mailbox-batch-policy.mjs` 与 `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-mailbox-batch-actions -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-mailbox-batch-queue.md` 已锁住 create contract、前端构建、新功能 walkthrough 与相邻 batch queue 回归，因此这条 governed bulk auto-advance 用例当前转为 `Pass`。

## TC-084 Cross-Room Governance Orchestration

- 业务目标: 确认 cross-room governance rollup 不只会告诉人类“哪个 room 在冒烟”，而是会补齐 room-level `current owner / current lane / next governed route` 元数据，并在 `/mailbox` 与 `/agents` 把这些 hot room 组织成可读的 `room -> current owner/lane -> next route` dependency graph；用户还应能直接在 `/mailbox` 上对 `ready` hot room 发起下一棒 governed handoff。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: workspace 已启用 dev-team governance；存在至少一个当前不在 baseline rollup 中的 room；当前会话具备 `run.execute` 权限；Windows Chrome 有头浏览器可用。
- 测试步骤:
  1. 读取 baseline governance rollup，确认目标 room 当前还不是 hot room。
  2. 通过真实 blocked inbox replay 把目标 room 抬进 cross-room rollup，确认 room entry 会带出 `current owner / current lane / next governed route`，且 route status = `ready`。
  3. 打开 `/mailbox`，确认目标 room rollup card 会显示 `Create Governed Handoff`，并且 `/mailbox` 与 `/agents` 的 dependency graph 都会把该 room 组织成 `讨论间 -> 当前负责人/分工 -> 下一棒`。
  4. 在 `/mailbox` 点击 `Create Governed Handoff`，确认 server 通过正式 contract 创建一条 room-level `kind=governed` handoff。
  5. 检查目标 room 的 rollup route status 是否从 `ready` 切到 `active`，graph 里的“下一棒”节点是否同步切到 `active`，`Open Next Route` 是否 deep-link 到新 handoff，并确认 `/agents` 与 Inbox deep-link 同步读取同一份 active truth。
- 预期结果: cross-room rollup 必须成为可执行治理面，而不是只读摘要。用户应能在不切回 compose 的前提下，直接从 hot room 发起下一棒 governed handoff，并通过 `/mailbox` 与 `/agents` 上的 dependency graph 一眼看出“当前卡在哪个 owner / lane，下一棒准备交给谁”，且所有 surface 都围同一条 handoff truth 前滚。
- 业务结论: 2026 年 4 月 11 日 `TKT-95` 已把 cross-room governance orchestration 收进正式产品面；2026 年 4 月 14 日又追加 `docs/testing/Test-Report-2026-04-14-windows-chrome-cross-room-governance-dependency-graph.md`，把 `/mailbox` 与 `/agents` 上的 cross-room dependency graph 一并锁进 Windows Chrome 有头证据；同日新增 `docs/testing/Test-Report-2026-04-14-windows-chrome-cross-room-governance-auto-closeout.md`，继续锁住 `reviewer -> QA -> auto-complete` 之后 runtime room 会保留原 blocker hot truth、route 切到 `done`、且 `delivery-closeout / delivery-reply` sidecar 不会污染 cross-room rollup / graph。当前这些报告已共同记录 `blocked hot room -> route ready -> dependency graph visible -> create governed handoff -> route active -> done route / PR detail closeout` 的前滚，同时 `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestCreateGovernedHandoffForRoomUsesRoomSpecificSuggestion|TestAdvanceHandoffCanAutoAdvanceGovernedRoute|TestMailboxLifecycleHydratesWorkspaceGovernance|TestAutoCompleteDeliveryDelegationDoesNotPolluteCrossRoomEscalationRollup|TestAutoCompleteDeliveryDelegationKeepsBlockedRuntimeRoomHotButMarksRouteDone" -count=1'`、`bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMailboxRoutesCreateGovernedHandoffForRoom|TestMailboxRoutesCreateAndListLiveTruth|TestStateRouteExposesGovernanceSnapshot|TestMailboxLifecycleUpdatesGovernanceSnapshot|TestAutoCompleteDeliveryDelegationDoesNotPolluteCrossRoomGovernanceSnapshot|TestAutoCompleteDeliveryDelegationKeepsBlockedRuntimeRoomHotButMarksRouteDoneInGovernanceSnapshot" -count=1'`、`pnpm test:headed-governance-escalation-rollup`、`OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-cross-room-governance-auto-closeout -- --report docs/testing/Test-Report-2026-04-14-windows-chrome-cross-room-governance-auto-closeout.md`、`pnpm verify:web` 与 `node --check scripts/headed-cross-room-governance-orchestration.mjs` 已锁住 store/API contract、相邻 rollup 回归、前端构建和 headed script 合法性，因此这条 room-level cross-room orchestration / dependency graph 用例当前继续保持 `Pass`。

## TC-085 Memory Provider Orchestration

- 业务目标: 确认 memory provider 不只停在 PRD 字段，而是能成为可编辑、可持久化、可进入 next-run preview 的正式产品真相。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-10` `CHK-22`
- 前置条件: `/memory` 已消费 `/v1/memory-center` 与 `/v1/memory-center/providers`，且 store 具备 durable `memory-center.json`。
- 测试步骤:
  1. 打开 `/memory`，检查 `workspace-file / search-sidecar / external-persistent` provider cards。
  2. 启用 Search Sidecar 与 External Persistent，并保存 provider bindings。
  3. 切到 `session-memory` preview，检查 active providers、scope、retention 和 degraded health note。
  4. reload 页面，确认 provider enabled/status 保持。
- 预期结果: provider binding 会写回 durable truth，next-run preview 会读到 active provider 编排，而缺少 index / adapter stub 时必须显式 degraded，不允许假装健康。
- 业务结论: 2026 年 4 月 11 日 `TKT-96` 新增 `/v1/memory-center/providers`、`/memory` provider orchestration editor 和 `pnpm test:headed-memory-provider-orchestration`，把 provider binding 收成正式产品真相。当前 `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMemoryCenterBuildsInjectionPreviewAndPromotionLifecycle|TestMemoryCleanupPrunesStaleQueueAndKeepsPromotionPathLive|TestMemoryProviderBindingsPersistAndAnnotatePromptSummary" -count=1'`、`bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMemoryCenterRoutesExposePolicyPreviewAndPromotionLifecycle|TestMemoryCenterCleanupRoutePrunesQueueAndKeepsPromotionFlowLive|TestMemoryCenterProviderRoutesExposeDurableProviderBindings|TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces" -count=1'`、`pnpm verify:web` 与 `node --check scripts/headed-memory-provider-orchestration.mjs` 继续锁住 binding / preview / persistence contract，因此这条 provider orchestration 用例继续保持 `Pass`。

## TC-086 Memory Provider Health Recovery

- 业务目标: 确认 memory provider 不只记录 binding，还拥有真实的 health check / recovery 生命周期，并能把失败、恢复、依赖降级和 reload persistence 收成正式产品真相。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-10` `CHK-22`
- 前置条件: `/memory` 已消费 provider orchestration truth，且 store 能把 provider health timeline 写回 durable `memory-center.json`。
- 测试步骤:
  1. 打开 `/memory`，启用 Search Sidecar 与 External Persistent。
  2. 检查 provider 初始 health 是否因缺少 local index / adapter stub 显式进入 `degraded`，并出现 next action。
  3. 对 Search Sidecar 先执行 `run health check`，再执行 `attempt recovery`，确认其从 `degraded` 拉回 `healthy`。
  4. 对 External Persistent 执行 `attempt recovery`，确认其生成 local relay stub，并提示真实 remote sink 仍待后续接入。
  5. 人为移除 `MEMORY.md` 后，对 Workspace File 执行 `run health check` 和 `attempt recovery`，确认 workspace scaffold 可自愈，且 Search Sidecar 会同步反映依赖降级。
  6. 切到 `session-memory` preview，并 reload 页面，确认 provider health summary / next action / activity timeline 保持。
- 预期结果: provider 缺少依赖时必须 fail loud；恢复后必须回到同一份 durable truth，并被 preview / prompt summary / reload 后的页面继续读到。
- 业务结论: 2026 年 4 月 11 日 `TKT-97` 新增 `POST /v1/memory-center/providers/check`、`POST /v1/memory-center/providers/:id/recover`、`/memory` provider health timeline 与 `pnpm test:headed-memory-provider-health-recovery`。当前 `docs/testing/Test-Report-2026-04-11-windows-chrome-memory-provider-health-recovery.md` 已记录 `degraded -> check -> recover -> workspace drift -> dependent degrade -> recover -> preview -> reload` 的 Windows Chrome 有头 walkthrough，同时 `bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/store -run "TestMemoryProviderBindingsPersistAndAnnotatePromptSummary|TestMemoryProviderHealthCheckAndRecoveryLifecycle" -count=1'`、`bash -lc 'cd apps/server && ../../scripts/go.sh test ./internal/api -run "TestMemoryCenterProviderRoutesExposeDurableProviderBindings|TestMemoryCenterProviderHealthRoutesRecoverDurableBindings|TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces" -count=1'`、`pnpm verify:web` 与 `node --check scripts/headed-memory-provider-health-recovery.mjs` 已锁住 health/recovery contract、前端构建和 headed script 合法性，因此这条 provider health/recovery 用例当前转为 `Pass`。

## TC-087 Multi-Agent Sequential Owner Continuity / Restart Resume

- 业务目标: 确认多智能体 room-auto 协作在 `A -> B -> C` 顺序交接后，当前 owner、provider 路由、memory preview/provider 和公开发言都继续锚定最新接手者；即使 server/store 重启，也不会掉回 stale recent-run actor。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21` `CHK-22`
- 前置条件: 存在至少 3 个 Agent、room-auto handoff contract、durable store 持久化、memory center/provider contract，以及可重放的 headed multi-agent 场景。
- 测试步骤:
  1. 让 Agent A 在 room 内公开收需求，并自动交棒给 Agent B。
  2. 再发送下一条房间消息，确认当前轮由 Agent B 回应，并继续自动交棒给 Agent C。
  3. 检查第二次 auto-followup 的 provider 与 prompt identity 是否都切到 Agent C，而不是沿用 Agent B 的 stale `RecentRunIDs`。
  4. 打开 `/memory`，切到当前 issue 对应的 session preview，确认 prompt summary 与 provider note 已切到 Agent C，而不是停在 Agent B。
  5. reload `/memory` 后再次读取同一 session preview，确认当前 owner 和 provider note 继续保持。
  6. 重启 store / server 后再次发送 room 消息，确认当前 owner、provider 路由、公开消息 speaker 仍然保持在 Agent C。
  7. 回读 room / mailbox / state，确认公开消息不泄露 `SEND_PUBLIC_MESSAGE` 或 `OPENSHOCK_HANDOFF:` 内部协议。
- 预期结果: 顺序交接后的当前 owner 必须始终以 `run.Owner -> issue.Owner -> room.Topic.Owner` 为准；auto-followup、memory preview 和重启恢复后的下一轮消息都要路由给最新 owner，且 provider binding / degraded note 不能因为 reload/restart 掉回 stale actor。
- 业务结论: 2026 年 4 月 12 日新增或补强 `TestRoomMessageStreamSequentialAutoHandoffsPersistCurrentOwnerAcrossRestart`、`TestRoomAutoHandoffClarificationFollowupSurvivesRestart`、`TestResolveRoomTurnAgentPrefersCurrentOwnerOverStaleRecentRunIDs`、`TestMemoryCenterProviderPreviewTracksCurrentOwnerAcrossHandoffReload` 与 `TestPlannerQueueRoutePrefersCurrentOwnerOverStaleRecentRunAgent`，把 `A -> B -> C` 顺序交接、当前 owner 的 provider / identity / prompt scaffold 路由、memory preview/provider 在 handoff + reload 后的连续性、planner queue visible truth，以及 handoff 后 clarification wait 在 store reload / server restart 后的 resume continuity 一起锁进 `go test ./apps/server/internal/api` 和 `go test ./apps/server/internal/store`。同日 `node ./scripts/headed-multi-agent-movie-studio.mjs --report output/testing/headed-multi-agent-movie-studio-report.md` 继续给出 `星野产品 -> 折光交互 -> 青岚策展` 的公开协作链、Mailbox walkthrough、最终 owner 上下文与 protocol leak probe `PASS`；`node ./scripts/headed-memory-provider-orchestration.mjs --report output/testing/headed-memory-provider-orchestration-report.md` 则继续验证 `/memory` provider surface、next-run preview 和 reload persistence `PASS`。因此这条跨交接/记忆/恢复连续体验证当前转为 `Pass`。

## TC-088 Memory Provider Preview Owner Continuity

- 业务目标: 确认 memory provider binding 开启后，session next-run preview 会同时跟随当前 owner 与 provider health truth 前滚；发生 room-auto handoff 和 store/server reload 后，也不会掉回 stale recent-run actor 或旧 prompt。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-10` `CHK-22`
- 前置条件: 已启用 `workspace-file / search-sidecar / external-persistent` provider binding，且 room-auto handoff 可以把 `room / run / issue` owner 切到新的 Agent。
- 测试步骤:
  1. 开启 memory provider binding，确认 preview 已出现 provider summary 和 degraded/healthy health note。
  2. 在 `room-runtime` 依次执行 `Codex Dockmaster -> Claude Review Runner -> Memory Clerk` 两次 room-auto handoff。
  3. 读取 `session-runtime` 的 memory preview，确认 prompt summary 已切到 `Memory Clerk`，同时继续保留 search/external provider 的当前 health note。
  4. reload store/server 后再次读取 `session-runtime` preview，确认 owner、prompt scaffold 和 provider summary 继续保持同一份 durable truth。
  5. 验证 preview 不再出现 `Claude Review Runner` 的 stale prompt scaffold。
- 预期结果: memory preview 必须围当前 owner 与 provider binding 的组合真相前滚；handoff 和重启后既不能把 agent prompt 漂回旧 owner，也不能丢失 provider orchestration/health 摘要。
- 业务结论: 2026 年 4 月 12 日新增 `TestMemoryProviderPreviewFollowsCurrentOwnerAcrossHandoffReload` 与 `TestMemoryCenterProviderPreviewTracksCurrentOwnerAcrossHandoffReload`，把 `provider binding -> room-auto handoff -> session-runtime preview -> reload` 这条跨链回归同时锁进 `store` 与 `/v1/memory-center` contract。当前 targeted `go test ./apps/server/internal/store` 与 `go test ./apps/server/internal/api` 已覆盖 `Memory Clerk` 当前 owner、provider degraded summary 和 reload 后不回落到 stale Claude prompt，因此这条 memory/provider continuity 用例当前转为 `Pass`。

## TC-089 Mention Reply Claim Guard

- 业务目标: 确认被点名的 Agent 即使返回 `summary` 或 `clarification_request`，也不会因为误带 `CLAIM: take` 就偷偷改掉当前 owner；`CLAIM: take` 只应对真正的持续接手消息生效。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: room 已有稳定 owner；至少存在一名被 mention 的次级 Agent；room message route 支持 `SEND_PUBLIC_MESSAGE` envelope。
- 测试步骤:
  1. 发送一条明确点名次级 Agent 的房间消息，让 daemon 返回 `KIND: summary`、`CLAIM: take` 的公开同步。
  2. 检查返回的公开正文与 room timeline，确认 summary 正常显示，但 `room / run / issue` owner 保持原 owner 不变。
  3. 再发送一条明确点名次级 Agent 的房间消息，让 daemon 返回 `KIND: clarification_request`、`CLAIM: take` 的阻塞澄清。
  4. 检查返回的公开问题与 room paused 状态，确认当前 speaker 正确切到被点名 Agent，但 owner 仍保持原 owner，不生成额外 formal handoff。
- 预期结果: mention-response 的 `summary / clarification_request` 只能产生可见同步或问题，不得顺手改写 owner truth。owner 只能在真正的 `message + CLAIM: take` 或 formal handoff 下前滚。
- 业务结论: 2026 年 4 月 12 日新增 `TestRoomMessageRouteSummaryClaimTakeDoesNotTransferOwnership` 与 `TestRoomMessageRouteClarificationClaimTakeDoesNotTransferOwnership`，并把 `applyRoomResponseDirectives` 收紧为只对 `KIND: message` 接受 `CLAIM: take`。当前 targeted `go test ./apps/server/internal/api` 已验证 summary/clarification 两条路径都不会再偷改 `room / run / issue` owner，因此这条 claim guard 用例当前转为 `Pass`。

## TC-090 Auto-Handoff Public Speech Discipline

- 业务目标: 确认 room-auto handoff 后的自动续写不再重复“我已接手”式铺垫，也不会把公开房间写成长段旁白；回复要更像自然团队同步，同时继续保持 protocol leak 防护。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21`
- 前置条件: room-auto handoff contract 已开启；存在可重放的多 Agent 顺序协作脚本；公开消息仍通过 `SEND_PUBLIC_MESSAGE` envelope 进入房间。
- 测试步骤:
  1. 读取 auto-followup prompt，确认其明确要求优先 `KIND: no_response`、不要继续转交别人、若公开回复则只用 `1 到 2 句` 说明当前判断和下一步。
  2. 让 auto-handoff followup 明确返回 `SEND_PUBLIC_MESSAGE / KIND: no_response`，确认 owner / mailbox 继续前滚，但房间里不会再追加一条冗余的 “已接棒” system narration。
  3. 运行 `A -> B -> C` 的多 Agent 有头脚本，检查两次 auto-handoff 后的公开房间消息。
  4. 检查 `/mailbox` 与 `/memory`，确认 owner continuity、provider preview 与 handoff ledger 继续成立。
  5. 对 room state 做 protocol leak probe，确认公开消息不泄露 `SEND_PUBLIC_MESSAGE` 或 `OPENSHOCK_HANDOFF:` 内部协议。
- 预期结果: auto-handoff 的自动续写应更短、更直接、更像房间里的自然同步；若接棒方选择静默内部推进，公开房间里不应再多出一条系统旁白，同时 owner continuity、Mailbox/memory continuity 与 protocol hygiene 不得回退。
- 业务结论: 2026 年 4 月 12 日新增 `TestBuildRoomAutoFollowupPromptPrefersSilentContinuation` 与 `TestRoomAutoHandoffFollowupSupportsNoResponseEnvelope`，把 auto-followup prompt 收紧为“优先静默继续，公开回复时只保留当前判断 + 下一步”，并验证 `no_response` 时不会再在 room transcript 里补一条冗余的 `已接棒` system narration。同日重新执行 `node ./scripts/headed-multi-agent-movie-studio.mjs --report output/testing/headed-multi-agent-movie-studio-report.md`，继续给出 `VERDICT: PASS`，覆盖 `星野产品 -> 折光交互 -> 青岚策展` 的顺序交接、Mailbox walkthrough、`/memory` preview continuity 和 protocol leak probe，因此这条公开发言纪律用例当前转为 `Pass`。

## TC-091 Clarification Wait Memory Preview Resume Continuity

- 业务目标: 确认 `room auto-handoff -> clarification wait -> /v1/memory-center preview/provider -> store/server reload -> 下一轮 room message resume` 这整条连续体围同一 current owner 前滚，不会在阻塞态或重启后掉回旧 owner / 旧 prompt / 旧 provider 视图。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21` `CHK-22`
- 前置条件: room-auto handoff contract、clarification wait contract、memory provider binding 与 reload/restart 恢复基线已存在。
- 测试步骤:
  1. 为当前工作区开启 `workspace-file / search-sidecar / external-persistent` provider binding。
  2. 在 room 中发送一条消息，让当前 owner 公开交棒给次级 Agent；自动 followup 立即返回 `KIND: clarification_request`，并确认 `room / run / issue` 进入 `paused`、当前 owner 切到 `Claude Review Runner`。
  3. 读取 `/v1/memory-center`，确认当前 session preview 已切到新的 waiting owner，并同时带出 provider degraded/health truth。
  4. reload store/server 后再次读取 `/v1/memory-center`，确认 preview 仍锚定同一 waiting owner 和同一组 provider summary。
  5. 再向同一 room 补充澄清信息，确认下一轮继续路由给 waiting owner，且 `/v1/memory-center` preview 继续保持同一 current owner。
- 预期结果: clarification wait 期间和 restart 之后，room route、memory preview、provider summary、owner truth 必须保持同一份 durable continuity；不能因为 reload/restart 掉回旧 owner、旧 prompt scaffold 或旧 provider 视图。
- 业务结论: 2026 年 4 月 12 日新增 `TestRoomAutoHandoffClarificationMemoryCenterPreviewPersistsAcrossRestart`，把 `正式交棒 -> 阻塞澄清 -> /v1/memory-center preview -> reload -> 恢复回复` 这条跨链回归正式锁进 `go test ./apps/server/internal/api`。同轮还复跑了 `TestRoomAutoHandoffClarificationFollowupSurvivesRestart`、`TestRoomMessageRouteClarificationWaitSurvivesStoreReload`、`TestMemoryCenterProviderPreviewTracksCurrentOwnerAcrossHandoffReload` 与 `TestMemoryProviderPreviewFollowsCurrentOwnerAcrossHandoffReload`。2026 年 4 月 14 日又新增 `pnpm test:headed-room-clarification-wait -- --report output/testing/headed-room-clarification-wait-report.md`，把 room 前台的显式等待补充卡片、等待 owner/问题展示、reload 后继续可回复、锁定阻塞问题与补充后自动恢复执行也补成有头证据，因此这条 room/memory/restart 连续性当前继续保持 `Pass`。

## TC-092 Current Owner Truth Beats Stale Completion Aggregation

- 业务目标: 确认当 `A -> B -> C` 顺序交接后，旧 lane 的 completion note 不会再冲掉当前 owner 的 `run detail / session control note / memory preview / workspace governance final response`；三个面对外真相必须继续围当前 owner 收口。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-21` `CHK-22`
- 前置条件: room-auto handoff contract、run detail history surface、memory center preview 和 workspace governance response aggregation 已存在。
- 测试步骤:
  1. 在 `room-runtime` 依次执行 `Codex Dockmaster -> Claude Review Runner -> Memory Clerk` 两次 room-auto handoff，确认当前 owner 已切到 `Memory Clerk`。
  2. 对第一条旧 handoff 追加 `completed`，写入一条只属于旧 reviewer lane 的 closeout note。
  3. 读取 `/v1/runs/run_runtime_01/detail`，确认 `run.Owner / room.Topic.Owner / history[0]` 仍锚定当前 run 和 `Memory Clerk`。
  4. 读取 `/v1/memory-center`，确认 `session-runtime` preview 继续使用 `Memory Clerk` 的 prompt scaffold，不回落到 stale reviewer prompt。
  5. 读取 `/v1/state`，确认 `workspace.governance.responseAggregation.aggregator/finalResponse` 继续围当前 owner，而不是吃进旧 handoff 的 completion note。
- 预期结果: 旧 handoff completion 只能留在自己的 mailbox ledger，不得回写污染当前 active run/session/governance aggregation；对外 surface 必须继续锚定当前 owner 的 closeout truth。
- 业务结论: 2026 年 4 月 13 日新增 `TestGovernanceAggregationPrefersCurrentOwnerOverStaleCompletedHandoff` 与 `TestStaleCompletedHandoffDoesNotOverrideActiveRunTruth`，同时复跑 `TestRunDetailRouteReturnsResumeContextAndRoomHistory`、`TestMemoryProviderPreviewFollowsCurrentOwnerAcrossHandoffReload`、`TestMailboxLifecycleUpdatesGovernanceSnapshot` 与 `TestRoomAutoHandoffClarificationMemoryCenterPreviewPersistsAcrossRestart`。当前 targeted `go test ./apps/server/internal/api` 与 `go test ./apps/server/internal/store` 已确认旧 reviewer closeout 不会再抢走 `Memory Clerk` 的 active owner / final response truth，因此这条跨 `run -> memory -> governance` 聚合连续性用例当前转为 `Pass`。

## TC-093 Persistent Session Workspace Envelope

- 业务目标: 确认 daemon 对同一 `sessionId` 会持续复用同一份本地工作区，并把当前 turn、session metadata 与 work log 写成可恢复的文件锚点。
- 前置条件: daemon runtime exec 已支持 `sessionId / runId / roomId` 元数据；存在可控 fake CLI。
- 测试步骤:
  1. 以同一 `sessionId` 连续执行两轮 daemon prompt。
  2. 检查 daemon session workspace 下是否存在 `MEMORY.md / SESSION.json / CURRENT_TURN.md / notes/work-log.md`。
  3. 确认 `CURRENT_TURN.md` 已刷新到第二轮 prompt，而不是继续停在第一轮。
  4. 确认 `notes/work-log.md` 同时保留两轮记录。
  5. 经 `/v1/exec` 再走一遍同样的 session metadata，确认 HTTP 路由也会落同一层文件。
- 预期结果: session workspace 必须是 stable local truth；当前 turn 会刷新，work log 会累积，HTTP 与 runtime 入口都落同一份 envelope。
- 业务结论: 2026 年 4 月 16 日新增 `TestRunPromptPersistsSessionWorkspaceEnvelope`、`TestStreamPromptRefreshesCurrentTurnAndAccumulatesWorkLog`、`TestRunPromptSessionWorkspaceRootRespectsEnvOverride` 与 `TestExecRoutePersistsSessionWorkspaceEnvelope`，并复跑 lease guard 相关 daemon API 回归。当前 targeted `go test ./apps/daemon/internal/runtime` 与 `go test ./apps/daemon/internal/api` 已确认 persistent session workspace envelope 在 daemon 侧正式落地，因此这条 continuity 用例当前转为 `Pass`。

## TC-094 Local-First Provider Thread Resume

- 业务目标: 确认 daemon restart 后，同一 session 的 Codex resume continuity 仍然锚定本地 session workspace，而不是回落到全局共享 `--last` 状态。
- 前置条件: session workspace 已持久化 `SESSION.json`；daemon 会为同一 session 派生本地 `codex-home`。
- 测试步骤:
  1. 对同一 `sessionId` 发第一轮 Codex 执行，记录输出里的 `OPENSHOCK_CODEX_HOME`。
  2. 重建 daemon service，再对同一 `sessionId` 发第二轮 `resumeSession=true` 的 Codex 执行。
  3. 确认两轮输出里的 `OPENSHOCK_CODEX_HOME` 完全一致，且路径锚定在同一 session workspace 下。
  4. 读取 `SESSION.json`，确认 `codexHome` 字段与上面的路径一致。
  5. 经 `/v1/exec` 走同一条 resume 请求，确认 HTTP 路由也会把同一 session-scoped `OPENSHOCK_CODEX_HOME` 传给 Codex CLI。
- 预期结果: 本地 session workspace 必须成为 Codex resume continuity 的恢复锚点；不同 session 不得共享全局 `--last` 状态。
- 业务结论: 2026 年 4 月 16 日新增 `TestRunPromptUsesSessionScopedCodexHome`、`TestResumeSessionReusesSessionScopedCodexHomeAcrossRestart` 与 `TestExecRouteUsesSessionScopedCodexHome`。当前 targeted `go test ./apps/daemon/internal/runtime` 与 `go test ./apps/daemon/internal/api` 已确认 daemon 会为同一 session 派生稳定的 `OPENSHOCK_CODEX_HOME`，并在 restart 后继续复用，因此这条 local-first Codex continuity 用例当前转为 `Pass`。

## TC-095 Daemon Real-Process Continuity Harness

- 业务目标: 确认真实 daemon 进程级别的 system harness 能证明多轮 session continuity、heartbeat 与恢复链，而不只是 API / runtime 单测。
- 前置条件: 可 build 的 daemon binary、httptest control plane、fake Codex CLI 与同一 `sessionId / runId / roomId` 的最小执行场景已就绪。
- 测试步骤:
  1. build `./cmd/openshock-daemon` 二进制，并用 httptest control plane 接收 `/v1/runtime/heartbeats`。
  2. 启动第一轮 daemon 进程，通过 `/v1/exec` 发第一轮 Codex 请求，确认写出 session workspace。
  3. 杀掉第一轮 daemon，再启动第二轮 daemon 进程，对同一 `sessionId` 发 `resumeSession=true` 的第二轮请求。
  4. 检查 `CURRENT_TURN.md` 已刷新到第二轮、`notes/work-log.md` 已累积两轮，且 `SESSION.json.codexHome` 保持稳定。
  5. 检查 `SESSION.json.appServerThreadId` 已持久化并在第二轮 resume 时重新注入，同时 control plane 至少收到一次 heartbeat。
- 预期结果: system harness 必须覆盖“真实 daemon 拉起 -> heartbeat -> exec -> 写回 -> restart -> resume”整链，并证明同一 session 的本地恢复锚点没有断裂。
- 业务结论: 2026 年 4 月 16 日新增 `TestDaemonContinuityHarnessAcrossRestart`。当前 `go test -tags=integration ./apps/daemon/internal/integration` 与 `go test ./apps/daemon/...` 已确认真实 daemon 子进程、control plane heartbeat、same-session Codex home、`CURRENT_TURN.md`/`notes/work-log.md` 刷新累积与 `appServerThreadId` reinjection 一起成立，因此这条 system continuity 用例当前转为 `Pass`。

## TC-096 Phase 0 Shell Subtractive Flow Sweep

- 业务目标: 确认前端在不改 chat-first 架构的前提下，持续通过减法降低操作路径和视觉噪音。
- 当前执行状态: Pass
- 前置条件: room / inbox / run / governance 主路径已有 headed walkthrough 与基准截图。
- 测试步骤:
  1. 走一遍 room 主路径，记录首屏重复 owner/status/action truth 的位置。
  2. 走一遍 inbox triage 与 governance surface，记录需要额外阅读说明才能继续的阻塞点。
  3. 应用减法后重跑同样路径，对比点击次数、滚动次数与重复信息块数量。
  4. 确认房间主面仍保持 chat-first，不把 `Topic / Run / PR / Context` 再抬回一级 IA。
  5. 输出 headed walkthrough 与前后对照截图。
- 预期结果: 主要路径必须更短、更顺，且不以加更多 panel、helper copy、summary 卡片为代价。
- 业务结论: 2026 年 4 月 17 日继续收第四刀：room `context` tab 已压成“当前焦点 + 待处理”，`RoomWorkbenchRailSummary` 把 `overview / delivery / system` 的重复双卡压回单卡表达，并补回 `room-workbench-machine-profile` 与 `room-workbench-active-agent-*`；`/mailbox` 的 cross-room governance rollup 也把 owner / next-route 的解释收回 graph 主视图；同日 `/inbox` 的 governed compose 进一步改成“自动建议优先、手动表单次级展开”，不再把自由表单和治理建议一起摊在首屏。当前 `node --check scripts/headed-cross-room-governance-orchestration.mjs`、`node --check scripts/headed-governed-mailbox-route.mjs`、`pnpm typecheck:web`、`bash -lc 'cd apps/web && pnpm exec eslint src/components/live-mailbox-views.tsx'`、`bash -lc 'cd apps/web && pnpm exec eslint src/components/stitch-board-inbox-views.tsx'`、`pnpm build:web`、`pnpm test:headed-topic-route-resume-lifecycle`、`pnpm test:headed-stop-resume-follow-thread`、`pnpm test:headed-profile-surface`、`pnpm test:headed-room-workbench-topic-context`、`pnpm test:headed-agent-mailbox-handoff`、`pnpm test:headed-approval-center-lifecycle`、`pnpm test:headed-governed-mailbox-route`、`pnpm test:headed-governance-escalation-rollup`、`pnpm test:headed-cross-room-governance-orchestration` 与 `pnpm test:headed-cross-room-governance-auto-closeout` 已通过，因此这条 subtractive sweep 用例继续保持 `Pass`；下一轮优先收 `/agents` governance mirror 与 Inbox/room 里仍重复的 owner/status/action truth。

## TC-097 Explicit Provider Thread State Persistence

- 业务目标: 确认显式 provider thread state 会作为 daemon-managed local truth 被持久化，即便真实 app-server transport 还没接进来，也不能继续停在占位字段。
- 前置条件: daemon session workspace 已存在 `SESSION.json`；执行进程可通过 daemon 提供的 thread-state file 写回 thread id。
- 测试步骤:
  1. 对同一 `sessionId` 发第一轮 provider-backed 执行，让 fake provider 通过 daemon 提供的 thread-state file 写回 `thread-001`。
  2. 读取 `SESSION.json`，确认 `appServerThreadId=thread-001`。
  3. 重建 daemon service，再对同一 `sessionId` 发第二轮 `resumeSession=true` 执行。
  4. 确认执行进程收到 `OPENSHOCK_APP_SERVER_THREAD_ID=thread-001`。
  5. 经 `/v1/exec` 再走一遍相同 resume 请求，确认 HTTP 路由也会复用同一份持久化 thread state。
- 预期结果: `SESSION.json.appServerThreadId` 必须成为可验证的本地恢复锚点；resume 时 thread state 要被显式重新注入，而不是靠隐式全局状态。
- 业务结论: 2026 年 4 月 16 日新增 `TestRunPromptPersistsAppServerThreadIDFromProviderStateFile`、`TestResumeSessionExportsPersistedAppServerThreadIDAcrossRestart` 与 `TestExecRoutePersistsAndReusesAppServerThreadID`。当前 targeted `go test ./apps/daemon/internal/runtime` 与 `go test ./apps/daemon/internal/api` 已确认 daemon 会把执行进程写回的 thread state 持久化到 `SESSION.json.appServerThreadId`，并在 restart 后 resume 时重新注入执行环境，因此这条显式 provider thread state continuity 用例当前转为 `Pass`。

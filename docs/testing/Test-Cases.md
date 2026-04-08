# OpenShock Test Cases

**版本:** 1.3
**更新日期:** 2026 年 4 月 8 日
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
  3. 检查 daemon 是否尝试创建对应 worktree lane。
- 预期结果: issue 创建后进入完整执行主链，不停留在纯数据记录。
- 业务结论: Phase 0 主链已站住。

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
- 业务结论: 2026 年 4 月 8 日 `TKT-28` 新增 `/v1/github/installation-callback` 与 `/setup/github/callback`，把 installation-complete 回跳直接写回 installation truth，并在同一次 callback 内前滚 repo binding 与 tracked PR backfill；同日 exact-head 还新增了 fail-closed 的空 `installationId` 探测与 `repo.admin` 权限 guard。结合 2026 年 4 月 7 日 `TKT-05` 已通过的 signed webhook replay harness，当前 `installation-complete callback -> repo sync -> UI update -> webhook replay` 已具备近实机闭环证据，因此这条用例现在可按 Pass 收口；剩余未覆盖的是 GitHub-hosted 公网 callback / webhook delivery 的生产态复核，而不是产品 contract 缺失。

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
- 业务结论: 当前 smoke 会显式比对 pairing URL、runtime registry、server runtime bridge 与 daemon runtime 的 daemon URL；pairing 漂移时会 fail-closed 并指出 mismatch。

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
- 业务结论: memory version / governance contract 已有后端基线。

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
- 业务结论: 2026 年 4 月 7 日新增 `pnpm test:webhook-replay`，会起临时 `openshock-server` 并对 `/v1/github/webhook` 回放 signed review / comment / check / merge 事件，同时验证 bad-signature 与 untracked PR failure contract。当前这条 replay / review-sync 用例已可独立复核并通过。

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
- 业务结论: 2026 年 4 月 7 日已先用 headed Chromium harness 稳定回放 `Setup -> Issue -> Room`，验证 room 内 PR 入口保持可继续推进状态；同日 `TKT-06` 又把 `/setup -> issue -> room -> remote PR create -> merge` 接成真实远端浏览器闭环，并把 no-auth failure path 显式打到 room / inbox / blocked surface。这条 Setup 到 PR journey 的 headed 回放当前已可独立复核并通过；`TC-015` 的 installation-complete live callback 仍留在后续远端范围。

## TC-027 Sandbox / Destructive Approval Guard

- 业务目标: 确认 destructive git、越界写入、敏感凭证使用会进入审批保护，而不是默认执行。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-12`
- 前置条件: 存在 sandbox mode 与 approval-required contract。
- 测试步骤:
  1. 触发 destructive git 或越界写入动作。
  2. 检查系统是否拦截并生成 approval item。
- 预期结果: 高风险动作不会直接执行，系统产生显式审批记录。
- 业务结论: 2026 年 4 月 8 日 `TKT-30` 已新增 `pnpm test:headed-destructive-guard -- --report docs/testing/Test-Report-2026-04-08-destructive-guard.md`。当前 destructive git 与跨 scope 写入都会先进入显式 guard truth，`/inbox` 能看到 `Action / Sandbox / Secrets / Target` 边界，`/rooms/:roomId` 与 `/runs/:runId` 也会复用同一 guard 状态；并且 non-happy `defer` 路径会把 destructive run 保持在 `blocked + approval_required`，不会静默继续执行。因此这条安全 gate 当前转为 `Pass`。

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
- 前置条件: room workbench 已提供 `Chat / Topic / Run / PR / Context` tabs 或等价切换面。
- 测试步骤:
  1. 打开一条 room。
  2. 在不离开 room 的情况下切换 `Chat / Topic / Run / PR / Context`。
  3. 验证 run control、PR entry、inbox back-link 仍保持可用。
- 预期结果: 用户围绕同一条 room 完成讨论、执行、交付和回溯，不需要频繁跨页。
- 业务结论: 2026 年 4 月 8 日 `TKT-23` 已用 `pnpm test:headed-room-workbench-topic-context -- --report docs/testing/Test-Report-2026-04-08-room-workbench-topic-context.md` 完成有头 exact replay；当前 `/rooms/:roomId` 已成为 query-driven room workbench，`Chat / Topic / Run / PR / Context` 可在同一页切换，`follow_thread` 可在 Run tab 保持可用，PR entry 不再强制跳独立详情页，Context tab 也能在 reload 与 inbox 往返后保留 room-first 状态，因此这条用例当前转为 `Pass`。

## TC-032 Board Secondary Planning Surface

- 业务目标: 确认 Board 仍可用，但已经退到次级 planning surface。
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-05` `CHK-18`
- 前置条件: board 已与 room / issue context 建立回跳关系，且主导航优先级已下调。
- 测试步骤:
  1. 从 room 或 issue 进入 planning surface。
  2. 查看 board lane 并创建或打开一条 issue。
  3. 返回 room，确认 Board 不是默认首页心智中心。
- 预期结果: Board 服务于规划，不抢占协作壳主路径。
- 业务结论: 当前 `/board` 已经退到左下角次级入口，但 planning card 语言和 room / issue 回跳还没完全收平；这条用例保留 `Not Run`，留给 `TKT-26`。

## TC-033 Quick Search / Search Result Surface

- 业务目标: 确认 Quick Search 不只是静态入口，而是可真正切换 channel / room / issue / run / agent 的结果面。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-16`
- 前置条件: 存在 Quick Search 数据源、结果列表与跳转动作。
- 测试步骤:
  1. 打开 Quick Search。
  2. 输入 channel、room、issue、run、agent 关键词。
  3. 选择结果并验证跳转与高亮。
- 预期结果: 用户不需要人工翻左栏，就能快速切换到目标工作面。
- 业务结论: 2026 年 4 月 8 日 `TKT-21` 新增 `pnpm test:headed-quick-search`，在 headed Chromium 里完成 `channel -> room -> issue -> run -> agent` 的跨类型搜索回放，并验证三种打开方式（侧栏 trigger、顶部 trigger、`Ctrl+K`）、命中高亮与 `No matches yet` empty state。当前 Quick Search 已不再只是静态入口，而是可独立复核的真实 search result surface。

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
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-13`
- 前置条件: 存在 device authorization、email verify / reset、session recovery 的真实产品流。
- 测试步骤:
  1. 新成员首次登录后触发邮箱验证或设备授权。
  2. 在另一设备上恢复登录并验证权限链。
  3. 触发邮箱重置并确认 session / member state 同步更新。
- 预期结果: 身份链不再只停留在 invite / role / quick login，而是具备完整恢复和验证能力。
- 业务结论: 当前 repo 已站住 invite / role / status / authz matrix，但 device auth / email verify / reset 仍未产品化，所以这条用例保持 `Blocked`。

## TC-036 Agent Profile / Prompt / Avatar / Memory Binding Edit

- 业务目标: 确认 Agent 已经从只读对象升级成可配置执行者。
- 当前执行状态: Pass
- 对应 Checklist: `CHK-02` `CHK-10` `CHK-19`
- 前置条件: 至少存在一个可编辑的 Agent profile surface。
- 测试步骤:
  1. 打开某个 Agent profile。
  2. 编辑 `role / avatar / prompt / memory binding / provider preference`。
  3. 保存后刷新页面，并检查 next-run preview 是否读取新配置。
- 预期结果: Agent profile edit 会持久化并影响下一次 run 的配置注入。
- 业务结论: `TKT-32` 已把 Agent profile editor、memory binding / recall policy / provider preference、next-run preview 与 profile audit 接成同一条链；这条用例现在按 headed `profile -> edit -> save -> reload` 回放转 `Pass`，machine inventory / durable config 继续留 `TKT-33` `TKT-37`。

## TC-037 Machine Profile / Local CLI Model Capability Binding

- 业务目标: 确认 Runtime / Machine 的真实能力可以被人类看到，并和 Agent 偏好绑定。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-14` `CHK-19` `CHK-22`
- 前置条件: 存在 machine profile、capability inventory 和 Agent capability preference surface。
- 测试步骤:
  1. 打开 machine profile 或 setup capability 面。
  2. 读取本地 CLI / provider / model inventory。
  3. 为某个 Agent 绑定 default provider / model / runtime affinity，并验证保存结果。
- 预期结果: Machine capability truth 和 Agent 偏好使用同一份后端配置真相。
- 业务结论: 当前 repo 已能探测部分 CLI 与 runtime truth，但还没有完整 machine profile 和 capability binding surface，所以这条用例保持 `Blocked`，留给 `TKT-33`。

## TC-038 Onboarding Wizard / Scenario Template Bootstrap

- 业务目标: 确认新团队可以通过模板完成首次启动，而不是手工拼页面。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-20`
- 前置条件: 存在 onboarding wizard、template selection 与 resumable progress。
- 测试步骤:
  1. 创建或进入一个全新 Workspace。
  2. 选择 `开发团队`、`研究团队` 或 `空白自定义` 模板。
  3. 完成 repo / GitHub / runtime pairing，并检查默认 channels、roles、agents、policy 是否被物化。
- 预期结果: 用户可以在一个连续 flow 内完成团队启动，并在中断后继续。
- 业务结论: 当前 repo 只有 Setup / Access 的基础启动骨架，没有真正模板化 onboarding，所以这条用例保持 `Blocked`，留给 `TKT-34`。

## TC-039 Agent Mailbox / Handoff Governance Ledger

- 业务目标: 确认 Agent-to-Agent 正式通信和交接可被追踪，而不是藏在隐式提示词里。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-21`
- 前置条件: 存在 Agent Mailbox、handoff lifecycle 和 human-visible ledger。
- 测试步骤:
  1. 让一个 Agent 向另一个 Agent 发起 handoff。
  2. 观察 `ack / blocked / complete` 生命周期。
  3. 在 Room / Inbox / Mailbox 中检查上下文回链和人类 override。
- 预期结果: 正式交接可见、可回放、可审计。
- 业务结论: 当前 repo 已有 room / inbox / stop-resume 基线，但还没有正式 Agent Mailbox 与 handoff ledger，所以这条用例保持 `Blocked`，留给 `TKT-35`。

## TC-040 Config Persistence / Recovery

- 业务目标: 确认 user / workspace / agent / machine 配置能跨刷新、重启和换设备恢复。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-22`
- 前置条件: 存在 durable store / database schema 与相关 API contract。
- 测试步骤:
  1. 编辑一组 workspace、agent 或 machine 配置。
  2. 刷新浏览器并重启 server。
  3. 在同设备或另一设备重新进入，检查配置是否保持一致。
- 预期结果: 配置真相不依赖浏览器本地临时状态，且恢复后下一次 run 继续使用同一份设置。
- 业务结论: 当前 repo 只有 file state、auth session persistence 和 memory governance 的局部持久化，没有统一配置 durable truth，所以这条用例保持 `Blocked`，留给 `TKT-37`。

## TC-041 Multi-Agent Role Topology / Reviewer-Tester Loop

- 业务目标: 确认 `开发团队 / 研究团队` 这类模板不只是静态角色表，而能形成受治理的多 Agent 响应链。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-20` `CHK-21`
- 前置条件: 存在 team topology、Agent Mailbox、handoff policy 和 response aggregation。
- 测试步骤:
  1. 选择一个团队模板并创建 issue。
  2. 观察 PM / Architect / Developer / Reviewer / QA 或研究团队变体的 handoff 流。
  3. 检查 review / test / blocked escalation 与 human override 是否可见。
- 预期结果: 多 Agent 分工和最终响应被治理，而不是只有一串不可解释的自动消息。
- 业务结论: 当前 repo 还没有多 Agent team topology、mailbox 和 reviewer-tester loop，所以这条用例保持 `Blocked`，留给 `TKT-36`。

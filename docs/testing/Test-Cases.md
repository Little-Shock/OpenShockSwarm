# OpenShock Test Cases

**版本:** 1.0
**更新日期:** 2026 年 4 月 6 日
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
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-04`
- 前置条件: 当前仓库未绑定或允许重新绑定。
- 测试步骤:
  1. 打开 `/setup`。
  2. 点击“绑定当前仓库”。
  3. 刷新页面并检查绑定状态。
- 预期结果: server 写回 repo binding，页面显示当前仓库已绑定。
- 业务结论: 本轮未重放，需要在下一轮 headed 自动化里补齐。

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
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-07` `CHK-08`
- 前置条件: 系统中存在 inbox 卡片，且不会触发真实远端 GitHub 变更。
- 测试步骤:
  1. 打开 `/inbox`。
  2. 对本地安全的卡片执行 `Approve`、`Defer` 或 `Resolve`。
  3. 检查状态是否回写到相关对象。
- 预期结果: Inbox 能完成本地决策闭环，并能跳回上下文。
- 业务结论: 需要下一轮安全自动化回放。

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
- 业务结论: 读取面已具备，但完整身份系统仍是 GAP。

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
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-02` `CHK-13`
- 前置条件: 存在完整 auth / invite / role management 实现。
- 测试步骤:
  1. 邀请成员加入 workspace。
  2. 走邮箱验证与登录。
  3. 调整角色并验证访问权限。
- 预期结果: 团队成员身份链路完整闭环。
- 业务结论: 当前仓库无可验收闭环，属于明确 GAP。

## TC-015 GitHub App 安装与 Webhook

- 业务目标: 确认 GitHub 授权和事件回流进入真实产品闭环。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-07` `CHK-13`
- 前置条件: 存在 GitHub App 安装流、webhook ingest 与签名校验。
- 测试步骤:
  1. 完成 GitHub App 安装。
  2. 触发 webhook 事件。
  3. 检查 state / inbox / room / PR 是否同步更新。
- 预期结果: GitHub 事件可以持续同步回 OpenShock。
- 业务结论: 当前仓库未完成，不应写成已做完。

## TC-016 真实远端 PR 创建、同步与合并

- 业务目标: 确认 PR 真相不止停留在本地状态对象。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-07`
- 前置条件: 存在真实远端仓库与安全测试环境。
- 测试步骤:
  1. 从 room 发起 PR。
  2. 观察远端 PR 是否创建。
  3. 执行 review / merge 并检查状态回流。
- 预期结果: PR 生命周期能在 OpenShock 与 GitHub 间双向同步。
- 业务结论: 当前不具备可安全验收的闭环。

## TC-017 浏览器 Push / 邮件通知

- 业务目标: 确认高时效事件能主动触达，而不是等人刷新页面。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-11`
- 前置条件: 存在通知发送器、模板与订阅模型。
- 测试步骤:
  1. 触发 blocked 或 approval 事件。
  2. 检查浏览器 Push 或邮件是否送达。
- 预期结果: 高优先级事件有可靠通知。
- 业务结论: 当前仍停留在对象与文档层。

## TC-018 Stop / Resume / Follow Thread

- 业务目标: 确认人类可以在执行中真正接管、暂停和恢复。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-01` `CHK-06` `CHK-09`
- 前置条件: 存在 stop / resume / follow-thread UI 与后端状态机。
- 测试步骤:
  1. 让一条 run 进入执行中。
  2. 执行暂停、恢复、接续线程。
  3. 检查 room、run、inbox 是否同步更新。
- 预期结果: 人类纠偏能力成为产品能力，而不是文案。
- 业务结论: 当前尚无完整闭环。

## TC-019 记忆注入与 Skill / Policy 提升

- 业务目标: 确认记忆不仅可写回，也能被检索、提升和治理。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-10`
- 前置条件: 存在 memory injection、promotion、review 机制。
- 测试步骤:
  1. 执行一条带记忆写回的任务。
  2. 在下一条任务中验证记忆注入。
  3. 将高价值经验提升为 skill 或 policy。
- 预期结果: 记忆形成可治理的增强循环。
- 业务结论: 当前只站住写回 scaffold。

## TC-020 多 Runtime 调度与 Failover

- 业务目标: 确认系统可以管理多个 runtime，而不是只有单机配对。
- 当前执行状态: Blocked
- 对应 Checklist: `CHK-12` `CHK-14`
- 前置条件: 存在多个活跃 runtime、scheduler 与 selection 策略。
- 测试步骤:
  1. 注册多个 runtime。
  2. 创建 run 并观察调度决策。
  3. 模拟一个 runtime offline，检查 failover。
- 预期结果: 调度、离线态、切换都可见且可验证。
- 业务结论: 当前仅有 registry/pairing 基线，离完整调度还有距离。

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
- 业务结论: 服务器端 GitHub App PR contract 已落地，但浏览器级 onboarding 和实机回放还没补。

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
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-12` `CHK-13`
- 前置条件: 存在 admin / reviewer / viewer 三种角色。
- 测试步骤:
  1. 分别以三种角色访问关键写接口和对应前端入口。
  2. 检查允许、拒绝、禁用状态是否一致。
- 预期结果: 权限矩阵在 UI 和 API 两侧一致，不存在越权写入。
- 业务结论: 作为 `TKT-08/TKT-09` 的 gate，当前还未执行。

## TC-025 GitHub Webhook Replay / Review Sync

- 业务目标: 确认 webhook 事件可以把 review / comment / merge 状态同步回 OpenShock。
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-07`
- 前置条件: 存在 webhook fixture 或可控 replay 环境。
- 测试步骤:
  1. 回放 pull request、review、comment、merge 事件。
  2. 检查 state / inbox / room / pull request 是否更新。
- 预期结果: webhook 事件被规范化、验签、写回，且失败态可见。
- 业务结论: 作为 `TKT-05/TKT-06` 的 gate，当前还未执行实机验证。

## TC-026 Headed Setup 到 PR Journey

- 业务目标: 在非无头浏览器里串起 Setup 主链、Issue lane 和 PR 前置链。
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-04` `CHK-05` `CHK-07` `CHK-15`
- 前置条件: headed browser automation harness 已存在，server / daemon / web 可启动。
- 测试步骤:
  1. 打开 `/setup`，完成 repo binding、GitHub readiness、runtime pairing、bridge prompt。
  2. 创建一条 issue，进入 room / run。
  3. 验证 PR 入口处于可继续推进状态。
- 预期结果: Setup 到执行 lane 的用户旅程可稳定自动化回放。
- 业务结论: 作为 `TKT-03/TKT-04/TKT-06` 的总链路 gate，当前还未实现。

## TC-027 Sandbox / Destructive Approval Guard

- 业务目标: 确认 destructive git、越界写入、敏感凭证使用会进入审批保护，而不是默认执行。
- 当前执行状态: Not Run
- 对应 Checklist: `CHK-12`
- 前置条件: 存在 sandbox mode 与 approval-required contract。
- 测试步骤:
  1. 触发 destructive git 或越界写入动作。
  2. 检查系统是否拦截并生成 approval item。
- 预期结果: 高风险动作不会直接执行，系统产生显式审批记录。
- 业务结论: 作为 `TKT-09/TKT-15` 的安全 gate，当前还未建立。

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
- 当前执行状态: Fail
- 对应 Checklist: `CHK-04` `CHK-14`
- 前置条件: server 和 daemon 使用非默认端口启动，且工作区已有 pairing 历史。
- 测试步骤:
  1. 启动 server 与 daemon。
  2. 读取 `GET /v1/runtime/pairing`。
  3. 直接调用 `POST /v1/exec` 验证 bridge。
- 预期结果: pairing URL 与活跃 daemon 一致，bridge 首次即可成功。
- 业务结论: 当前不能通过验收。已观察到 pairing 返回 `127.0.0.1:8090`，而真实 daemon 在 `127.0.0.1:18090`，导致 bridge 首次 502。

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
- 当前执行状态: Fail
- 对应 Checklist: `CHK-15`
- 前置条件: `ops:smoke` 与真实 daemon 运行在非默认端口。
- 测试步骤:
  1. 执行 `pnpm ops:smoke`。
  2. 对比 pairing URL 与 runtime registry/实际 bridge 结果。
- 预期结果: smoke 失败并指出 pairing 漂移。
- 业务结论: 当前 smoke 只检查字段存在，不检查 URL 真值，属于 false-green。

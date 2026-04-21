# OpenShock Phase 0 MVP

**版本:** 0.92
**版本日期:** 2026 年 4 月 22 日
**关联文档:** [PRD](./PRD.md) · [Product Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、文档目标

这份文档只锁 3 件事：

1. 当前仓库里的 Phase 0 已经有哪些骨架
2. 第一轮执行票应该围绕哪些真实能力推进
3. Review / Merge 前最低要过哪些验收门

它是完整 PRD 的当前实现切片，不负责替代完整产品基线。

---

## 二、Phase 0 当前仓库真值

### 1. 已有骨架

当前仓库已经有：

- Next.js 前端壳
- 统一的 workspace shell，`chat / rooms / board / inbox / issues / runs / agents / mailbox / memory / onboarding / access / setup / settings` 不再各走各的导航
- 当前前台主路由已经覆盖：
  - `chat / rooms / issues / topics / runs / pull-requests / mailbox / profiles / onboarding`
  - canonical profile route 以 `/profiles/[kind]/[profileId]` 为准；历史 `/agents/[id]` 只保留兼容跳转
- Go server 控制面
- Go daemon 本地 runtime bridge
- 文件状态存储
- 基础 worktree lane 创建
- issue -> room -> run -> session 的对象主链
- room message 同步 / 流式执行桥
- channel / room message-centric thread rail
- repo binding / GitHub readiness / runtime pairing 控制面
- 同源 `/api/control/*` proxy，Windows 有头浏览器下也能稳定读到 live control truth
- PR 状态对象和 Inbox 卡片
- `gh CLI / GitHub App` 双 auth path 的 PR contract
- auth session / workspace members / recovery 基线
- direct message、message-surface collections、topic guidance 与 mailbox handoff contract
- planner queue / session assignment / PR auto-merge guard contract
- 文件级记忆与 version/governance contract
- daemon per-session workspace envelope：`MEMORY.md / SESSION.json / CURRENT_TURN.md / notes/work-log.md`
- session-scoped `OPENSHOCK_CODEX_HOME` continuity
- provider thread state 持久化到 `SESSION.json.appServerThreadId`
- memory center provider orchestration + health/recovery truth：`workspace-file / search-sidecar / external-persistent`
- memory center policy / cleanup / provider / promotion 路由
- 版本化 `/v1/control-plane/*` command / event / debug read-model
- `/v1/runtime/publish*` replay evidence contract

### 2. 当前还不是 Phase 0 真值的部分

- 数据库驱动的控制面真相
- 外部插件注册表与插件数据面
- 生产级通知与更完整外部身份体系
- GitHub App / webhook / remote PR 的更重生产闭环与真实 Internet / DNS / TLS 环境演练
- 真实 remote external durable memory adapter
- 更深的多 Agent 自治编排、agent-to-agent 通信与长期治理
- 更完整的 onboarding 场景包、机器初始化与团队模板运营

所以当前 Phase 0 应该被读成：

**“本地可运行控制基线”，不是“完整协作 SaaS”。**

---

## 三、Phase 0 一句话定义

在一个真实本地仓库里，把：

- chat-first 协作壳
- issue / room / run / session 控制面
- 本地 runtime pairing
- CLI 执行桥
- worktree lane
- 基础记忆 scaffold
- PR / Inbox 收口面

串成一条能实际运行、能被验证、能继续迭代的主链。

---

## 四、第一轮必须成立的能力

### 1. 协作壳入口成立

用户必须能看到：

- 频道
- 讨论间
- Board
- Inbox
- Mailbox
- Issue 列表
- Run 列表
- Agent 列表
- Profile drill-in
- Onboarding / Access 首启链路
- Setup
- Settings

### 2. Setup 脊柱成立

Setup 页必须能明确展示：

- repo 当前绑定状态
- GitHub readiness probe 结果
- runtime pairing 状态
- live bridge 执行入口

### 3. Issue lane 主链成立

创建 issue 后，系统必须能继续落出：

- issue
- room
- run
- session
- branch / worktree 命名
- daemon worktree ensure

### 4. Run 真相可见

Run Detail 至少要能显示：

- status
- runtime / machine / provider
- branch / worktree / path
- stdout / stderr
- tool calls
- timeline
- next action
- PR 关联

### 5. 人类决策面成立

Inbox 必须能把：

- blocked
- approval
- review
- status

统一收成高信号卡片，并能跳回 room / run。

### 6. 文件级记忆不再是口号

工作区至少要能维护：

- `MEMORY.md`
- `notes/work-log.md`
- `notes/rooms/*.md`
- `decisions/*.md`
- `.openshock/agents/*`

---

## 五、第一轮执行票应该围绕什么拆

### 1. Web 壳层票

优先围绕：

- Chat / Room / Board / Inbox / Run Detail 的信息层级
- Setup 页的真实链路感
- Machine / Agent / Run presence 的稳定可见性

### 2. Server 控制面票

优先围绕：

- `v1/state` 和各对象路由的真值一致性
- issue 创建后的 room / run / session / worktree lane 收口
- PR / Inbox / Session / Memory 这些对象的状态一致性

### 3. Daemon / Runtime 票

优先围绕：

- CLI 探测
- exec / exec stream 稳定性
- worktree ensure
- runtime heartbeat 真值
- same-session continuity、thread-state persistence 与 restart recovery

### 4. Docs 票

优先围绕：

- README
- docs index
- PRD
- Phase 0 MVP
- Runbook

确保文档写的是“当前仓库真值”，不是“未来想法”。

---

## 六、Phase 0 验收门

### Gate 1: 启动门

至少要能实际启动：

- web
- server
- daemon

### Gate 2: 接口门

至少要能实际打通：

- `GET /healthz`
- `GET /v1/state`
- `GET /v1/state/stream`
- `GET /v1/experience-metrics`
- `GET /v1/runtime`
- `GET /v1/runtime/registry`
- `GET /v1/runtime/live-service`
- `GET /v1/repo/binding`
- `GET /v1/github/connection`
- `GET /v1/auth/session`
- `GET /v1/workspace/members`
- `GET /v1/mailbox`
- `GET /v1/memory-center`
- `GET /v1/notifications`
- `GET /v1/credentials`
- `GET /v1/planner/queue`
- `POST /v1/runs/:id/control`
- `POST /v1/runtime/pairing`
- `POST /v1/control-plane/commands`
- `GET /v1/control-plane/events`
- `GET /v1/runtime/publish/replay`
- `POST /v1/issues`
- `POST /v1/exec`

### Gate 3: 壳层门

前台至少要能真实显示：

- workspace / repo / runtime 基线
- issue / room / run / agent / inbox
- setup 链路状态

### Gate 4: 文档门

至少这 5 份文档必须和当前仓库真值一致：

- `README.md`
- `docs/README.md`
- `docs/product/PRD.md`
- `docs/product/Phase0-MVP.md`
- `docs/engineering/Runbook.md`

---

## 七、Review / Merge 节奏

### 1. 每张票的最小收口顺序

1. owner 自测
2. reviewer 只报 blocker / no-blocker
3. scope 内 blocker 修掉后复核
4. 证据够了就收口，不把票长期挂在 review

### 2. Phase 0 合并前最小证据

至少应附：

- 改动范围
- 影响的页面 / 路由 / 接口
- 实际跑过的命令
- blocker 是否已清

### 3. 不允许的收口方式

- 把“产品目标”当“当前仓库真值”
- 把未落地的 GitHub / auth / notification 能力写成已完成
- reviewer 已无 blocker 但票长期不点状态

---

## 八、当前明确不在 Phase 0 首轮强推范围里

- 邮件系统
- GitHub App 全链路
- 真正的多用户协作 SaaS
- 复杂 memory OS
- 全自动多 Agent orchestrator
- 云端沙盒

这些可以进入后续 phase，但不该混进当前第一轮交付口径。

<div align="center">

# OPENSHOCK.AI

<p>
  <img src="./docs/assets/openshock-hero.png" alt="OpenShock hero banner" width="100%" />
</p>

<p>
  <a href="https://github.com/Larkspur-Wang/OpenShock"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Larkspur-Wang/OpenShock?style=for-the-badge&logo=github&label=stars&color=00f5a0" /></a>
  <a href="https://github.com/Larkspur-Wang/OpenShock/forks"><img alt="GitHub forks" src="https://img.shields.io/github/forks/Larkspur-Wang/OpenShock?style=for-the-badge&logo=github&label=forks&color=13c2ff" /></a>
  <a href="https://github.com/Larkspur-Wang/OpenShock/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/Larkspur-Wang/OpenShock?style=for-the-badge&logo=github&label=issues&color=ff5c8a" /></a>
  <a href="https://github.com/Larkspur-Wang/OpenShock/commits/main"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/Larkspur-Wang/OpenShock?style=for-the-badge&logo=github&label=last%20commit&color=facc15" /></a>
</p>

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/web-next.js%2016-111111?style=for-the-badge&logo=nextdotjs" />
  <img alt="Go" src="https://img.shields.io/badge/server-go-111111?style=for-the-badge&logo=go" />
  <img alt="Go" src="https://img.shields.io/badge/daemon-go-111111?style=for-the-badge&logo=go" />
  <img alt="Status" src="https://img.shields.io/badge/status-phase%200%20baseline-00f5a0?style=for-the-badge" />
</p>

<p><strong>Slock 的壳，Multica 的骨，Lody 的 worktree 隔离。</strong></p>
<p><strong>Agent-first collaboration OS for local-first AI software teams.</strong></p>

</div>

## OpenShock 是什么

OpenShock 不是“聊天框 + 看板”的拼接物。

它当前在这个仓库里的定义是：

- `apps/web` 提供一个 chat-first 的协作壳
- `apps/server` 提供 Go 写的 Phase 0 控制面 API
- `apps/daemon` 提供 Go 写的本地 runtime bridge、CLI 执行和 worktree lane 能力

当前仓库已经不是纯静态设计稿。它已经具备一条可跑通的 Phase 0 基线：

- web 壳已经把 `Chat / Inbox / Board / Setup / Issues / Runs / Agents / Memory / Access / Settings` 收进同一套 workspace shell
- `Chat / Work` 切换、同源 `/api/control/*` proxy、message-centric thread rail 和 room/run/inbox 控制面已经站住
- server 有文件持久化状态、Issue 创建、Room/Run/Session 读取、PR 状态回写、runtime pairing、repo binding、GitHub readiness probe，以及 `gh CLI / GitHub App` 双 auth path 的 PR contract
- daemon 可以探测本地 `codex` / `claude`，支持同步执行、流式执行，以及 `git worktree` lane 创建
- 当前 `main` 也已经收住了 approval center、notification delivery、memory governance、stop/resume/follow-thread 和 multi-runtime scheduler / failover 的第一轮闭环

## 当前仓库真值

### 已经落地的能力

- Web 主壳：
  - `/chat/[channelId]`
  - `/board`
  - `/inbox`
  - `/issues`、`/issues/[issueKey]`
  - `/rooms/[roomId]`、`/rooms/[roomId]/runs/[runId]`
  - `/agents`、`/agents/[agentId]`
  - `/setup`
  - `/memory`
  - `/access`
  - `/settings`
- Setup 脊柱：
  - repo binding
  - GitHub connection probe
  - effective auth path / installation state
  - runtime pairing
  - live bridge console
- Server 控制面：
  - `GET /healthz`
  - `GET /v1/state`
  - `GET /v1/workspace`
  - `GET /v1/channels`
  - `GET/POST /v1/issues`
  - `GET /v1/rooms`、`GET /v1/rooms/:id`
  - `POST /v1/rooms/:id/messages`
  - `POST /v1/rooms/:id/messages/stream`
  - `GET /v1/runs`、`GET /v1/runs/:id`
  - `GET /v1/agents`
  - `GET /v1/sessions`、`GET /v1/sessions/:id`
  - `GET /v1/inbox`
  - `GET /v1/memory`
  - `GET /v1/pull-requests`
  - `GET/POST /v1/pull-requests/:id`
  - `GET/POST/DELETE /v1/runtime/pairing`
  - `GET /v1/runtime`
  - `GET/POST /v1/repo/binding`
  - `GET /v1/github/connection`
  - `POST /v1/exec`
  - 配置完 GitHub App 后走 app-backed PR create / sync / merge contract
- Daemon 本地能力：
  - `GET /healthz`
  - `GET /v1/runtime`
  - `POST /v1/worktrees/ensure`
  - `POST /v1/exec`
  - `POST /v1/exec/stream`
- 状态与文件写回：
  - server 默认把 Phase 0 状态落到 `data/phase0/state.json`
  - issue 创建时会生成 room、run、session，并尝试创建对应 worktree lane
  - 工作区会生成 `MEMORY.md`、`notes/`、`decisions/`、`.openshock/agents/...`
  - memory artifact 已有 version / governance / detail contract

### 还没有做成“完整产品闭环”的部分

- `app.slock.ai` 式真实 quick search / search result、DM、saved / later、profile / presence surface
- Room workbench tabs、Topic / PR / Context 同房间切换
- Agent prompt / avatar / memory binding / provider-model 偏好的正式 profile editor
- Runtime / Machine profile、本地 CLI / model capability 绑定
- 场景化 onboarding：开发团队 / 研究团队 / 空白模板
- Agent Mailbox、多 Agent handoff、角色治理与 response aggregation
- user / workspace / agent / machine 配置持久化与数据库真相
- Board 次级化后的轻量 planning card 和 room / issue 回跳
- GitHub App installation-complete 后的 live callback / repo 持续同步
- 设备授权 / 完整邮箱验证 / 更完整外部身份绑定
- destructive action approval、secret boundary、越界写保护
- 多 Agent 调度 loop 与更重的长期自治 / 长期记忆整理

换句话说：现在已经是“可运行基线”，但还不是“完整产品闭环”。

## 文档链路

- 完整产品基线: [docs/product/PRD.md](./docs/product/PRD.md)
- 当前实现切片: [docs/product/Phase0-MVP.md](./docs/product/Phase0-MVP.md)
- 能力合同与 GAP: [docs/product/Checklist.md](./docs/product/Checklist.md)
- 未完成功能拆票: [docs/product/Execution-Tickets.md](./docs/product/Execution-Tickets.md)
- 全量测试用例: [docs/testing/Test-Cases.md](./docs/testing/Test-Cases.md)
- 测试报告索引: [docs/testing/README.md](./docs/testing/README.md)
- 最新壳层走查: [docs/testing/Test-Report-2026-04-08-work-shell-smoke.md](./docs/testing/Test-Report-2026-04-08-work-shell-smoke.md)

## 仓库结构

```text
.
├─ apps/
│  ├─ web/          # Next.js 16 + React 19 前端壳
│  ├─ server/       # Go 控制面 API + 文件状态存储
│  └─ daemon/       # Go 本地 runtime / exec / worktree bridge
├─ docs/
│  ├─ product/      # PRD、Phase 0 范围和产品约束
│  ├─ engineering/  # Runbook 和工程入口
│  ├─ design/       # 设计方向
│  ├─ research/     # 外部参考与调研记录
│  └─ assets/       # Hero、截图和其他资产
├─ DESIGN.md        # 设计约束
├─ SOUL.md          # Agent 根宣言
└─ README.md
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 web

```bash
pnpm dev
```

默认访问：

- `http://127.0.0.1:3000`

### 3. 启动 server

根 `package.json` 里的 `dev:server` / `dev:daemon` 现在已经是 Bash 入口，并会转到 `scripts/go.sh`。如果你当前就在 PowerShell 里直接启动，下面这条 Go 命令最稳。

```bash
cd apps/server
OPENSHOCK_WORKSPACE_ROOT=/home/lark/OpenShock go run ./cmd/openshock-server
```

PowerShell:

```powershell
cd apps/server
$env:OPENSHOCK_WORKSPACE_ROOT = "E:\00.Lark_Projects\00_OpenShock"
go run ./cmd/openshock-server
```

默认访问：

- `http://127.0.0.1:8080/healthz`

### 4. 启动 daemon

```bash
cd apps/daemon
go run ./cmd/openshock-daemon --workspace-root /home/lark/OpenShock
```

PowerShell:

```powershell
cd apps/daemon
go run ./cmd/openshock-daemon --workspace-root E:\00.Lark_Projects\00_OpenShock
```

默认访问：

- `http://127.0.0.1:8090/healthz`

### 5. 打开 Setup 页

进入：

- `http://127.0.0.1:3000/setup`

这是当前最接近“真实链路”的页面：repo、GitHub readiness、runtime pairing、bridge console 都在这里。

## 最小验证

先检查 web / server / daemon 三段是否在线：

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8090/healthz
curl http://127.0.0.1:8080/v1/state
```

再看 runtime 和 GitHub readiness：

```bash
curl http://127.0.0.1:8080/v1/runtime
curl http://127.0.0.1:8080/v1/runtime/pairing
curl http://127.0.0.1:8080/v1/repo/binding
curl http://127.0.0.1:8080/v1/github/connection
```

最后确认 bridge 能执行本地 CLI：

```bash
curl -X POST http://127.0.0.1:8080/v1/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "codex",
    "prompt": "Reply with exactly: OpenShock bridge online.",
    "cwd": "/home/lark/OpenShock"
  }'
```

如果你要验证 worktree lane，也可以直接创建一条 issue：

```bash
curl -X POST http://127.0.0.1:8080/v1/issues \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Probe issue creation",
    "summary": "Verify room/run/session/worktree provisioning.",
    "owner": "Codex Dockmaster",
    "priority": "high"
  }'
```

## 当前开发约束

- Phase 0 默认按本地优先推进，不假装已经有云端控制面
- `pnpm dev` 只启动 web，不会自动拉起 Go server / daemon
- server / daemon 的默认路径回退仍偏 Windows，本地开发时建议显式设置 `OPENSHOCK_WORKSPACE_ROOT`
- 文档里凡是写“已落地”，都应该以当前仓库代码、HTTP 路由和可运行入口为准，而不是以目标愿景为准

## 文档入口

- [Docs Index](./docs/README.md)
- [PRD](./docs/product/PRD.md)
- [Phase 0 MVP](./docs/product/Phase0-MVP.md)
- [Runbook](./docs/engineering/Runbook.md)
- [Design Notes](./docs/design/README.md)
- [Research Index](./docs/research/README.md)
- [SOUL.md](./SOUL.md)
- [DESIGN.md](./DESIGN.md)

## English

OpenShock is currently a Phase 0 local-first baseline:

- Next.js web shell
- Go control-plane server
- Go local daemon for CLI execution and worktree lanes

It already runs a real local stack, but it does not yet ship full auth, GitHub App flows, remote PR sync, or autonomous multi-agent orchestration. Use the docs above as the source of truth for what is live today.

<div align="center">

# OPENSHOCK.AI

<p>
  <img src="./docs/assets/openshock-hero.png" alt="OpenShock hero banner" width="100%" />
</p>

<p>
  <a href="https://github.com/Little-Shock/OpenShock"><img alt="GitHub stars" src="https://img.shields.io/github/stars/Little-Shock/OpenShock?style=for-the-badge&logo=github&label=stars&color=00f5a0" /></a>
  <a href="https://github.com/Little-Shock/OpenShock/forks"><img alt="GitHub forks" src="https://img.shields.io/github/forks/Little-Shock/OpenShock?style=for-the-badge&logo=github&label=forks&color=13c2ff" /></a>
  <a href="https://github.com/Little-Shock/OpenShock/issues"><img alt="GitHub issues" src="https://img.shields.io/github/issues/Little-Shock/OpenShock?style=for-the-badge&logo=github&label=issues&color=ff5c8a" /></a>
  <a href="https://github.com/Little-Shock/OpenShock/commits/main"><img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/Little-Shock/OpenShock?style=for-the-badge&logo=github&label=last%20commit&color=facc15" /></a>
</p>

<p>
  <img alt="Next.js" src="https://img.shields.io/badge/web-next.js%2016-111111?style=for-the-badge&logo=nextdotjs" />
  <img alt="Go" src="https://img.shields.io/badge/server-go-111111?style=for-the-badge&logo=go" />
  <img alt="Go" src="https://img.shields.io/badge/daemon-go-111111?style=for-the-badge&logo=go" />
  <img alt="Status" src="https://img.shields.io/badge/status-phase%200%20baseline-00f5a0?style=for-the-badge" />
</p>

<p><strong>把聊天、执行、交付和交接收进同一工作台。</strong></p>
<p><strong>A local-first workspace for AI software teams.</strong></p>

</div>

## OpenShock 是什么

OpenShock 是一个本地优先的协作工作台。

在这个仓库里，它由三层组成：

- `apps/web` 提供 chat-first 的协作壳
- `apps/server` 提供 Go 写的 Phase 0 控制面 API
- `apps/daemon` 提供 Go 写的本地 runtime bridge、CLI 执行和 worktree lane 能力

你现在可以直接把它当成一个本地优先的协作产品来用：

- 在同一套 workspace shell 里处理 `聊天 / 讨论间 / 收件箱 / 任务板 / 运行 / PR / 档案 / 设置`
- 用首启引导和 `/setup` 配好模板、仓库、GitHub、运行环境和默认智能体
- 在讨论间里把 `聊天 / 话题 / 运行 / PR / 上下文` 收在一个 workbench 里持续推进
- 用 Agent / Machine / Human 档案、Memory Center、通知和治理规则管理多人多智能体协作

当前仓库已经不是纯静态设计稿。它已经具备一条可跑通的 Phase 0 基线：

- web 壳已经把 `Chat / Inbox / Board / Setup / Issues / Runs / Agents / Memory / Access / Settings` 收进同一套 workspace shell
- `Chat / Work` 切换、同源 `/api/control/*` proxy、message-centric thread rail 和 room/run/inbox 控制面已经站住
- room-first `Chat / Topic / Run / PR / Context` workbench、DM、followed thread、saved later 和 quick search 都已经接上真实前台表面
- server 有文件持久化状态、Issue 创建、Room/Run/Session 读取、PR 状态回写、runtime pairing、repo binding、GitHub readiness probe，以及 `gh CLI / GitHub App` 双 auth path 的 PR contract
- server 已补齐版本化 `/v1/control-plane/*` command / event / debug read-model，以及 `/v1/runtime/publish*` replay evidence contract
- memory center 已把 `workspace-file / search-sidecar / external-persistent` provider binding、health/recovery timeline、next-run preview 和 degraded fallback 收进同一份可回放的工作区记忆基线
- daemon 可以探测本地 `codex` / `claude`，支持同步执行、流式执行，以及 `git worktree` lane 创建
- daemon 会为同一 session 复用本地规则栈：`SOUL.md / MEMORY.md / CURRENT_TURN.md / SESSION.json / notes/*`
- 当前 `main` 已经收住了 approval center、notification delivery、memory governance、stop/resume/follow-thread、agent mailbox / handoff、routing SLA / aggregation、profile editor、machine capability binding、workspace config，以及 multi-runtime scheduler / failover 的第一轮闭环

## 当前仓库真值

### 已经落地的能力

- Web 主壳：
  - `/chat/[channelId]`
  - `/rooms`
  - `/board`
  - `/inbox`
  - `/issues`、`/issues/[issueKey]`
  - `/rooms/[roomId]`、`/rooms/[roomId]/runs/[runId]`
  - `/topics/[topicId]`
  - `/agents`
  - `/profiles/[kind]/[profileId]`
  - `/pull-requests/[pullRequestId]`
  - `/mailbox`
  - `/onboarding`
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
  - `GET /v1/state/stream`
  - `GET /v1/experience-metrics`
  - `GET /v1/workspace`
  - `GET /v1/channels`
  - `GET/POST /v1/issues`
  - `GET /v1/rooms`、`GET /v1/rooms/:id`
  - `POST /v1/rooms/:id/messages`
  - `POST /v1/rooms/:id/messages/stream`
  - `GET /v1/runs`、`GET /v1/runs/:id`
  - `POST /v1/runs/:id/control`
  - `GET /v1/agents`
  - `GET /v1/sessions`、`GET /v1/sessions/:id`
  - `GET /v1/inbox`
  - `GET/POST /v1/mailbox`
  - `GET /v1/memory`
  - `GET /v1/memory-center`
  - `GET /v1/pull-requests`
  - `GET/POST /v1/pull-requests/:id`
  - `GET /v1/auth/session`
  - `GET/POST /v1/workspace/members`
  - `GET /v1/notifications`
  - `GET/POST /v1/credentials`
  - `GET /v1/planner/queue`
  - `POST /v1/control-plane/commands`
  - `GET /v1/control-plane/events`
  - `GET /v1/control-plane/debug/commands/:id`
  - `GET /v1/control-plane/debug/rejections`
  - `GET/POST/DELETE /v1/runtime/pairing`
  - `GET /v1/runtime`
  - `GET /v1/runtime/registry`
  - `GET/POST /v1/runtime/publish`
  - `GET /v1/runtime/publish/replay`
  - `GET /v1/runtime/live-service`
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
  - 工作区会生成 `MEMORY.md`、`notes/`、`decisions/`、`.openshock/agents/...`，下一次任务预览会带上 owner agent 的 `SOUL.md / MEMORY.md / notes/*`
  - memory artifact 已有 version / governance / detail contract
  - workspace config 已能把 onboarding / browser push / memory mode / sandbox baseline 写回同一份状态快照
  - profile / mailbox / runtime / approval 等前台都已经读同一份 live state，而不是各自维护一套本地假状态
  - `pnpm verify:web` 已自带 live truth hygiene gate；一旦投影数据不可信，前台会直接 fail-closed

### 插件状态

- 当前仓库还没有“插件中心 / 插件列表 / 插件注册表”这层产品真值
- 现在已经落地的是：
  - runtime provider catalog
  - agent provider/model/runtime affinity
  - 文件级记忆模式：`MEMORY.md / notes/ / decisions/`
- memory center provider orchestration 已落地 `workspace-file / search-sidecar / external-persistent` binding state；provider health/recovery 现已进入正式产品面，但真实 remote external adapter 和插件数据面仍未接上
- 如果你在设置页里看到“插件”相关表达，那是旧文案，不代表当前已经有可用插件数据面

### 还没有做成“完整产品闭环”的部分

- 外部插件注册表与可运营的插件数据面
- 数据库真相：当前主状态仍然以文件快照为主，不是 DB-backed control plane
- GitHub App / webhook / remote PR 的生产级稳态，还有更多真实环境异常要收
- 更完整的 workspace 组织模型、成员治理、邀请与权限运维
- onboarding 场景包、agent 预置团队模板、机器初始化和 CLI 安装助手仍需继续产品化
- 更深的 agent-to-agent 通信、可配置 team topology、记忆治理和长期自治
- Board 虽已降级为 planning mirror，但视觉密度和信息层级仍有继续收口空间

换句话说：现在已经是“可运行基线”，但还不是“完整产品闭环”。

## 文档链路

- 完整产品基线: [docs/product/PRD.md](./docs/product/PRD.md)
- 当前实现切片: [docs/product/Phase0-MVP.md](./docs/product/Phase0-MVP.md)
- 能力合同与 GAP: [docs/product/Checklist.md](./docs/product/Checklist.md)
- 未完成功能拆票: [docs/product/Execution-Tickets.md](./docs/product/Execution-Tickets.md)
- 全量测试用例: [docs/testing/Test-Cases.md](./docs/testing/Test-Cases.md)
- 测试报告索引: [docs/testing/README.md](./docs/testing/README.md)
- 当前验证入口与最新报告索引: [docs/testing/README.md](./docs/testing/README.md)

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

### 2. 推荐启动方式：fresh stack

如果你想最快看到一个干净、可验证、带首启引导的产品入口，优先用根脚本：

```bash
pnpm dev:fresh:start
pnpm dev:fresh:status
pnpm dev:fresh:stop
```

这条 managed path 会一次拉起 `web + server + daemon`，并打印：

- `Entry`
- `Access`
- `Onboarding`
- `Chat`
- `Setup`

默认会给你一份干净的工作区状态：

- 1 个空频道 `#all`
- 1 个可编辑的 `启动智能体`
- 没有旧的 room / issue / run / PR / inbox 历史

正常情况下你不需要先去 `/access` 或 `/setup` 兜圈子，跟着首启引导走完就行。要换工作区目录，可通过 `OPENSHOCK_FRESH_WORKSPACE_ROOT` 指定。

如果你在 Windows 上只想双击启动，也可以继续用：

- [START_OPENSHOCK.cmd](./START_OPENSHOCK.cmd)
- [STATUS_OPENSHOCK.cmd](./STATUS_OPENSHOCK.cmd)
- [STOP_OPENSHOCK.cmd](./STOP_OPENSHOCK.cmd)

### 3. 手动启动 web / server / daemon

如果你要单独调某一段，或者想接管已有 live stack，再退回手动 3 进程方式。

### 3.1 启动 web

```bash
pnpm dev
```

默认访问：

- `http://127.0.0.1:3000`

### 3.2 启动 server

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

### 3.3 启动 daemon

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

### 3.4 打开 Setup 页

进入：

- `http://127.0.0.1:3000/setup`

这是当前最接近“真实链路”的页面：repo、GitHub readiness、runtime pairing、bridge console 都在这里。

## 最短信任路径

根 README 只保留一条权威入口；更完整的说明分别在 [docs/testing/README.md](./docs/testing/README.md) 和 [docs/engineering/Release-Gate.md](./docs/engineering/Release-Gate.md)。

先过 repo gate：

```bash
pnpm verify:release
```

再过 live stack gate：

```bash
pnpm ops:smoke
```

如果这一拍要求 GitHub 也 ready，再补 strict gate：

```bash
OPENSHOCK_REQUIRE_GITHUB_READY=1 pnpm ops:smoke
```

最后补一条代表性的浏览器链路，确认前台主工作台没有漂：

```bash
OPENSHOCK_E2E_HEADLESS=1 pnpm test:headed-onboarding-studio
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
- [Testing Index](./docs/testing/README.md)
- [Design Notes](./docs/design/README.md)
- [Research Index](./docs/research/README.md)
- [SOUL.md](./SOUL.md)
- [DESIGN.md](./DESIGN.md)

## English

OpenShock is currently a local-first Phase 0 product baseline:

- Next.js web shell
- Go control-plane server
- Go local daemon for CLI execution and worktree lanes

It already ships a real local stack with onboarding, rooms, runs, profiles, memory, mailbox handoff, GitHub setup readiness, runtime pairing, and browser-verified PR / notification / governance loops. It is still not a hosted SaaS or production deployment system. Use the docs above as the source of truth for what is live today.

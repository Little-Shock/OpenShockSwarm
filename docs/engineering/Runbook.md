# Runbook

这份文档只回答一件事：**怎么把当前仓库里的 OpenShock Phase 0 基线在本地跑起来，并验证它不是空壳。**

---

## 1. 前置条件

- Node.js 20+
- `pnpm`
- 不要求系统预装 Go；根脚本会优先使用系统里可用的 Go 1.24.x，否则通过 `scripts/go.sh` 下载并使用 repo-local toolchain
- `git`
- 至少安装一个本地 CLI provider：
  - `codex`
  - 或 `claude`
- 一个可写的本地仓库路径，例如：
  - Linux/macOS: `/home/lark/OpenShock`
  - Windows: `E:\00.Lark_Projects\00_OpenShock`

---

## 2. 先知道这几个事实

- `pnpm dev` 只启动 web
- server 和 daemon 需要分别启动
- 根 `package.json` 里的 `dev:server` / `dev:daemon` 现在已经是 Bash 入口，并会转到 `scripts/go.sh`
- 跨平台最稳的方式是直接跑 Go 入口
- server 默认状态文件是：
  - `<OPENSHOCK_WORKSPACE_ROOT>/data/phase0/state.json`

---

## 3. 推荐环境变量

### Bash

```bash
export OPENSHOCK_WORKSPACE_ROOT=/home/lark/OpenShock
export OPENSHOCK_SERVER_ADDR=:8080
export OPENSHOCK_DAEMON_ADDR=:8090
export OPENSHOCK_DAEMON_URL=http://127.0.0.1:8090
export NEXT_PUBLIC_OPENSHOCK_API_BASE=http://127.0.0.1:8080
```

### PowerShell

```powershell
$env:OPENSHOCK_WORKSPACE_ROOT = "E:\00.Lark_Projects\00_OpenShock"
$env:OPENSHOCK_SERVER_ADDR = ":8080"
$env:OPENSHOCK_DAEMON_ADDR = ":8090"
$env:OPENSHOCK_DAEMON_URL = "http://127.0.0.1:8090"
$env:NEXT_PUBLIC_OPENSHOCK_API_BASE = "http://127.0.0.1:8080"
```

---

## 4. 启动 3 个进程

打开 3 个终端。

### Terminal 1: Web

```bash
pnpm dev
```

默认访问：

- `http://127.0.0.1:3000`

### Terminal 2: Server

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

### Terminal 3: Daemon

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

---

## 5. 当前可用入口

### Web 路由

- `/chat/all`
- `/board`
- `/inbox`
- `/issues`
- `/issues/[issueKey]`
- `/rooms/[roomId]`
- `/rooms/[roomId]/runs/[runId]`
- `/agents`
- `/agents/[agentId]`
- `/setup`
- `/settings`

### Server 路由

- `GET /healthz`
- `GET /v1/state`
- `GET /v1/workspace`
- `GET /v1/channels`
- `GET/POST /v1/issues`
- `GET /v1/rooms`
- `GET /v1/rooms/:id`
- `POST /v1/rooms/:id/messages`
- `POST /v1/rooms/:id/messages/stream`
- `GET /v1/runs`
- `GET /v1/runs/:id`
- `GET /v1/agents`
- `GET /v1/sessions`
- `GET /v1/sessions/:id`
- `GET /v1/inbox`
- `GET /v1/memory`
- `GET /v1/pull-requests`
- `GET/POST /v1/pull-requests/:id`
- `GET/POST/DELETE /v1/runtime/pairing`
- `GET /v1/runtime`
- `GET/POST /v1/repo/binding`
- `GET /v1/github/connection`
- `POST /v1/exec`

### Daemon 路由

- `GET /healthz`
- `GET /v1/runtime`
- `POST /v1/worktrees/ensure`
- `POST /v1/exec`
- `POST /v1/exec/stream`

---

## 6. 最小验收流程

### Step 1: 健康检查

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8090/healthz
```

期望：

- server 返回 `openshock-server`
- daemon 返回 `openshock-daemon`

### Step 2: 看当前状态基线

```bash
curl http://127.0.0.1:8080/v1/state
curl http://127.0.0.1:8080/v1/workspace
curl http://127.0.0.1:8080/v1/issues
```

期望：

- 能读到 seed state
- workspace 中带 repo、runtime pairing、memory mode 等字段

### Step 3: 看 runtime 与 GitHub readiness

```bash
curl http://127.0.0.1:8080/v1/runtime
curl http://127.0.0.1:8080/v1/runtime/pairing
curl http://127.0.0.1:8080/v1/repo/binding
curl http://127.0.0.1:8080/v1/github/connection
```

期望：

- runtime 能返回本地 CLI 探测结果
- repo binding 能反映当前 `origin`
- GitHub probe 能告诉你 `gh` 是否安装、是否已认证

### Step 4: 重新配对 runtime

```bash
curl -X POST http://127.0.0.1:8080/v1/runtime/pairing \
  -H 'Content-Type: application/json' \
  -d '{"daemonUrl":"http://127.0.0.1:8090"}'
```

期望：

- pairing 状态变成 `paired`
- workspace 中的 runtime 信息刷新

### Step 5: 走一次本地 CLI bridge

```bash
curl -X POST http://127.0.0.1:8080/v1/exec \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "codex",
    "prompt": "Reply with exactly: OpenShock bridge online.",
    "cwd": "/home/lark/OpenShock"
  }'
```

如果你在 Windows 下运行，把 `cwd` 改成你的本地仓库绝对路径。

期望：

- server 把请求转到 daemon
- daemon 调用本地 CLI
- 返回输出文本

### Step 6: 创建一条新的 issue lane

```bash
curl -X POST http://127.0.0.1:8080/v1/issues \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Probe issue lane",
    "summary": "Verify issue -> room -> run -> session -> worktree.",
    "owner": "Codex Dockmaster",
    "priority": "high"
  }'
```

期望：

- server 创建新 issue / room / run / session
- server 请求 daemon 创建 worktree lane
- `data/phase0/state.json` 更新

### Step 7: 在前台确认 Setup 和 Room/Run 页面

打开：

- `http://127.0.0.1:3000/setup`
- `http://127.0.0.1:3000/issues`
- `http://127.0.0.1:3000/rooms/<roomId>`
- `http://127.0.0.1:3000/rooms/<roomId>/runs/<runId>`

期望：

- Setup 上能看到 repo / GitHub / runtime / bridge 的状态
- 新 issue 能在 UI 里出现
- run detail 能看到 runtime、branch、worktree、stdout/stderr、timeline 等字段

---

## 7. 当前什么是“真”，什么还是“下一步”

### 现在是真的

- 三个进程可以本地跑起来
- server / daemon 的健康检查可打
- runtime pairing / repo binding / GitHub readiness 有真实接口
- issue 创建会推进到 room / run / session / worktree lane
- bridge 可以调用本地 CLI

### 现在还不是“真服务”

- 真实远端 PR 创建
- GitHub App
- 邮箱登录
- 多用户 workspace
- 完整审批中心
- 生产级通知

如果你跑通了上面的最小验收，应该把它读成：**Phase 0 基线成立**，不是“产品已经完整”。

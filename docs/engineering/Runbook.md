# Runbook

这份文档只回答一件事：**怎么把当前仓库里的 OpenShock Phase 0 基线在本地跑起来，并验证它不是空壳。**

---

## 1. 前置条件

- Node.js 20+
- `pnpm`
- 不要求系统预装 Go；根脚本会优先使用系统里可用的 Go 1.24.x，否则通过 `scripts/go.sh` 下载并使用 repo-local toolchain
- `git`
- `curl`
- 至少安装一个本地 CLI provider：
  - `codex`
  - 或 `claude`
- 一个可写的本地仓库路径，例如：
  - Linux/macOS: `/home/lark/OpenShock`
  - Windows: `E:\00.Lark_Projects\00_OpenShock`

---

## 2. 先知道这几个事实

- `pnpm dev:fresh:start` 是当前最省心的启动方式；它会一起拉起 `web + server + daemon`
- `pnpm dev:fresh:status` / `pnpm dev:fresh:stop` 是对应的状态和清理入口
- `pnpm dev` 只启动 web
- server 和 daemon 需要分别启动
- 根 `package.json` 里的 `dev:server` / `dev:daemon` 现在已经是 Bash 入口，并会转到 `scripts/go.sh`
- 如果你要接管 actual live `127.0.0.1:8080`，不要再只靠“哪个终端还开着”；统一改走 `pnpm ops:live-server:*`
- round-end release gate 现在统一走根脚本：
  - `pnpm verify:release`
  - `pnpm ops:smoke`
  - `pnpm ops:experience-metrics`
  - `pnpm verify:release:full`
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
export OPENSHOCK_SERVER_URL=http://127.0.0.1:8080
export OPENSHOCK_ACTUAL_LIVE_URL=http://127.0.0.1:8080
export NEXT_PUBLIC_OPENSHOCK_API_BASE=http://127.0.0.1:8080
export OPENSHOCK_LIVE_OWNER=@Max_开发
```

### PowerShell

```powershell
$env:OPENSHOCK_WORKSPACE_ROOT = "E:\00.Lark_Projects\00_OpenShock"
$env:OPENSHOCK_SERVER_ADDR = ":8080"
$env:OPENSHOCK_DAEMON_ADDR = ":8090"
$env:OPENSHOCK_DAEMON_URL = "http://127.0.0.1:8090"
$env:OPENSHOCK_SERVER_URL = "http://127.0.0.1:8080"
$env:OPENSHOCK_ACTUAL_LIVE_URL = "http://127.0.0.1:8080"
$env:NEXT_PUBLIC_OPENSHOCK_API_BASE = "http://127.0.0.1:8080"
$env:OPENSHOCK_LIVE_OWNER = "@Max_开发"
```

### Deploy / GitHub App 相关变量

- Server:
  - `OPENSHOCK_STATE_FILE`
  - `OPENSHOCK_GITHUB_WEBHOOK_SECRET`
  - `OPENSHOCK_GITHUB_APP_ID`
  - `OPENSHOCK_GITHUB_APP_SLUG`
  - `OPENSHOCK_GITHUB_APP_INSTALLATION_ID`
  - `OPENSHOCK_GITHUB_APP_PRIVATE_KEY` 或 `OPENSHOCK_GITHUB_APP_PRIVATE_KEY_PATH`
  - `OPENSHOCK_GITHUB_APP_INSTALL_URL`
    - Setup 会把这个 URL 暴露给 installation pending 的 onboarding / blocked contract
- Daemon:
  - `OPENSHOCK_CONTROL_URL`
  - `OPENSHOCK_DAEMON_ADVERTISE_URL`
  - `OPENSHOCK_DAEMON_HEARTBEAT_INTERVAL`
  - `OPENSHOCK_DAEMON_HEARTBEAT_TIMEOUT`
- Smoke / release gate:
  - `OPENSHOCK_SERVER_URL`
  - `OPENSHOCK_ACTUAL_LIVE_URL`
    - 如果你在隔离 dev server 上看 actual live parity，这格继续指向真正给客户试的 `:8080`
  - `OPENSHOCK_DAEMON_URL`
  - `OPENSHOCK_REQUIRE_GITHUB_READY=1` 会把 GitHub readiness 也收进 smoke gate

---

## 4. 启动方式

### 推荐：fresh stack

如果你是第一次本地验证，或者想要一份干净的新工作区，优先用：

```bash
pnpm dev:fresh:start
pnpm dev:fresh:status
pnpm dev:fresh:stop
```

这条 managed path 会：

- 自动找空闲端口拉起 `web / server / daemon`
- 打印 `Entry / Access / Onboarding / Chat / Setup` 入口
- 生成一份 fresh workspace state，方便首启和有头链路复核

如果你需要单独调试某一段，再退回下面的手动 3 进程方式。

### 手动：启动 3 个进程

打开 3 个终端。

如果你当前在 Linux/macOS 或已经有 Bash 入口，优先用 repo 根脚本启动：

```bash
pnpm dev
pnpm dev:server
pnpm dev:daemon
```

如果你在 PowerShell 或只想绕过 Bash wrapper，再退回下面的直接 Go 入口。

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

如果你不是只想临时前台起一个 server，而是要**接管 actual live `:8080`**，统一改用：

```bash
pnpm ops:live-server:start
pnpm ops:live-server:status
pnpm ops:live-server:reload
```

这条 managed path 会把 owner / pid / branch / head / reload command 写到：

- `<OPENSHOCK_WORKSPACE_ROOT>/data/ops/live-server.json`
- `<OPENSHOCK_WORKSPACE_ROOT>/data/logs/openshock-server.log`

`pnpm ops:live-server:status` 的读法有一条精度：

- 它会先读 actual live `GET /v1/runtime/live-service`
- 只有 live service 还没吸到这条 contract、或者 route 不可用时，才退回当前 `OPENSHOCK_WORKSPACE_ROOT` 的本地 metadata
- 所以你在另一份 checkout 里跑 `status`，也应该先看到 actual live owner / branch / head / metadataPath；不要再把“这个 checkout 本地没 metadata”误读成 live 一定是 unmanaged

如果 current `:8080` 已经在跑，但 `pnpm ops:live-server:status` 返回 `unmanaged_live_service`，说明服务活着但**没有可见的 owner/reload metadata**；这时不要盲目重启，先让当前 owner 显式接管这条 managed path。

如果 `status` 告诉你 actual live service 由**另一份 workspaceRoot** 控制：

- 先按返回体里的 `workspaceRoot` / `metadataPath` / `reloadCommand` 读真相
- 不要在当前 checkout 直接盲跑 `reload`
- 直接使用返回体里记录的 exact command，或者至少把 `--workspace-root` / `--server-url` 指到那份 owner workspace 再执行

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

- `/`
- `/chat/all`
- `/rooms`
- `/board`
- `/inbox`
- `/issues`
- `/issues/[issueKey]`
- `/rooms/[roomId]`
- `/rooms/[roomId]/runs/[runId]`
- `/topics/[topicId]`
- `/runs`
- `/runs/[runId]`
- `/agents`
- `/profiles/[kind]/[profileId]`
- `/pull-requests/[pullRequestId]`
- `/mailbox`
- `/onboarding`
- `/memory`
- `/access`
- `/setup`
- `/settings`

说明：

- `/agents/[agentId]` 现在只保留兼容跳转，canonical profile route 已统一到 `/profiles/[kind]/[profileId]`
- `/rooms` 现在是独立讨论间索引，不再只是 `/chat/all` 的跳转壳

### Server 路由

- `GET /healthz`
- `GET /v1/state`
- `GET /v1/experience-metrics`
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
- `GET/PATCH /v1/agents/:id`
- `GET /v1/sessions`
- `GET /v1/sessions/:id`
- `GET /v1/topics/:id`
- `PATCH /v1/topics/:id`
- `GET /v1/inbox`
- `GET/POST /v1/mailbox`
- `GET/POST /v1/mailbox/:id`
- `POST /v1/mailbox/governed`
- `GET /v1/memory`
- `GET /v1/memory/:id`
- `POST /v1/memory/:id/feedback`
- `POST /v1/memory/:id/forget`
- `GET /v1/memory-center`
- `POST /v1/memory-center/cleanup`
- `GET/POST /v1/memory-center/policy`
- `GET/POST /v1/memory-center/providers`
- `POST /v1/memory-center/promotions`
- `GET /v1/pull-requests`
- `GET/POST /v1/pull-requests/:id`
- `GET /v1/auth/session`
- `POST /v1/auth/session`
- `DELETE /v1/auth/session`
- `POST /v1/auth/recovery`
- `GET/POST /v1/workspace/members`
- `GET/PATCH /v1/workspace/members/:id`
- `GET /v1/direct-messages`
- `GET /v1/direct-messages/:id`
- `POST /v1/direct-messages/:id/messages`
- `POST /v1/message-surface/collections`
- `GET /v1/notifications`
- `GET /v1/approval-center`
- `GET/POST /v1/credentials`
- `GET /v1/planner/queue`
- `POST /v1/planner/sessions/:id/assignment`
- `GET/POST /v1/planner/pull-requests/:id/auto-merge`
- `POST /v1/control-plane/commands`
- `GET /v1/control-plane/events`
- `GET /v1/control-plane/debug/commands/:id`
- `GET /v1/control-plane/debug/rejections`
- `GET/POST/DELETE /v1/runtime/pairing`
- `GET /v1/runtime`
- `GET/POST /v1/runtime/publish`
- `GET /v1/runtime/publish/replay`
- `GET /v1/runtime/live-service`
- `GET /v1/workspace/branch-head-truth`
- `GET /v1/workspace/live-rollout-parity`
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

### Step 2.5: 看当前产品 / 体验 / 设计指标快照

```bash
curl http://127.0.0.1:8080/v1/experience-metrics
pnpm ops:experience-metrics
```

期望：

- 能读到 `product / experience / design` 三个 section
- 每个 metric 都有 `status / value / target / summary`
- round-end / nightly 不必再只靠零散测试报告拼 customer evidence

### Step 3: 看 runtime 与 GitHub readiness

```bash
curl http://127.0.0.1:8080/v1/runtime
curl http://127.0.0.1:8080/v1/runtime/pairing
curl http://127.0.0.1:8080/v1/runtime/live-service
curl http://127.0.0.1:8080/v1/workspace/branch-head-truth
curl http://127.0.0.1:8080/v1/workspace/live-rollout-parity
curl http://127.0.0.1:8080/v1/repo/binding
curl http://127.0.0.1:8080/v1/github/connection
```

期望：

- runtime 能返回本地 CLI 探测结果
- repo binding 能反映当前 `origin`
- GitHub probe 能告诉你 `gh` 是否安装、是否已认证
- `live-service` 能告诉你 actual `:8080` 是不是 managed、owner 是谁、该用哪条 reload command
- `branch-head-truth` 会把 `repo binding / GitHub probe / current checkout / live service / linked worktrees` 明确并排；如果 branch/head 不一致，先按它的 drift summary 收单值
- `live-rollout-parity` 会直接告诉你 actual `:8080` 有没有吸到 `/v1/runtime/live-service`、`/v1/experience-metrics`，以及 first-screen / branch 是否还和 current workspace 打架
- `pnpm ops:live-server:status` 应该和上面的 route truth 对齐；如果 route 已经有 truth，但 `status` 没对齐，先按 route 收单值

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

- `http://127.0.0.1:3000/onboarding`
- `http://127.0.0.1:3000/setup`
- `http://127.0.0.1:3000/issues`
- `http://127.0.0.1:3000/rooms`
- `http://127.0.0.1:3000/rooms/<roomId>`
- `http://127.0.0.1:3000/rooms/<roomId>/runs/<runId>`
- `http://127.0.0.1:3000/mailbox`

期望：

- onboarding 能先回答“现在先做什么”，而不是先暴露内部术语
- Setup 上能看到 repo / GitHub / runtime / bridge 的状态
- `/rooms` 能作为独立讨论间索引打开
- 新 issue 能在 UI 里出现
- run detail 能看到 runtime、branch、worktree、stdout/stderr、timeline 等字段

---

## 7. 当前什么是“真”，什么还是“下一步”

### Deploy / Observability / Release Gate

当前推荐把 round-end 验证分成两层：

- `pnpm verify:release`
  - repo 级 release gate
  - 统一跑 `pnpm verify`
  - 再额外验证 daemon heartbeat snapshot 和 runbook 入口
- `pnpm ops:smoke`
  - `pnpm ops:experience-metrics`
  - 对已经启动的 server / daemon 打 live HTTP smoke
  - 默认检查：
    - `GET /healthz`
    - `GET /v1/state`
    - `GET /v1/runtime/registry`
    - `GET /v1/runtime/pairing`
    - `GET /v1/runtime`
    - `GET /v1/repo/binding`
    - `GET /v1/github/connection`
    - daemon `GET /v1/runtime`
  - 关键真值：
    - `pairing.daemonUrl`
    - registry 中 `pairedRuntime` 对应 runtime 的 `daemonUrl`
    - server `GET /v1/runtime` 返回的 `daemonUrl`
    - daemon `GET /v1/runtime` 的 advertise URL
  - 任一 URL 不一致时，smoke 直接失败并指出 mismatch surface
  - `pnpm ops:experience-metrics`
    - 对已经启动的 server 拉一份 derived metrics snapshot
    - 统一回答 onboarding completion、handoff ack、memory provenance、design visibility 是否前滚
    - historical rate 还缺 durable event rollup 的项会显式标成 `partial`
- `pnpm verify:release:full`
  - 先跑 repo gate，再跑 live stack smoke

### 当前观测面

| Surface | 入口 | 用来判断什么 |
| --- | --- | --- |
| server liveness | `GET /healthz` | server 进程是否存活 |
| daemon liveness | `GET /healthz` | daemon 进程是否存活 |
| control-plane truth | `GET /v1/state` | workspace / issue / room / run / inbox 是否还可读 |
| runtime registry | `GET /v1/runtime/registry` | runtime heartbeat / lease 面有没有继续写回 |
| runtime pairing | `GET /v1/runtime/pairing` + `GET /v1/runtime` + daemon `GET /v1/runtime` | server pairing URL、runtime registry 和 live daemon truth 是否一致 |
| repo binding | `GET /v1/repo/binding` | repo / branch / auth mode / preferred auth mode / missing fields / app install truth |
| GitHub connection | `GET /v1/github/connection` | GitHub App 或 gh auth readiness、installation URL、missing fields |
| daemon snapshot | `GET /v1/runtime` 或 `go run ./cmd/openshock-daemon -once` | 本机 provider 探测和 heartbeat payload |

### 当前最小 rollback

1. 记录失败的是 repo gate 还是 live smoke gate。
2. 回到上一拍可用 ref 或 dev 分支已知绿点。
3. 重新启动 `web / server / daemon`。
4. 先跑 `pnpm verify:release`，再跑 `pnpm ops:smoke`。
5. 只有 repo gate 和 smoke gate 都转绿，才继续收票或发布下一拍。

### 现在是真的

- 三个进程可以本地跑起来
- server / daemon 的健康检查可打
- runtime pairing / repo binding / GitHub readiness 有真实接口
- issue / room / run / session / worktree lane 主链已站住
- memory 读取面与 version/governance 基线已站住
- auth session / workspace members 基础读取面已站住
- state SSE 初始快照已站住
- issue 创建会推进到 room / run / session / worktree lane
- bridge 可以调用本地 CLI

### 现在还不是“真服务”

- 生产级 realtime subscription / presence / event stream
- fully managed deploy target / rollout automation
- 更长周期的自治 orchestration / next-wave infra

如果你跑通了上面的最小验收，应该把它读成：**Phase 0 基线成立**，不是“产品已经完整”。

# Observability

这份文档只回答一件事：**当前 OpenShock repo 里有哪些 health / diagnostics / smoke 入口，出问题时先看哪里。**

---

## 1. 当前统一入口

### Repo-level

```bash
pnpm verify:release
```

用来确认：

- repo 级 build / test / lint / typecheck 仍然成立
- daemon heartbeat snapshot 还能吐出 runtime truth
- runbook / release 入口没有漂

### Live stack

```bash
pnpm ops:smoke
pnpm ops:live-server:status
```

用来确认：

- server / daemon 都活着
- control-plane truth 仍可读
- runtime / repo binding / GitHub connection 没断
- `GET /v1/workspace/branch-head-truth` 会把 repo binding、GitHub probe、current checkout、live service 和 linked worktrees 收成一份 drift summary
- `pnpm ops:live-server:status` 会先读 actual live `GET /v1/runtime/live-service`，只有 live route 不可用时才退回请求 workspace 的本地 metadata
- actual live `:8080` 有没有 managed owner / reload truth，以及 owner workspace 是哪一份 checkout

### Continuous product / experience snapshot

```bash
pnpm ops:experience-metrics
```

用来确认：

- `product / experience / design` 三组 metric 已从当前 truth 持续派生
- round-end / nightly probe 不必再只靠零散 headed report
- delivery entry / runbook / customer evidence 可以复用同一份 snapshot

### Strict GitHub-ready probe

```bash
OPENSHOCK_REQUIRE_GITHUB_READY=1 pnpm ops:smoke
```

用来确认：

- 当前环境如果要求 GitHub App readiness，就不能把 `"ready": false` 放过去

---

## 2. 观测面一览

| Surface | 入口 | Healthy marker | 用来判断什么 |
| --- | --- | --- | --- |
| server liveness | `GET /healthz` | `"service":"openshock-server"` | server 进程是否存活 |
| live service owner truth | `GET /v1/runtime/live-service` (canonical) + `pnpm ops:live-server:status` (CLI mirror/fallback) | `"managed": true` | actual `:8080` 由谁控制、当前跑哪颗 head、该走哪条 reload path |
| branch/head/worktree unification | `GET /v1/workspace/branch-head-truth` | `"status":"aligned"` | repo binding、GitHub probe、current checkout、live service、linked worktrees 是否还在同一份 branch/head 真值上 |
| daemon liveness | `GET /healthz` | `"service":"openshock-daemon"` | daemon 进程是否存活 |
| control-plane state | `GET /v1/state` | `"workspace"` | workspace / issue / room / run / inbox 是否还能读 |
| experience metrics snapshot | `GET /v1/experience-metrics` | `"sections"` | product / experience / design metric 是否已从当前 truth 连续派生 |
| runtime registry | `GET /v1/runtime/registry` | `"runtimes"` | heartbeat / lease truth 是否继续写回 |
| runtime pairing | `GET /v1/runtime/pairing` + `GET /v1/runtime` + daemon `GET /v1/runtime` | `"daemonUrl"` | server pairing URL、runtime registry 与 live daemon truth 是否一致 |
| repo binding | `GET /v1/repo/binding` | `"bindingStatus"` | repo / branch / auth mode / install truth |
| GitHub connection | `GET /v1/github/connection` | `"ready"` | GitHub App 或 gh auth readiness |
| daemon runtime snapshot | `GET /v1/runtime` | `"providers"` | daemon 当前看到的 provider / heartbeat truth |
| daemon one-shot snapshot | `go run ./cmd/openshock-daemon -once` | `"machine"` + `"providers"` | 不起 server 时也能读本机 runtime truth |

---

## 3. 当前最短排障顺序

### 症状 1: server 不通

先看：

1. `GET /healthz`
2. `GET /v1/runtime/live-service`
3. `GET /v1/workspace/branch-head-truth`
4. `pnpm ops:live-server:status`
5. server 进程 stdout/stderr
6. `OPENSHOCK_SERVER_ADDR`
7. `OPENSHOCK_STATE_FILE` / `OPENSHOCK_WORKSPACE_ROOT`

### 症状 2: daemon 不通

先看：

1. daemon `GET /healthz`
2. daemon 进程 stdout/stderr
3. `OPENSHOCK_DAEMON_ADDR`
4. `go run ./cmd/openshock-daemon -once`

### 症状 3: runtime / pairing 漂了

先看：

1. `GET /v1/runtime/registry`
2. `GET /v1/runtime/pairing`
3. daemon `GET /v1/runtime`
4. `OPENSHOCK_CONTROL_URL`
5. `OPENSHOCK_DAEMON_ADVERTISE_URL`
6. `OPENSHOCK_DAEMON_HEARTBEAT_INTERVAL`
7. `OPENSHOCK_DAEMON_HEARTBEAT_TIMEOUT`

### 症状 4: GitHub readiness 不对

先看：

1. `GET /v1/github/connection`
2. `OPENSHOCK_GITHUB_APP_ID`
3. `OPENSHOCK_GITHUB_APP_INSTALLATION_ID`
4. `OPENSHOCK_GITHUB_APP_PRIVATE_KEY` / `_PATH`
5. `OPENSHOCK_GITHUB_APP_INSTALL_URL`
6. `gh auth status --hostname github.com`

---

## 4. 当前 health-check package 怎么用

### 默认 smoke

```bash
pnpm ops:smoke
```

适合：

- round-end live sanity check
- 本地拉起 stack 后快速确认 control plane 没掉
- reviewer 在 live 环境里复核当前栈是否还通
- 想确认 pairing URL 没有只停留在“字段存在”，而是真正和 registry / live daemon 对齐

### strict smoke

```bash
OPENSHOCK_REQUIRE_GITHUB_READY=1 pnpm ops:smoke
```

适合：

- 当前发布要求 GitHub App readiness 成为硬前置
- 想确认 smoke 不会把 not-ready GitHub state 误判成通过

### one-shot diagnostics

```bash
cd apps/daemon
../../scripts/go.sh run ./cmd/openshock-daemon --workspace-root /abs/path -once
```

适合：

- daemon 没有长期跑起来
- 先看 provider / heartbeat payload
- 想区分是 daemon 自身问题，还是 server pairing 问题

### continuous metrics probe

```bash
pnpm ops:experience-metrics
```

适合：

- round-end / nightly 连续观测
- 想快速回答 onboarding / handoff / memory provenance / design visibility 有没有前滚
- 需要一份可直接贴进 reviewer packet / runbook / customer evidence 的统一摘要

---

## 5. 当前 incident package 最少收什么

如果 reviewer 或 owner 要贴最小 incident package，至少收：

1. 失败的 gate 命令
2. 失败 endpoint 的返回体
3. server / daemon 启动日志
4. 相关 env 入口
5. 如果是 runtime / GitHub 面：
   - `GET /v1/runtime/registry`
   - `GET /v1/runtime/pairing`
   - `GET /v1/runtime/live-service`
   - `GET /v1/runtime`
   - `GET /v1/github/connection`

---

## 6. 与其他票的边界

- 这份文档只负责 observability / health-check / diagnostics package
- 发布 gate 和 rollback contract 继续由 `Release-Gate.md` 收
- 不引入新的 realtime observability 面
- `/v1/experience-metrics` 只是一份 derived snapshot，不是新的 realtime stream
- 不回头重开 `#53-#63`

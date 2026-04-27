# Release Gate

这份文档只回答一件事：**当前 OpenShock 仓库怎么做发布前 gate，以及 gate 失败后怎么 rollback。**

如果你只想记一条入口，先看 [Testing Index](../testing/README.md) 顶部的“最短验证路径”；这里负责把那条路径展开成 release contract 和 rollback 规则。

---

## 1. 当前 deploy target 怎么读

当前 repo 里没有第二套云端部署系统，也没有额外的集群编排层。

这条线现在只认一个 target contract：

- web：`pnpm dev` / `pnpm build:web`
- server：`apps/server/cmd/openshock-server`
- daemon：`apps/daemon/cmd/openshock-daemon`
- state root：`OPENSHOCK_WORKSPACE_ROOT`
- server state file：`OPENSHOCK_STATE_FILE`

换句话说，当前 release target 读成：

- 一套 repo 内可验证的 web/server/daemon 三进程栈
- 一组 repo 内已有的验证入口
- 一条明确的失败即回退 contract

不要把这份文档读成 Kubernetes、Helm、Terraform 或外部 CI/CD 设计稿。

---

## 2. Release Gate 分两层

### Layer A: repo gate

命令：

```bash
pnpm verify:release
```

这层会做 3 件事：

1. 跑 `pnpm verify`
   - 其中 `pnpm verify:server` 现在已经包含 server core 包回归和一条 `server ↔ daemon` integration loop
2. 跑 daemon `-once` heartbeat snapshot
3. 检查 runbook 里 release / smoke 入口是否仍然可见

这层失败，说明当前 commit 连 repo 内 baseline 都没站住，不允许继续往 live stack 推。

### Layer B: live stack gate

命令：

```bash
pnpm ops:smoke
```

如果当前 live server / daemon 不在默认 `127.0.0.1:8080 / 127.0.0.1:8090`，必须显式传入真实地址：

```bash
OPENSHOCK_SERVER_URL=http://127.0.0.1:45068 \
OPENSHOCK_DAEMON_URL=http://127.0.0.1:45054 \
pnpm ops:smoke
```

这层要求 server / daemon 已启动，并会直接打当前 live stack：

- `GET /healthz`
- `GET /v1/state`
- `GET /v1/state/stream`
- `GET /v1/experience-metrics`
- `GET /v1/runtime/registry`
- `GET /v1/runtime/pairing`
- `GET /v1/runtime`
- `GET /v1/repo/binding`
- `GET /v1/github/connection`
- `GET /v1/workspace/branch-head-truth`
- `POST /v1/runs/__ops_smoke_missing_run__/control`
- daemon `GET /v1/runtime`

其中 runtime gate 现在按 fail-closed 读：

- `pairing.daemonUrl` 必须和 `OPENSHOCK_DAEMON_URL` 一致
- registry 里 `pairedRuntime` 对应 runtime 的 `daemonUrl` 必须一致
- server `GET /v1/runtime` 打到的 live daemon URL 也必须一致
- 任一 surface 漂移，`pnpm ops:smoke` 必须直接失败并指出 mismatch

run control gate 现在按 fail-closed 读：

- `pnpm ops:smoke` 会用一个不存在的 run ID 触发 `POST /v1/runs/:id/control`
- 正确结果必须是 `404` 和结构化 `run not found` 错误
- 这条默认不改 live run 状态，只证明发布栈已暴露控制路由且边界不会误写

如果你只想对当前 live stack 做 strict GitHub-ready + branch-head aligned smoke，可以直接跑：

```bash
pnpm ops:smoke:strict
```

### 一键全跑与 RC gate

```bash
pnpm verify:release:full
```

这条等价于：

1. 先过 repo gate
2. 再过 release browser suite：
   - setup spine e2e
   - onboarding first-start journey
   - fresh workspace critical loop
   - rooms continue entry
   - config persistence recovery
3. 再过 live stack gate

也就是说，`verify:release:full` 现在不再只是“静态 + smoke”，而是最短的非 strict 产品级发布前全跑入口。

GitHub-ready release candidates 用一条 first-class command：

```bash
pnpm verify:release:rc
```

这条会先跑 repo gate，再额外落一条可单独审阅日志的 `server ↔ daemon` integration loop，再顺序跑 5 条浏览器主链，最后再跑包含 strict GitHub-ready + actual-live-parity smoke 的 live stack gate：

- setup spine e2e
- onboarding first-start journey
- fresh workspace critical loop
- rooms continue entry
- config persistence recovery

这 5 条浏览器主链现在以 `scripts/release-browser-suite.sh` 为单一 manifest；release gate、Testing Index 和 reviewer 证据都必须跟这份 manifest 对齐。

也就是说，只要 `/v1/github/connection` 返回 `ready=false`、actual live ownership / rollout parity 漂了、integration loop 漂了、首启链路漂了、继续入口漂了，或者 durable config recovery 漂了，RC gate 就必须 fail-closed。

命令结束时，脚本还会直接打印一段 release summary，带出当前 `branch / head / server / daemon` 和 5 份 browser report / RC report 路径；如果之后还要重新定位同一批证据，统一用：

```bash
pnpm release:evidence:latest
pnpm release:evidence:latest rc
pnpm release:evidence:latest full
```

从这轮开始，`pnpm verify:release:rc` 还会自动：

- 写出 RC summary report
- 把 repo / integration / browser / strict stack 原始日志落到 `docs/testing/artifacts/<date>/release-candidate/`
- 在缺少 `OPENSHOCK_INTERNAL_WORKER_SECRET` 或 `OPENSHOCK_RUNTIME_HEARTBEAT_SECRET` 时直接 fail-closed，避免 notification worker 或 runtime heartbeat 配置缺口带着绿灯进入 RC

`pnpm verify:release:full` 现在也会自动：

- 写出 full gate summary report
- 把 repo / browser / live stack 原始日志落到 `docs/testing/artifacts/<date>/release-full/`
- 在 reviewer 视角提供和 RC 同级的可审计命令输出，不再只有终端滚动日志

注意：

- 以上命令会生成报告，但仓库中的 `docs/testing/Test-Report-*` 是归档集合，不保证等于最新一次运行产物。
- 需要确认“最新证据”时，以命令结束时打印的路径和 `pnpm release:evidence:latest` 为准。

---

## 3. 当前发布前最小清单

1. 确认当前分支和目标 ref 已同步到预期提交。
2. 跑 `pnpm verify:release`。
3. 启动 server / daemon。
4. 跑 `pnpm verify:release:full`。
5. 如果这一拍是 release candidate，跑 `pnpm verify:release:rc`。
6. 如果这一拍要放 RC，先确认 `OPENSHOCK_INTERNAL_WORKER_SECRET` 和 `OPENSHOCK_RUNTIME_HEARTBEAT_SECRET` 都已注入 server / daemon / gate 环境。
7. 只有 repo gate、server/daemon integration loop、5 条浏览器主链、live gate，以及 RC 所需的 strict GitHub-ready + actual-live-parity gate 都绿，才允许收票、merge 或继续发布动作。

---

## 4. Rollback Contract

当前 rollback 不引入新系统，只认 repo 内最短路径：

### Case A: repo gate 失败

- 不进入 live rollout
- 修复后重新跑 `pnpm verify:release`

### Case B: live smoke 失败

1. 记录失败命令和失败 endpoint
2. 回到上一拍已知绿色 ref / dev 分支提交
3. 重启 `web / server / daemon`
4. 重新跑：
   - `pnpm verify:release`
   - `pnpm ops:smoke`
5. 只有两层 gate 重新转绿，才允许继续

### Case C: strict GitHub-ready gate 失败

- 如果这一拍要求 GitHub App 就绪，这条失败直接算 release blocker
- 不允许把 `"ready": false` 当成可忽略 warning

---

## 5. Reviewer / Round-End 证据

当前这条线最少要贴 3 组证据：

1. `pnpm verify:release`
2. `pnpm ops:smoke`
3. 如果是 release candidate：
   - `pnpm verify:release:rc`
   - browser suite 5 份报告：
     - setup spine e2e
     - onboarding first-start journey
     - fresh workspace critical loop
     - rooms continue entry
     - config persistence recovery
   - 确认 RC 报告里 `Internal worker secret` 和 `Runtime heartbeat secret` 都是 `configured`

对抗性读法固定成：

- 默认 smoke 可以在 not-ready GitHub 环境下作为观测入口通过
- 默认 smoke 不允许把 runtime pairing drift 放过去
- daemon `/v1/runtime` 不允许省略自己的 advertise URL；缺失就直接 fail-closed
- strict smoke 必须 fail-closed，不能把 not-ready GitHub state 或 actual-live drift 放过去

---

## 6. 与其他票的边界

- 这份文档只负责 deploy target / release gate / rollback contract
- health-check surface、观测面和 runbook package 继续由 `Observability.md` 收
- 不回头混 `#64` 的 realtime / presence / event-stream
- 不额外引入新的 deploy system

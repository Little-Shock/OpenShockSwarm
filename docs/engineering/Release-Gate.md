# Release Gate

这份文档只回答一件事：**当前 OpenShock 仓库怎么做发布前 gate，以及 gate 失败后怎么 rollback。**

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
2. 跑 daemon `-once` heartbeat snapshot
3. 检查 runbook 里 release / smoke 入口是否仍然可见

这层失败，说明当前 commit 连 repo 内 baseline 都没站住，不允许继续往 live stack 推。

### Layer B: live stack gate

命令：

```bash
pnpm ops:smoke
```

这层要求 server / daemon 已启动，并会直接打当前 live stack：

- `GET /healthz`
- `GET /v1/state`
- `GET /v1/runtime/registry`
- `GET /v1/runtime/pairing`
- `GET /v1/repo/binding`
- `GET /v1/github/connection`
- daemon `GET /v1/runtime`

如果你希望把 GitHub readiness 也收成硬 gate，再加：

```bash
OPENSHOCK_REQUIRE_GITHUB_READY=1 pnpm ops:smoke
```

### 一键全跑

```bash
pnpm verify:release:full
```

这条等价于：

1. 先过 repo gate
2. 再过 live stack gate

---

## 3. 当前发布前最小清单

1. 确认当前分支和目标 ref 已同步到预期提交。
2. 跑 `pnpm verify:release`。
3. 启动 server / daemon。
4. 跑 `pnpm ops:smoke`。
5. 如果这一拍要求 GitHub App 也 ready，再补跑 strict smoke。
6. 只有 repo gate 和 live gate 都绿，才允许收票、merge 或继续发布动作。

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
3. 如果用 strict 模式：
   - `OPENSHOCK_REQUIRE_GITHUB_READY=1 pnpm ops:smoke`

对抗性读法固定成：

- 默认 smoke 可以在 not-ready GitHub 环境下作为观测入口通过
- strict smoke 必须 fail-closed，不能把 not-ready GitHub state 放过去

---

## 6. 与其他票的边界

- 这份文档只负责 deploy target / release gate / rollback contract
- health-check surface、观测面和 runbook package 继续由 `Observability.md` 收
- 不回头混 `#64` 的 realtime / presence / event-stream
- 不额外引入新的 deploy system

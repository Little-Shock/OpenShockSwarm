# Workspace 级 Repo 绑定 QA 回归报告

- 日期：2026-04-07
- 关联任务：
  - `#14` Workspace 级 Repo 绑定设计
  - `#15` Workspace 级 Repo 绑定实现
  - `#16` Workspace 级 Repo 绑定 QA 回归

## 1. 结论

本轮 `#16` 回归通过。

按当前冻结验收口径，三条闭环都已拿到真实证据：

1. 绑定入口已经只剩 workspace 真相
2. `run / merge / delivery` 已按 workspace repo 语义运行
3. 旧 `Issue.bind_repo` 已被明确拒绝

## 2. 测试环境

### 2.1 浏览器侧

- backend：`http://127.0.0.1:18083`
- frontend：`http://127.0.0.1:13003`
- 浏览器：Playwright
- 页面：`/rooms/room_101`

### 2.2 API 验证侧

- backend：`http://127.0.0.1:18085`
- 验证方式：真实启动服务后直接调用 `/api/v1/*`

说明：

- 浏览器部分用于验证产品入口和页面呈现是否已经切到 workspace 语义。
- API 部分用于验证无 default repo 失败语义、旧入口拒绝、以及 `run / merge / delivery` 的执行链路。

## 3. 浏览器级结果

### 3.1 绑定入口已切到 workspace

页面初始状态：

1. 右侧模块标题为 `Workspace Repo`
2. 状态显示 `required`
3. `Default Repo` 显示 `Not bound yet`
4. `当前 issue 生效仓库` 显示 `未配置 workspace default repo`

说明：

- 页面入口已经不是 issue 级 repo 绑定入口，而是 workspace 级 default repo 入口。
- 当前页面不再展示 `Bound Repos` 列表，非 default binding 视为内部实现细节。

### 3.2 通过页面完成 workspace 绑定

页面操作：

1. 在 `Workspace Repo` 输入框填入 `/Users/feifantong/code/OpenShockSwarm`
2. 点击 `Set Default Repo`

页面结果：

1. 状态从 `required` 变为 `default ready`
2. `Default Repo` 显示 `/Users/feifantong/code/OpenShockSwarm`
3. 页面出现反馈文案 `Workspace repo binding updated.`
4. `当前 issue 生效仓库` 同步显示 `/Users/feifantong/code/OpenShockSwarm`

结论：通过

## 4. API 回归结果

### 4.1 无 default repo 时的失败语义

初始状态：

- `workspace.repoBindings = []`

实际调用结果：

1. `Run.create(task_review)` 返回：
   - `{"error":"workspace 缺少默认 repo 绑定"}`
2. `GitIntegration.merge.approve(task_guard)` 返回：
   - `{"error":"workspace 缺少默认 repo 绑定"}`
3. `DeliveryPR.create.request(issue_101)` 返回：
   - `{"error":"workspace 缺少默认 repo 绑定"}`

结论：通过

说明：

- 这证明 run / merge / delivery 在无 default repo 时已经统一按 workspace 级失败语义拦截，不再走旧 issue 级口径。

### 4.2 旧 `Issue.bind_repo` 已被明确拒绝

实际调用：

- `Issue.bind_repo(issue_101, /tmp/repo-old)`

实际返回：

- `{"error":"Issue.bind_repo has been removed; use Workspace.bind_repo instead"}`

结论：通过

说明：

- 旧入口不再写入 workspace repo，也不再做兼容翻译。

### 4.3 `Workspace.bind_repo` 已成为唯一有效入口

实际调用：

- `Workspace.bind_repo(ws_01, /tmp/repo-A, makeDefault=true)`

实际结果：

1. 返回 `workspace_repo_bound`
2. `room detail` / `issue detail` 中都能看到：
   - `workspace.repoBindings` 出现 `/tmp/repo-A`
   - `workspace.defaultRepoBindingId` 指向该 binding
   - `issue.repoPath = "/tmp/repo-A"`

结论：通过

### 4.4 run 只从 workspace repo 解析，且快照稳定

步骤：

1. 先通过 `Workspace.bind_repo` 把 default repo 设为 `/tmp/repo-A`
2. 调用 `Run.create(task_review)`
3. 通过 `/api/v1/runs/claim` 领取队列 run
4. 再把 workspace default repo 切换到 `/tmp/repo-B`
5. 重新读取 `room detail`

关键结果：

1. `runs/claim` 返回的 run 带有：
   - `repoPath = "/tmp/repo-A"`
2. default 切到 `/tmp/repo-B` 后：
   - `workspace.defaultRepoBindingId` 已变为 repo B
   - `issue.repoPath = "/tmp/repo-B"`
   - 已存在的 `run_review_01` / `run_101` 仍保持 `repoPath = "/tmp/repo-A"`

结论：通过

说明：

- 这证明 run 的取仓来源已经是 workspace default repo。
- 同时 `Run.repoPath` 作为执行快照是稳定的，不会在 default repo 后续变化时被回写污染。

### 4.5 merge 只从 workspace repo 解析，且快照稳定

步骤：

1. default repo 为 `/tmp/repo-A` 时，调用：
   - `GitIntegration.merge.request(task_guard)`
   - `GitIntegration.merge.approve(task_guard)`
2. 此时生成 `merge_102`
3. 在 claim 之前，把 workspace default repo 切到 `/tmp/repo-B`
4. 通过 `/api/v1/merges/claim` 领取 `merge_102`
5. 再对 `task_review` 走同样流程，在 repo B 下生成并领取 `merge_103`

关键结果：

1. `merge_102` 被 claim 时仍是：
   - `repoPath = "/tmp/repo-A"`
2. `merge_103` 被 claim 时是：
   - `repoPath = "/tmp/repo-B"`

结论：通过

说明：

- 这证明 merge attempt 的取仓来源也已经统一收口到 workspace default repo。
- 同时 `MergeAttempt.repoPath` 作为执行快照是稳定的。

### 4.6 delivery 走通并受 workspace repo 前提约束

步骤：

1. 在无 default repo 时调用 `DeliveryPR.create.request(issue_101)`，确认失败
2. 绑定 workspace repo
3. 将剩余任务 merge 完成，使 integration branch 进入 `ready_for_delivery`
4. 再次调用 `DeliveryPR.create.request(issue_101)`

关键结果：

1. 无 default repo 时，delivery 明确报：
   - `workspace 缺少默认 repo 绑定`
2. 全部任务 merge 完成后，再次调用成功返回：
   - `delivery_pr_created`
3. 最终 `issue detail` 中：
   - `deliveryPr` 已创建
   - `issue.status = "in_review"`
   - `integrationBranch.status = "ready_for_delivery"`
   - workspace default repo 为 `/tmp/repo-B`

结论：通过

说明：

- 当前 `DeliveryPR` 模型本身不持久化 `repoPath` 快照，因此 delivery 的 repo 证据主要来自两点：
  1. 无 workspace default repo 时会被统一拦截
  2. 在 workspace default repo 存在且闭环条件满足后可成功创建 delivery PR

## 5. 最终判定

本轮 `#16` 可以按通过收口。

最终判定如下：

1. `Workspace.bind_repo` 已成为唯一有效绑定入口
2. 旧 `Issue.bind_repo` 已被明确拒绝
3. `run / merge / delivery` 已按 workspace repo 语义收口
4. `Run.repoPath / MergeAttempt.repoPath` 的执行快照稳定
5. 浏览器入口、后端执行链路、验收标准三者已经一致

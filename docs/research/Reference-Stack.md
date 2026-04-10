# OpenShock Reference Stack

## One Line

OpenShock 后续实现的默认参考顺序固定为：

**Slock 的壳，Multica 的骨，Lody 的隔离执行，本地 slock 的记忆与操作规范。**

## What We Can Copy

### 1. Slock

适合直接借鉴：

- 首页是协作壳，不是人类 PM 看板
- `channel / dm / thread / machine / agent / task` 这些对象同时出现在主界面
- 轻松但高密度的前端壳
- `Machine` 和 `Agent` 是主角，不是设置项
- 强实时事件和协作入口

公开实现信号：

- bundle 里能看到 `join:channel`、`followedThreads`、`resume-all-agents`、`machine:status`、`thread:updated`、`task:*`
- CSS 明确使用 `Space Grotesk`、`Space Mono`、`#FFD700`、`#ff6b9d`、`#a6ff00`、`#fff8e7`
- `btn-brutal`、`card-brutal`、2px 黑边和硬阴影是核心视觉原语

对 OpenShock 的要求：

- 前端默认维持 `频道 / 讨论间 / 收件箱 / 任务板`
- 页面尽量全视口铺开，减少居中大容器感
- Agent / Machine 状态固定常驻

### 2. Multica

适合直接借鉴：

- Agent 作为队友的控制面建模
- daemon + runtime + CLI discovery
- Issue / Inbox / Skill / Runtimes 这些后台骨架
- 浏览器登录、token、daemon 长连接与本地执行

本地 clone 里最值得抄的信号：

- `CLI_AND_DAEMON.md`
  - `multica login`
  - `multica daemon start`
  - 自动发现 `claude` / `codex`
  - 轮询、heartbeat、并发、workspace root、profile 等配置
- migration `020_task_session.up.sql`
  - `session_id + work_dir` 用于跨任务恢复同一执行连续体
- migration `029_daemon_token.up.sql`
  - `workspace_id + daemon_id + expires_at` 的 daemon token 模型
- migration `012_inbox_actor.up.sql`
  - Inbox 项显式记录 actor 身份

对 OpenShock 的要求：

- Go server / daemon 继续往 `workspace / runtime / issue / inbox / session continuity` 收口
- Inbox 不能只是 UI 卡片，必须有 actor、状态回写和可追溯来源

### 3. Lody

适合直接借鉴：

- 一个任务上下文对应一个独立执行 lane
- `worktree -> branch -> PR` 的交付对齐
- 上下文窗口、quota、usage 的可观测性

对 OpenShock 的要求：

- `Issue Room` 是前台工作空间
- `Topic` 是房间内局部话题
- `Session / Run` 是系统内部执行连续体
- `worktree` 继续作为隔离单元，不退回单工作目录串行执行

### 4. Local Slock

适合直接借鉴：

- 每个 agent 真正拥有自己的工作目录
- 不是只有聊天记录，而是 `MEMORY.md + notes/*`
- 频道规则、团队规则、技能标准都写成 agent 可读文件
- 任务协作通过清晰规则约束，而不是“凭感觉”

对 OpenShock 的要求：

- 每个 Agent 默认应有 `SOUL.md + MEMORY.md + notes/*`
- `notes/channels.md`、`notes/operating-rules.md`、`notes/skills.md` 这类结构值得保留
- 后续 Memory Center 和 Agent 配置页，要支持把这些文件级记忆显式展示出来

### 5. Historical Upstream Branches

适合作为内部知识来源：

- `eng01/pr1-head-regression-fix`
  - 最值得参考 `/v1`、command/event split、debug/replay/read-model
- `feat/initial-implementation`
  - 最值得参考 no-shadow-truth、staged backlog、release-gate/runbook discipline
- `eng01/batch6-83`
  - 最值得参考 runtime readiness、publish cursor、evidence packet
- `feat/tff`
  - 只参考局部组件拆分，不参考视觉和 repo 结构

对 OpenShock 的要求：

- Go server 的公开 contract 要继续向 versioned `/v1`、cursor replay、rejection explainability 收口
- shell 只能 fan-in stable truth，不能把 adapter 或局部 mock 长成第二套正式真相
- runtime replay / closeout / evidence packet 要能被外部 consumer 和 release gate 复核
- 前端允许借鉴 `tff` 的组件拆法，但视觉仍以 `app.slock.ai + 当前 OpenShock 字体/密度约束` 为准

## OpenShock Mapping

| OpenShock 层 | 主要参考 | 我们当前应该做什么 |
| --- | --- | --- |
| 前端壳层 | Slock + Stitch | 1:1 抠壳、中文化、全屏高密度 |
| 控制骨架 | Multica | 补强 `issue / inbox / runtime / daemon / session continuity` |
| 执行隔离 | Lody | 继续坚持 `topic/run/worktree/branch/pr` 闭环 |
| 记忆与规则 | Local Slock | 文件级记忆、频道规则、团队规则、技能规则 |
| API / 适配层纪律 | Historical Upstream Branches | 收紧 `/v1`、no-shadow-truth、runtime replay evidence |

## Mandatory Rule

只要改以下任一方向，就必须重新参考这里的材料：

- PRD / MVP
- 首页信息架构
- 频道 / 讨论间 / Inbox / Board
- daemon / runtime / CLI 接入
- worktree / session / run
- 记忆、技能、agent 规则
- `/v1` contract、shell adapter、runtime replay / evidence packet

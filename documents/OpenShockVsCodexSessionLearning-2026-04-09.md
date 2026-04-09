# OpenShock vs Codex Session Record

- 日期：2026-04-09
- 参考样本：
  - `/Users/feifantong/.codex/sessions/2026/04/04/rollout-2026-04-04T16-39-53-019d57a6-0bd4-7cf2-9c70-a8401a17ecc4.jsonl`

## 1. 结论

这份 Codex session 记录最值得学的，不是“把更多日志塞进时间线”，而是把一次 agent 工作拆成了几层彼此分离、可追溯、可恢复的数据：

1. session / turn 元信息
2. 对用户可见的 commentary / final answer
3. 结构化 tool call / tool result
4. 计划与状态迁移
5. token / context / runtime 统计

OpenShock 现在已经有一部分基础对象，但这些层还没有真正分开：

1. room timeline 仍然承担了过多“会话记录”职责
2. agent observability 更像房间内状态面板，不像完整 session viewer
3. run output / tool call 已有后端模型，但前端缺少一等展示
4. 没有 turn 级元信息、计划、成本、输入上下文快照

所以建议方向不是“模仿 Codex 的 UI 外观”，而是把 OpenShock 的 agent 执行记录升级成更明确的三层：

1. `room timeline`：只放人真正要读的协作消息
2. `execution/session log`：放 tool call、output、plan、token、status transition
3. `state snapshot`：放当前 session / turn / runtime / task 的最新状态

## 2. Codex Session 里有什么

基于这份 JSONL 样本，Codex session 记录大体分成四类顶层事件：

1. `session_meta`
2. `turn_context`
3. `event_msg`
4. `response_item`

### 2.1 session / turn 元信息

Codex 在 session 和每个 turn 开始时都会记录：

- session id
- cwd
- source / originator
- cli version
- model / provider
- approval policy
- sandbox policy
- collaboration mode
- truncation policy
- context window

这层的价值：

- 重放时知道 agent 当时在什么环境里工作
- 调试时能区分“模型行为问题”还是“运行环境问题”
- 便于后续做 resume / recovery

### 2.2 可见消息和内部推理分层

Codex 把用户可见内容和内部推理分开记：

- `event_msg.agent_message`：对用户可见的 commentary / final answer
- `response_item.message`：对应 assistant message 原文
- `response_item.reasoning`：内部推理内容，单独存，不混进主时间线

这层的价值：

- 可以保留推理与过程，但不污染协作时间线
- commentary 和 final answer 有明确 phase
- 以后做“只看结论 / 展开过程”会很容易

### 2.3 tool call / tool result 是一等对象

Codex 把工具执行拆成成对记录：

- `response_item.function_call`
- `response_item.function_call_output`
- `response_item.custom_tool_call`
- `response_item.custom_tool_call_output`

每条都有 `call_id`，可以直接配对。

样本里能看到：

- shell / exec 命令
- patch/edit
- chat 工具
- task claim / task status update
- plan update

这层的价值：

- 可以从一次 turn 精确回答“调用了哪些工具、参数是什么、结果是什么”
- 可以做失败定位和 replay
- 可以把“工具行为”和“自然语言消息”彻底分开

### 2.4 计划、任务状态、成本是结构化事件

Codex session 里有几类很有价值的结构化操作：

- `update_plan`
- `mcp__chat__claim_tasks`
- `mcp__chat__update_task_status`
- `event_msg.token_count`
- `event_msg.task_started`
- `event_msg.task_complete`

这层的价值：

- 会话不是只有聊天和命令，还显式记录“任务怎么推进”
- 能看到 agent 何时进入 `in_progress / in_review`
- 能看到 token usage 与 context window，不需要靠外部猜测成本

## 3. OpenShock 现在有什么

### 3.1 backend 模型

OpenShock 当前已有的核心对象在 [models.go](/Users/feifantong/code/OpenShockSwarm/apps/backend/internal/core/models.go)：

- `Message`
- `AgentSession`
- `AgentTurn`
- `EventFrame`
- `AgentWait`
- `HandoffRecord`
- `Run`
- `RunOutputChunk`
- `ToolCall`
- `MergeAttempt`
- `Runtime`

这说明 OpenShock 已经有“session / turn / run / tool call”的雏形，不是从零开始。

### 3.2 backend store / api

当前 backend 已支持：

- `agent turn` claim / complete
- `run` claim / event ingest
- `merge` claim / event ingest
- `run output chunk` 持久化
- `tool call` 持久化
- SSE realtime scope 推送

关键点在：

- [memory.go](/Users/feifantong/code/OpenShockSwarm/apps/backend/internal/store/memory.go)
- [server.go](/Users/feifantong/code/OpenShockSwarm/apps/backend/internal/api/server.go)

### 3.3 frontend

当前前端已有三个相关面：

1. room 主时间线
   - [shell-home-page.tsx](/Users/feifantong/code/OpenShockSwarm/apps/frontend/src/components/shell-home-page.tsx)
2. system panel
   - [room-system-panel.tsx](/Users/feifantong/code/OpenShockSwarm/apps/frontend/src/components/room-system-panel.tsx)
3. agent observability drawer
   - [agent-observability-drawer.tsx](/Users/feifantong/code/OpenShockSwarm/apps/frontend/src/components/agent-observability-drawer.tsx)

这些面现在能看到：

- room messages
- session 状态
- turn 状态
- wait / handoff
- runtime health
- run 列表

## 4. OpenShock 明显缺什么

### 4.1 缺真正的 session log 视图

当前 OpenShock 有 `AgentSession` / `AgentTurn`，但没有一条可读的 session log 时间线去回答：

- 这个 turn 何时开始
- 收到了什么上下文
- 期间发了哪些 commentary
- 调用了哪些工具
- 每个工具结果是什么
- 最终为何完成 / 阻塞 / 失败

现在这些信息散在：

- room messages
- agent observability drawer
- run output chunks
- tool calls

缺一个统一 viewer。

### 4.2 缺 turn 级环境快照

Codex session 里的 `turn_context` 很强。OpenShock 目前只有：

- `EventFrame`
- `RuntimeID`
- `ProviderThreadID`

但还缺：

- model/provider 版本
- sandbox / approval policy
- cwd / repo path 快照
- context window / truncation policy
- realtime / collaboration mode

这会导致后续难定位“为什么这次 agent 行为不同”。

### 4.3 缺 plan 与任务状态迁移日志

OpenShock 已有 task status，也补上了 agent 可调用的状态命令。

但当前系统里没有显式对象去记录：

- 这次 turn 的 plan
- plan 何时更新
- task status 是哪次 turn、哪次工具调用改的
- status 变化前后原因是什么

这会让 task board 变更可见，但不可解释。

### 4.4 缺 tool call 与 tool result 的可视化配对

OpenShock 后端已经有 `ToolCall` 和 `RunOutputChunk`，但前端没有一等 UI 去看：

- tool call 顺序
- arguments
- status
- stdout / stderr 对应片段
- 某次失败是哪个工具导致

当前 room / system / observability 面都无法替代这个能力。

### 4.5 realtime 只做 refresh，没有做结构化增量消费

OpenShock 的 realtime 目前主要是收到 `update` 后直接 `router.refresh()`，见 [live-refresh.tsx](/Users/feifantong/code/OpenShockSwarm/apps/frontend/src/components/live-refresh.tsx)。

这意味着：

- 有事件总线
- 但前端没有真正利用事件 payload 做 session viewer 的增量更新

而 Codex session 的优势之一，就是事件本身已经足够细，天然适合流式展示。

## 5. 最值得直接比较的点

如果要和 Codex session 记录做逐项比较，最适合对照的是这五组。

### 5.1 `turn_context` vs OpenShock `EventFrame`

Codex 强项：

- 环境、模型、策略、上下文窗口完整

OpenShock 现状：

- 只有会话语义上下文，没有执行环境上下文

建议：

- 给 `AgentTurn` 或新的 `AgentExecutionFrame` 增加环境快照字段

### 5.2 `event_msg.agent_message` vs OpenShock room/system message

Codex 强项：

- commentary / final answer 有 phase
- 对用户可见消息和工具记录分离

OpenShock 现状：

- room timeline 同时承载协作消息与部分系统过程

建议：

- 给 agent 可见输出增加 `phase` 或 `messagePurpose`
- room timeline 只保留 human-facing message

### 5.3 `function_call + function_call_output` vs OpenShock `ToolCall + RunOutputChunk`

Codex 强项：

- 调用与结果成对记录
- call_id 明确关联

OpenShock 现状：

- 有 `ToolCall` 和 output chunk
- 但没有 call_id，也没有统一 viewer

建议：

- 给 `ToolCall` 增加 `CallID`
- 把 output / tool call 归并到一个 execution event 流

### 5.4 `update_plan` vs OpenShock 无 plan 模型

Codex 强项：

- plan 是结构化对象，不是散落在自然语言里

OpenShock 现状：

- agent 可能在 room 里说计划
- 但系统没有 plan truth

建议：

- 新增 `AgentPlan` 或 `TurnPlanSnapshot`
- 至少支持 step + status + explanation

### 5.5 `task_started / task_complete / token_count` vs OpenShock run/turn 状态

Codex 强项：

- 有明确开始/结束事件
- 有 token / cost 维度

OpenShock 现状：

- 有 queued / claimed / completed / failed 等状态
- 但没有 token / cost / context-window 指标

建议：

- 在 `Run` 和 `AgentTurn` 上补 usage / cost / duration 统计
- 让 observability drawer 不只是状态面板，也能看资源消耗

## 6. 建议的产品落地顺序

### P1. 做一个一等的 Execution Log

目标：

- 不动 room 主时间线
- 新增一个按 session / turn / run 聚合的执行日志面板

最小内容：

- turn started / completed / blocked
- tool call
- tool result
- stdout / stderr
- task status updates
- final summary

这是性价比最高的一步，因为 OpenShock 后端已有一半数据。

### P1. 给 `ToolCall` 增加关联 id 和结果

建议字段：

- `callId`
- `parentTurnId`
- `resultSummary`
- `exitCode`

这样才能像 Codex 那样把“调用”和“结果”真正对齐。

### P1. 给 agent 可见输出增加 phase

建议：

- commentary
- final
- blocked_explanation

这样 room timeline 和 execution log 能共享一份消息模型，但各自过滤不同 phase。

### P2. 新增 turn 级 `ExecutionContext`

建议字段：

- repoPath
- cwd
- runtimeId
- provider
- model
- sandboxPolicy
- approvalPolicy
- contextWindow

这一步对 debug 和 replay 很关键。

### P2. 新增 `AgentPlan`

最小模型：

- `turnId`
- `explanation`
- `steps[]`
  - `label`
  - `status`

这会让 OpenShock 的 task / turn / room 三者关系更清晰。

### P3. usage / cost / duration

建议先补：

- startAt / endAt
- durationMs
- inputTokens
- outputTokens
- reasoningTokens

这是 Codex session 样本里最成熟、但 OpenShock 目前完全没有的一层。

## 7. 不建议照抄的地方

有些优点该吸收，但不建议直接原样搬。

### 7.1 不要把完整 prompt / base instructions 直接暴露到产品 UI

Codex session 会记录这层，因为它更像开发工具。

OpenShock 是协作产品，建议：

- 后端保存
- debug viewer 可见
- 普通 room UI 不展示

### 7.2 不要把 reasoning 直接放进 room

Codex 把 reasoning 单独存是对的。

OpenShock 也应该：

- 保存 reasoning 或摘要
- 只在 debug / observability 面板里展示
- 不进入协作主时间线

### 7.3 不要继续让 realtime 只做全量 refresh

Codex session 的优点之一是事件本身可消费。

OpenShock 若继续只做 `router.refresh()`，会浪费已有事件模型，也很难做真正的 session viewer。

## 8. 推荐的下一步

如果下一轮要把 Codex session 的优点真正放进 OpenShock，我建议按这个顺序做：

1. 新增 `ExecutionEvent` 模型，把 run output、tool call、task status update、turn lifecycle 收敛成统一事件流
2. 做一个 `Session / Execution Log` 抽屉或页面，不再把这些过程塞进 room timeline
3. 给 `AgentTurn` 增加 `ExecutionContext`
4. 给 agent 增加结构化 `Plan` 记录
5. 最后再补 token / cost / duration

这五步做完，OpenShock 才会真正吸收 Codex session 的优点，而不是只学到“日志很多”。

# OpenShock 对 Codex Session 记录的学习与吸收建议

- 日期：2026-04-09
- 参考样本：
  - `/Users/feifantong/.codex/sessions/2026/04/04/rollout-2026-04-04T16-39-53-019d57a6-0bd4-7cf2-9c70-a8401a17ecc4.jsonl`
- 目标：
  - 学习 Codex session 记录里值得产品化的优点
  - 对照 OpenShock 当前模型与 UI
  - 收敛成可执行的产品改进方向

## 1. 结论

这份 Codex session 记录最值得学习的，不是“记录得多”，而是它把一次 agent 工作拆成了非常清晰的多层结构：

1. 有稳定的 `session` / `turn` 边界
2. 有用户输入、上下文、阶段性 commentary、最终回答的明确区分
3. 有工具调用与工具结果的成对记录
4. 有 token / context / rate limit 这类运行元数据
5. 有 memory / notes 这类可恢复上下文的持续积累

OpenShock 当前已经有一部分底座：

1. `agent_session / agent_turn`
2. `run_output_chunks / tool_calls`
3. `realtime` 推送
4. Room / Task / Run / Merge 这些业务结构

但和 Codex session 相比，OpenShock 现在还缺少一层真正的“执行转录层”。

当前问题不是没有数据，而是数据还没有被组织成一个可读、可恢复、可调试的统一 transcript。

## 2. Codex Session 样本里最有价值的结构

### 2.1 顶层记录非常稳定

样本文件是 JSONL，每行都有：

1. `timestamp`
2. `type`
3. `payload`

这意味着整份 session 可以天然被当成 append-only event log 来消费。

对产品很重要的点：

1. 易于回放
2. 易于分层展示
3. 易于做过滤和检索
4. 易于增量同步

### 2.2 有清晰的 turn 生命周期

样本里每轮都有：

1. `task_started`
2. `turn_context`
3. `user_message`
4. 多个 `response_item`
5. `task_complete`

OpenShock 当前虽然有 `agent_turn`，但还没有把一次执行真正拆成：

1. turn 开始
2. turn 上下文
3. 中间过程
4. 最终产出
5. turn 完成

这导致现在的 observability 是“有零碎数据”，但不是“有完整回放”。

### 2.3 中间过程和最终输出是分层的

Codex session 里，assistant 输出至少分成两类：

1. `phase = commentary`
2. `phase = final_answer`

这点非常重要。

它解决的是：

1. 用户更新和最终交付不会混在一起
2. 中途解释不会污染最终结论
3. 可以在 UI 上做“过程流”和“结果流”的分离

OpenShock 当前在 room 里只有 message kind，没有明确的 `phase` 语义。

### 2.4 工具调用是成对、可追踪的

样本里有：

1. `function_call`
2. `function_call_output`
3. `custom_tool_call`
4. `custom_tool_call_output`
5. 每组都通过 `call_id` 关联

这意味着：

1. 可以知道“调了什么”
2. 可以知道“结果是什么”
3. 可以知道“是否成功”
4. 可以重建一次 agent 决策链

OpenShock 当前有 `tool_calls` 和 `run_output_chunks`，但还偏“日志碎片”，没有明确的 call-pair transcript 视图。

### 2.5 上下文元数据是显式记录的

样本里的 `turn_context` 直接记录：

1. `cwd`
2. `current_date`
3. `timezone`
4. `approval_policy`
5. `sandbox_policy`
6. `model`
7. `effort`
8. `truncation_policy`

另外还有反复出现的 `token_count`：

1. `input_tokens`
2. `cached_input_tokens`
3. `output_tokens`
4. `reasoning_output_tokens`
5. `model_context_window`

这类信息不该出现在 Room 主时间线里，但非常适合出现在 agent observability / run detail。

### 2.6 有“记忆沉淀”能力

样本里 agent 会：

1. 读取 `MEMORY.md`
2. 增补 `notes/channels.md`
3. 增补 `notes/work-log.md`

这说明 session 记录不是一次性运行日志，而是和长期记忆体系打通的。

OpenShock 当前的 agent 更多像“执行器”，还不够像“可恢复的长期协作者”。

## 3. OpenShock 当前现状

### 3.1 已经具备的能力

#### 业务主线

OpenShock 已有：

1. Room timeline
2. Task board
3. Run / Merge / Delivery 链路
4. Inbox 回流

#### agent 协作底座

OpenShock 已有：

1. `agent_session`
2. `agent_turn`
3. `event_frame`
4. `handoff_record`
5. `agent_wait`

见：

- [memory.go](/Users/feifantong/code/OpenShockSwarm/apps/backend/internal/store/memory.go)
- [models.go](/Users/feifantong/code/OpenShockSwarm/apps/backend/internal/core/models.go)

#### 执行观测底座

OpenShock 已有：

1. `run_output_chunks`
2. `tool_calls`
3. realtime SSE

前端也已有：

1. room system panel
2. agent observability drawer

### 3.2 当前明显缺的，不是“字段”，而是“组织层”

和 Codex session 相比，OpenShock 当前缺少：

1. 统一的 execution transcript
2. `turn started / turn completed` 的可视回放
3. `commentary / final_answer` 这种阶段语义
4. 工具调用与工具结果的成对展示
5. token / context / runtime metadata 的产品级承载
6. agent 长期记忆沉淀入口

## 4. 哪些优点最应该吸收到 OpenShock

### 4.1 最优先：把“执行过程”从 Room 里搬到独立 transcript

这次我们已经把 `run/merge started/completed` 从 Room timeline 拿掉了。

下一步最自然的方向就是：

1. Room 只放人真正需要看的协作消息
2. 执行细节进入独立 transcript / activity stream

建议新增一个统一视图，暂定叫：

- `Execution Transcript`

它应该承载：

1. turn started / completed
2. commentary
3. final answer
4. tool call begin / end
5. tool output summary
6. run output chunk
7. runtime metadata

这会比现在把 `tool_calls`、`run_output_chunks`、`agent_turns` 分散在不同角落要强很多。

### 4.2 高优先：为 agent turn 引入 phase 语义

建议给 agent 的可见产出增加：

1. `commentary`
2. `final_answer`

哪怕第一版只作为内部事件类型，不马上进 Room，也很值。

原因：

1. 可以区分“中途同步”和“最终交付”
2. 后续可以决定 commentary 只进 observability，不进 room
3. 最终回答可以单独做引用、归档、handoff 依据

### 4.3 高优先：把 tool call 升级成成对 transcript

当前 OpenShock 的 `tool_calls` 更像“调用清单”。

建议改成至少具备：

1. `call_id`
2. `started_at`
3. `completed_at`
4. `status`
5. `input_summary`
6. `output_summary`
7. `error_summary`

这样就能像 Codex session 一样，真正重建“这个 agent 为什么得出这个结论”。

### 4.4 高优先：给 turn / run 增加上下文快照

建议为 `agent_turn` 或 transcript session 记录：

1. model
2. reasoning effort
3. provider
4. runtime id
5. cwd / repo path
6. sandbox / approval policy
7. prompt summary

这些非常适合做：

1. 线上排障
2. 行为追责
3. 复盘
4. 复现实验

### 4.5 中优先：引入 token / cost / context 指标

这类信息不应该进 Room，但适合放在：

1. run detail
2. agent observability drawer
3. transcript header

至少第一版建议显示：

1. input tokens
2. output tokens
3. context window
4. cached tokens

如果 provider 支持，再补：

1. estimated cost
2. latency
3. retry count

### 4.6 中优先：为 agent 增加“长期记忆沉淀”层

Codex session 最大的一个隐形优点是：

它不只记录“发生了什么”，还记录“以后该如何更快恢复”。

OpenShock 可考虑增加一个轻量能力：

1. 每个 agent 可维护 `memory summary`
2. 每个 issue / room 可维护 `working notes`
3. handoff 时自动引用最近 summary

这比单纯保存历史 message 更接近真实协作。

## 5. 不建议直接照搬的点

### 5.1 不建议把全部 session 明细直接暴露给普通房间用户

Codex session 非常底层。

如果直接搬到 Room UI，会产生两个问题：

1. 噪音过大
2. 普通用户很难理解

正确做法应该是分层：

1. Room：协作结果层
2. Transcript / Observability：执行过程层
3. Raw event log：内部调试层

### 5.2 不建议一上来就做完整 MEMORY.md 文件系统

Codex 这一套和本地文件工作流耦合很深。

OpenShock 不一定需要直接复制成文件形态。

更适合的产品表达是：

1. agent memory summary
2. issue working notes
3. handoff notes

先做结构化能力，再决定底层是否落文件。

## 6. 建议的落地顺序

### P0

1. 新增统一 execution transcript 事件模型
2. 给 `agent_turn` / `run` 接入 `started / commentary / final / completed`
3. tool call 改成成对 begin/end 结构
4. 前端在 Room 外新增 transcript / execution 面板

### P1

1. transcript header 显示 model / runtime / repo / effort / token
2. handoff / blocked / failed 事件自动引用 transcript 片段
3. run detail 与 agent turn detail 共用同一套 transcript 组件

### P2

1. agent memory summary
2. issue working notes
3. 恢复模式 / resumed session 视图

## 7. 对 OpenShock 当前产品的直接启发

从这份 Codex session 学到的最核心一句话是：

`一个可用的 agent 产品，不只是要让 agent 能做事，还要让人能看懂 agent 是如何一步步做成这件事的。`

OpenShock 现在更偏“业务状态系统”：

1. Task / Run / Merge / Inbox 很清楚

但还不够“执行转录系统”：

1. agent 的上下文切换
2. 过程说明
3. 工具链条
4. 最终收束

这些还没有被统一成可回放的产品对象。

所以最值得吸收的，不是某个单独字段，而是这个分层方法：

1. Room 负责协作结果
2. Task 负责执行控制
3. Transcript 负责执行过程
4. Memory 负责长期恢复

如果 OpenShock 把这四层补齐，产品完成度会明显上一个台阶。

# OpenShock True P0 Technical Design

**版本:** 0.1  
**版本日期:** 2026 年 4 月 5 日  
**关联文档:** [OpenShockTrueP0MVP.md](./OpenShockTrueP0MVP.md), [OpenShockPRD.md](./OpenShockPRD.md)

---

## 一、目标

这份文档把 True P0 产品定义翻译成可执行技术方案。

True P0 的技术目标不是“先做一个能跑的 demo”，而是：

**在不写死未来演进路线的前提下，用最小但可维护的架构支撑人和多个 Agent 围绕同一个 Issue 的协作、并行执行、持续集成和最终交付。**

这份方案只覆盖：

- 架构
- 模块划分
- 数据流
- 可扩展性
- 风险点
- 测试策略

这份方案不覆盖：

- 具体业务代码
- UI 视觉稿
- 运营流程

---

## 二、硬约束与非目标

### 1. 硬约束

- `Task` 是显式产品对象，不允许只作为文本或消息存在
- `Integration Branch` 是显式产品对象，不允许混同为 `PR`
- 一个 `Issue` 下必须允许多个活跃 `Task`
- 多个 `Task Run` 必须允许并行
- `Room` 必须内置一个默认聊天 `Channel`
- `Session` 可以作为内部实现存在，但不作为前台核心对象
- 高风险动作必须进入审批链路
- 所有关键状态变化必须可追踪、可重放、可审计

### 2. True P0 非目标

- 微服务拆分
- 通用插件平台
- Cloud Sandbox
- 多层级任务树
- 完整 ABAC / 合规系统
- 通用记忆平台
- 跨多个 Repo 的协同编排

结论：

**True P0 采用模块化单体，不采用微服务。**

原因很直接：

- 当前系统边界还在快速校准
- 跨模块事务一致性比独立部署更重要
- 团队需要先把产品真相源稳定下来

---

## 三、系统设计总览

系统分为三个平面：

1. **Control Plane**
   - 产品真相源
   - 负责对象管理、状态机、协作流、调度决策、集成状态和通知
2. **Execution Plane**
   - 本地 Runtime / daemon
   - 负责 CLI 拉起、worktree 管理、日志采集、工具调用采集、执行结果回传
3. **Delivery Plane**
   - GitHub / Git
   - 负责 Repo 授权、分支操作、合并、PR 创建、状态同步

推荐架构：

- Web App: Next.js + TypeScript
- Backend: Go 模块化单体
- Database: PostgreSQL
- Realtime: SSE + event replay
- Async jobs: Go worker + Postgres outbox
- Local Daemon: Go

说明：

- 不单独引入 MQ 作为 P0 前置条件
- 异步事件先走 `Postgres outbox + worker`
- 后续若吞吐上升，可替换 worker 消费后端而不改变上层模块边界
- backend 与 daemon 之间使用 OpenShock 自有控制协议
- daemon 与具体 agent CLI 之间采用 ACP
- True P0 首个且唯一支持的 agent provider 是 Codex
- True P0 中 Agent 驱动 OpenShock 外部服务能力，优先采用 `skills + OpenShock CLI`
- MCP 不作为 True P0 前置集成方式，只保留为后续协议化演进方向

补充说明：

- True P0 中除配置查看 / 配置填写类页面外，默认要求界面数据通过实时推送保持更新
- 命令提交、表单提交、配置修改仍走 HTTP request/response
- 状态变化、日志增量、审批变化、集成进度、运行时状态变化统一走 SSE
- 当前前端是 SSR-first 结构，P0 优先选择 SSE，而不是先引入 WebSocket
- backend 必须支持 `Last-Event-ID`、有限事件重放、`resync_required` 和 heartbeat
- Room 内的自然语言交流不是附属信息，而是 True P0 的正式控制输入之一
- 人类给 Agent 下指令、Agent 回复计划、执行中汇报、遇阻塞提问、完成后总结，必须建立在同一条 Room timeline 上
- 但自然语言本身不能直接改写业务真相；最终落状态仍必须经过 Action Gateway、Run Control、Git Integration Manager 和 daemon 协议

---

## 四、核心技术原则

### 1. 真相单写原则

每个核心对象只允许一个模块拥有最终写入权。

例如：

- `Issue` / `Task` 状态由 Planning & Tasking 管
- `Run` 生命周期由 Run Control 管
- `Runtime` 在线状态由 Runtime Registry 管
- `Integration Branch` 状态由 Git Integration Manager 管

这条原则是为了避免“谁都能改状态，最后谁都解释不清”。

### 2. 事件驱动，但不事件源化

True P0 不做 full event sourcing。

采用方式：

- 主状态写入关系表
- 同时写入审计事件和 outbox 事件
- Realtime、Inbox、异步副作用都基于 outbox 消费

这样兼顾：

- 简化查询
- 可追踪
- 可扩展
- 降低实现复杂度

### 3. 控制面和执行面强隔离

Backend 决定“应该做什么”，daemon 负责“具体怎么在本地执行”。

Backend 不能直接假设本地文件系统状态，daemon 也不能绕过 backend 自行改变业务状态。

进一步约束：

- backend 可以拥有 Git 业务对象和状态机
- 但 backend 不应直接在用户本地机执行 `git` / `worktree` 命令
- 用户本地机上的 Repo、branch、worktree、merge 等实际操作必须由 daemon 执行
- backend 只下发意图、记录结果、推进业务状态
- daemon 只执行本地动作并回传 execution / merge result，不拥有最终业务真相

### 4. Git 是一等技术域

Git 不是执行细节，而是核心协作载体。

因此以下对象都必须进入明确模型：

- `Task Branch`
- `Integration Branch`
- `Delivery PR`
- merge attempt
- merge result

但要明确：

- Git 是一等技术域，不等于 Git 命令应在 backend 内直接执行
- backend 负责 Git Integration Manager 与 Repo Integration 的控制面职责
- daemon 负责用户本地环境中的 Git 执行职责
- 两者之间必须通过明确协议传递 `git intent` 与 `git result`

### 5. 默认幂等

以下动作都必须设计成幂等：

- Runtime 心跳
- Run claim
- Run result 上报
- Git merge attempt
- GitHub webhook 处理
- Inbox item 生成

### 6. 语言驱动优先，但不让 backend 充当 Agent

True P0 要支持“通过语言交流来成功实现目标”，但不应该把 backend 做成一个自研大模型代理。

原则：

- 自然语言理解、任务理解、执行计划生成、进度表述、提问、总结，尽可能复用 Codex 本身能力
- OpenShock 自己负责：
  - Room 消息真相
  - 结构化协作消息契约
  - Agent 可调用系统动作的 CLI / Action 契约
  - 审计、幂等、状态机、审批、Git 控制面
- backend 不直接把自由文本解析成高风险动作
- 自由文本要么：
  - 被 Agent 读懂后通过 `skills + OpenShock CLI` 触发正式动作
  - 要么被显式 slash command / 表单动作转成正式动作

结论：

- 语言交流是控制入口
- Action / Run / Merge / Delivery 仍是最终状态落点
- Codex 负责“会说、会想、会规划”
- OpenShock 负责“可控、可审计、可回放”

---

## 五、模块划分

True P0 后端采用一个 Go 代码库内的模块化单体。

建议按下面模块拆分。

### 1. Identity & Workspace

职责：

- 登录、会话
- Workspace 管理
- Member 管理
- GitHub 身份绑定
- Runtime 设备授权

拥有对象：

- `workspace`
- `member`
- `auth_identity`
- `device_authorization`

不拥有：

- Repo 业务状态
- Issue / Task / Run 状态

### 2. Repo Integration

职责：

- Repo 接入
- GitHub App 安装记录
- Repo 权限校验
- Delivery PR 创建与同步
- webhook 入口

拥有对象：

- `repo`
- `github_installation`
- `delivery_pr`

不拥有：

- 本地 Git 执行
- Task Branch / Integration Branch 运行时状态

### 3. Collaboration

职责：

- `Room`
- `Room Channel`
- 消息流
- 结构化协作消息
- Agent / Member 发言权限校验

拥有对象：

- `room`
- `room_channel`
- `message`

不拥有：

- Task 状态
- Run 状态

说明：

- True P0 先只支持 `Room` 内默认单 `Channel`
- 但从数据模型上保留 `room_channel`，避免未来再重构消息归属
- Collaboration 不能只存普通聊天消息，还必须支持结构化协作消息

建议消息类型最小集合：

- `message`
- `instruction`
- `ack`
- `plan`
- `progress_update`
- `clarification_request`
- `blocked`
- `completion_summary`
- `handoff`
- `handoff_accept`
- `system_event`

说明：

- 这些类型首先是消息契约，不要求一开始都独立成表
- P0 可以先落在 `message.kind`
- 但这些消息必须可区分，不能全塞成普通文本

### 3.1 Agent Conversation Orchestrator

职责：

- 订阅 Room 内新消息
- 判断哪些消息需要某个 Agent 响应
- 为 Agent 创建“语言响应任务”
- 维护 Agent 在 Room 中的会话状态
- 驱动 Agent 产出：
  - 理解确认
  - 执行计划
  - 进度汇报
  - 阻塞提问
  - 完成总结
  - Agent-Agent 协同消息
  - Agent-Agent 交接消息

拥有对象：

- `agent_session`
- `agent_turn`
- `agent_wait`
- `handoff_record`

不拥有：

- Task 最终状态
- Run 最终状态
- Merge / Delivery 最终状态

关键实现原则：

- 这一层只决定“谁该回复、该回复什么类型、是否需要继续跟进”
- 真正的自然语言生成尽可能复用 Codex
- 真正的业务动作仍通过 `skills + OpenShock CLI` 进入 backend
- 这一层不绕过 Action Gateway 直接改业务表

True P0 的最小实现：

- 不做通用 multi-agent planner
- 不做复杂群聊自动抢话
- 只做：
  - 定向给 Agent 的语言指令处理
  - Agent 对 Room 的标准化回写
  - Agent 间显式交接
  - Agent 间显式委托

### 3.2 与 Codex 的复用边界

True P0 尽可能复用 Codex，而不是重复建设以下能力：

- 自然语言理解
- 任务拆解与执行计划生成
- 进度表述
- 澄清问题生成
- 结果总结
- 交接摘要生成

OpenShock 需要自己提供的，是 Codex 所不拥有的系统上下文：

- 当前 Room transcript
- 当前 Issue / Task / Run / Integration Branch 状态
- 可调用动作的稳定 CLI 契约
- 审批与权限边界
- 本地 Repo / worktree / merge 执行回传

因此推荐模式是：

- Codex 作为“语言与执行智能”
- OpenShock skills 作为“系统使用手册”
- OpenShock CLI 作为“系统动作入口”
- daemon 作为“本地执行与 ACP 宿主”
- backend 作为“产品真相源”

### 4. Planning & Tasking

职责：

- Issue 创建
- Task 创建、分派、取消
- Task 状态流转
- Task 与 Agent 绑定

拥有对象：

- `issue`
- `task`
- `task_assignment`

不拥有：

- Run 执行明细
- Runtime 在线状态

### 5. Runtime Registry

职责：

- Runtime pairing
- Runtime capability discovery
- 心跳
- Runtime 可用性判断
- Runtime 到 Agent 的服务关系暴露

拥有对象：

- `runtime`
- `runtime_capability`
- `runtime_lease`

不拥有：

- Run 状态最终决策

### 6. Run Control

职责：

- Run 创建
- Run 入队
- Run claim
- Run 生命周期状态机
- Run 输出索引

拥有对象：

- `run`
- `run_attempt`
- `run_output_chunk`
- `tool_call`

不拥有：

- Task 业务优先级
- Integration Branch 状态

补充说明：

- Run Control 管的是代码执行型 `run`
- 不直接承担 Room 内语言响应轮次
- 若 Agent 因语言交流触发“需要回复”而尚未进入代码执行，应进入 `agent_turn`，而不是伪装成 `run`

### 7. Execution Adapter

职责：

- backend-daemon 控制协议
- ACP 会话管理
- Codex ACP 适配
- worktree 初始化协议
- stdout / stderr / tool call ingestion
- git execution envelope 适配

拥有对象：

- 无长期业务对象
- 只拥有协议层和适配逻辑

说明：

- 这是 backend 与 daemon 的边界层
- 这是 OpenShock execution envelope 与 ACP 事件模型的转换层
- True P0 不做多 provider 并行适配，先只支持 Codex
- 不允许在这里偷塞业务状态机
- 这里也承载 backend 下发本地 Git 意图、daemon 回传 merge / conflict 结果的协议定义
- 这里不承担 OpenShock 业务动作能力暴露
- True P0 中，Agent 对聊天、Task、审批、Git 集成、Delivery 等系统能力的调用，统一通过本地 `OpenShock CLI` 完成
- `OpenShock CLI` 本质上是 Action Gateway 和 daemon protocol 的本地包装层，不拥有业务真相
- skills 负责告诉 Agent 何时调用哪些 CLI 命令，CLI 负责输出稳定 JSON 契约
- MCP 若后续引入，应建立在同一业务模块和同一 CLI/Action 契约之上，而不是另起一套平行写接口

补充边界：

- daemon 不只要托管代码执行型 run，也要托管语言响应型 agent turn
- 但这两类执行都复用同一套：
  - Codex provider
  - ACP session
  - skills
  - OpenShock CLI
- 区别只在于输入上下文和输出契约不同：
  - `run` 输出代码执行结果
  - `agent_turn` 输出 Room 消息、问题、交接或后续动作

补充说明：

- True P0 中 `Runtime` 不是产品语义上的 Agent，本质上是“当前在线、可执行 claim 的本地 client / daemon”
- `Agent` 才是协作对象：
  - 可被 @mention
  - 可持有 `agent_session`
  - 可被分派 Task
  - 可发起 handoff
- 因此调度顺序必须是：
  1. backend 先判断“哪个 Agent 需要响应”
  2. 再为该 Agent 选择可服务它的 Runtime
- Runtime 注册时应声明自己当前可服务哪些 Agent，而不是反过来让 Agent 作为执行 client 自行注册
- 这条边界的目的，是把“谁该响应”与“谁来执行”明确拆开

### 8. Git Integration Manager

职责：

- `Task Branch` 元数据维护
- `Integration Branch` 创建
- merge attempt orchestration
- merge result 记录
- 冲突状态计算

拥有对象：

- `task_branch`
- `integration_branch`
- `merge_attempt`

不拥有：

- Delivery PR webhook 状态
- 用户本地机上的 `git` / `worktree` 命令执行权

说明：

- Git Integration Manager 是控制面模块，不是本地 Git executor
- 它负责决定：
  - 何时创建 `Task Branch`
  - 何时尝试合入 `Integration Branch`
  - merge result 如何映射为业务状态
- 它不负责在 backend 进程内直接操作用户本地 Repo
- 真正的本地 Git 操作由 daemon 执行，再通过协议回传结果

### 9. Inbox & Notification

职责：

- 根据事件生成 Inbox Item
- 页面内实时提示
- 未来浏览器 Push / 邮件接口预留

拥有对象：

- `inbox_item`
- `notification_delivery`

### 10. Audit & Eventing

职责：

- 业务审计日志
- outbox 事件
- 事件分发给 realtime / inbox / worker

拥有对象：

- `audit_log`
- `outbox_event`

---

## 六、部署视图

### 1. Web App

职责：

- 页面渲染
- 用户交互
- WebSocket 订阅

不做：

- 业务状态机
- 本地执行

### 2. API Server

职责：

- REST / WebSocket
- 身份校验
- 业务编排
- 事务写库

### 3. Worker

职责：

- 消费 outbox
- 生成 Inbox
- 推送实时事件
- 拉起异步 GitHub 同步
- 做非阻塞型后处理

### 4. Local Daemon

职责：

- 注册 Runtime
- 接收 Run
- 管理 worktree
- 执行本地 Git / worktree / merge 动作
- 拉起 CLI
- 回传日志、工具调用、结果

补充说明：

- 只要动作发生在用户本地机文件系统上，就应优先归 daemon
- 包括：
  - repo checkout
  - task branch 创建
  - integration branch checkout
  - merge 执行与冲突探测
  - worktree 生命周期管理
- daemon 不决定业务是否允许这些动作，只负责执行与回传

### 5. PostgreSQL

职责：

- 主数据存储
- outbox
- 审计日志

结论：

- P0 不拆独立消息队列
- P0 不拆独立日志系统
- P0 不拆独立调度服务

---

## 七、核心数据模型

这里只定义关键实体和所有权，不定义完整字段。

### 1. 协作域

- `workspace`
- `member`
- `agent`
- `repo`
- `issue`
- `room`
- `room_channel`
- `message`
- `agent_session`
- `agent_turn`
- `agent_wait`
- `handoff_record`
- `task`
- `task_assignment`

### 2. 执行域

- `runtime`
- `runtime_capability`
- `run`
- `run_attempt`
- `run_output_chunk`
- `tool_call`

### 3. Git 交付域

- `task_branch`
- `integration_branch`
- `merge_attempt`
- `delivery_pr`

### 4. 事件与通知域

- `inbox_item`
- `audit_log`
- `outbox_event`
- `notification_delivery`

### 5. 建议的关键约束

- `issue.room_id` 唯一
- `room` 必须有且仅有一个默认 `room_channel`
- `task.issue_id` 非空
- `task.assigned_agent_id` 可空，但 `run` 创建前必须非空
- `run.task_id` 非空
- `run.runtime_id` 在 `queued` 阶段可空，在 `running` 阶段必须非空
- `agent_session.room_id + agent_id` 在 active 状态下唯一
- `agent_turn.session_id + sequence` 唯一
- `handoff_record.from_agent_id` 与 `handoff_record.to_agent_id` 不能相同
- `task_branch.task_id` 唯一
- `integration_branch.issue_id` 唯一
- `delivery_pr.issue_id` 非空

### 6. 语言协作对象的最小字段建议

`message`

- `kind`
- `actor_type`
- `actor_id`
- `room_id`
- `reply_to_message_id`
- `turn_id`
- `task_id`
- `run_id`
- `handoff_id`

`agent_session`

- `room_id`
- `agent_id`
- `provider_thread_id`
- `status`
  - `idle`
  - `responding`
  - `waiting_human`
  - `waiting_agent`
  - `executing`
  - `completed`
- `last_message_id`
- `current_turn_id`

`agent_turn`

- `session_id`
- `trigger_message_id`
- `source_room_id`
- `source_message_id`
- `target_room_id`
- `status`
  - `queued`
  - `claimed`
  - `responding`
  - `waiting`
  - `completed`
  - `cancelled`
- `intent_type`
  - `instruction_response`
  - `default_monitor_response`
  - `progress_report`
  - `clarification`
  - `completion_summary`
  - `handoff`
- `event_frame`
- `result_message_id`

补充约束：

- `provider_thread_id` 属于 `agent_session`，不属于 `agent_turn`
- 一个 Agent 在一个长期 provider thread 上持续工作是允许的
- 但 Room / Channel / Task / Message 的业务边界，不能寄托在 provider thread 内部记忆里，仍必须落在 OpenShock 自己的结构化对象上
- `agent_turn` 的职责不是保存长期上下文，而是向 Agent 的长期 provider thread 注入一次新的事件帧

`event_frame`

- `current_target`
- `source_target`
- `source_message_id`
- `requested_by`
- `related_issue_id`
- `related_task_id`
- `recent_messages_summary`
- `expected_action`
- `context_summary`

`agent_wait`

- `turn_id`
- `wait_type`
  - `human_answer`
  - `agent_answer`
  - `approval`
- `question_message_id`
- `resolved_by_message_id`

`handoff_record`

- `room_id`
- `task_id`
- `from_agent_id`
- `to_agent_id`
- `reason`
- `summary`
- `status`
  - `proposed`
  - `accepted`
  - `rejected`
  - `completed`

### 7. 主键策略

建议所有业务实体统一使用 ULID。

原因：

- 时间排序友好
- 前后端统一
- 比自增 id 更适合分布式事件和日志排查

---

## 八、关键数据流

### 1. Issue 创建到 Room 建立

1. 前端调用 `CreateIssue`
2. API 在一个事务内：
   - 创建 `issue`
   - 创建 `room`
   - 创建默认 `room_channel`
   - 创建 `integration_branch`
   - 写入 `audit_log`
   - 写入 `outbox_event`
3. Worker 消费事件，向相关订阅者推送 realtime 更新

要求：

- 这一步必须是单事务
- 不允许出现 Issue 已创建但 Room 未创建

### 1.1 Room 内语言指令到 Agent 响应

1. 人类在 Room 内发送 `instruction` 类型消息，目标可以是：
   - 指定 agent
   - 负责该 Task 的 agent
   - Room 内默认协作 agent
2. Collaboration 写入 `message`
3. Agent Conversation Orchestrator 评估是否需要创建 `agent_turn`
4. 若需要：
   - 创建或激活 `agent_session`
   - 创建 `agent_turn(status=queued)`
   - 写入 `outbox_event`
5. daemon 或 agent runtime claim `agent_turn`
6. daemon 使用 Codex + skills + OpenShock CLI：
   - 读取 `agent_session.provider_thread_id`
   - 若不存在则初始化新的 provider thread
   - 读取当前 Room / Task / Issue / recent messages 结构化上下文
   - 组装本轮 `event_frame`
   - 生成理解确认
   - 必要时生成执行计划
   - 必要时触发正式动作
7. Agent 回写 `ack` / `plan` / `clarification_request` / `progress_update` / `completion_summary`

要求：

- backend 不直接把自由文本翻译成业务状态
- Agent 对文本的理解必须通过 Room 消息显式回写
- 任何正式业务动作仍必须走 Action Gateway
- provider thread 可以长期复用，但每一轮都必须显式注入当前事件 frame，不能只依赖隐式记忆来区分正在处理哪个 Room / Task / Message

### 1.2 默认响应 / 聊天优先规则

True P0 的默认响应语义应收成最简单的一版：消息先按可见性广播给可见 agent，再由 agent 自己判断要不要回应。

核心语义：

1. Room / 私聊消息不再拆成两套系统流程
   - 不管有没有显式 `@mention`
   - 本质上都是 agent 收到一条消息后，先判断要不要回应
   - 如果回应，先自然语言接话
   - 同时再分析这段对话是否已经足够清晰，可以进一步形成 task
2. `@mention` 不是另一套流程入口
   - 它只是更强的定向信号
   - 被 `@mention` 的 agent 应更强烈地判断“这条消息应该由我回应”
   - 但消息理解、回应方式、是否继续推进，本质上仍然是同一套判断过程
3. `task` 不是默认响应入口
   - 默认响应首先是聊天语义
   - `task` 是后续分析结果
   - 只有当目标、边界、执行意图已经足够清楚时，才应进一步进入 task / run / merge / delivery 语义
4. `agent.status = monitoring` 不再作为产品真相
   - 后续不应再靠 `monitoring agent` 解释谁能接未 `@mention` 消息
   - 产品语义应改成：
     - 该消息对哪些 agent 可见
     - agent 在看到消息后是否决定回应

系统分发规则应收成：

1. 先按可见性广播
   - room 消息广播给该 room 内可见的 agent
   - 私聊消息广播给该私聊上下文内可见的 agent
2. backend 负责把消息的结构化上下文送给 agent
   - room / dm target
   - actor
   - recent messages
   - 是否显式 `@mention`
   - 被 `@mention` 的 agent 列表
   - 当前是否处于 clarification / handoff / active conversation 之中
3. 是否回应、如何回应、是否继续聊下去，由 agent 自己判断

Codex 的提示词应收成单一版本，而不是多套 prompt：

1. 先判断这条消息是否需要回应
   - 状态播报、无需介入的消息，可以不回
   - 呼叫、提问、请求帮助、需要确认、或上下文下明显应接话的消息，应回应
2. 如果回应，优先使用自然语言
   - 像同事一样接话
   - 先确认、澄清、补一句判断、或给轻量建议
   - 不要默认用“接任务 / 分派任务 / 创建任务”这类任务化口吻
3. 在回复的同时，分析是否需要进一步形成 task
   - 这是并行分析，不等于立刻任务化
   - 只有在目标和执行边界足够清楚时，才进一步调用系统动作

因此，这轮推荐的默认提示词约束应接近：

- 先决定这条消息是否值得回应
- 如果回应，先以自然语言像协作同事一样回复
- 不要默认把普通消息翻译成任务分派或工作流表达
- 同时分析当前对话是否已经足够清晰，可以进一步形成 task
- 只有在目标明确时，才进入正式动作语义

要求：

- backend 仍不直接把自由文本翻译成业务状态
- 正式动作仍只能走 Action Gateway / OpenShock CLI
- `@mention` 信号必须显式进入 event frame / message metadata，但不应演化成另一套系统流程
- 产品语义应优先收成“广播 + agent 自决”，工程上可保留最轻的防风暴保护作为兜底，但不把它上升成主语义

### 1.3 Workspace 级 Repo 绑定

True P0 后续不再把 `repoPath` 视为 `issue` 私有属性，而是提升为 `workspace` 级配置。

核心语义：

1. `repo binding` 的真相源属于 `workspace`
   - 一个 `workspace` 可以绑定一个或多个 repo
   - `issue / room / task / run / merge / delivery` 只消费 workspace 已绑定 repo，不再自己持有“绑定动作”
2. 第一版要区分“绑定集合”与“执行选中”
   - 长期真相模型允许一个 workspace 绑定多个 repo
   - 但 True P0 这次迁移的执行面先收成一个保守版本：
     - workspace 可以保存多个 repo binding
     - 其中必须有且只有一个 `default` repo binding 作为当前执行链路默认仓库
     - 在没有显式 repo 选择能力之前，`issue / task / run / merge / delivery` 全部默认解析到这个 workspace default repo
   - 当前产品展示只暴露一个 `default repo` 入口，不展示 bound repo 列表；非 default binding 仅作为内部实现预留
3. 这次不要把 repo 选择重新塞回 issue
   - `issue` 可以显示“当前生效 repo 是什么”
   - 但这只是 derived view，不再是 issue 自己的绑定真相
   - 后续如果要支持多 repo 精确路由，应优先增加显式 `repo_binding_id` 引用，而不是重新恢复 `issue.repoPath`

建议新增对象：

- `workspace_repo_binding`
  - `id`
  - `workspace_id`
  - `label`
  - `repo_path`
  - `is_default`
  - `status`
    - `active`
    - `disabled`
- 后续若需要更细粒度路由，可再给 `issue / task / run` 增加 `repo_binding_id`

这次迁移的字段边界应冻结为：

1. `core.Issue.RepoPath`
   - 从真相字段降级为移除目标
   - 短期兼容阶段可以保留只读返回或派生展示，但不允许再作为绑定写入源
2. `core.Run.RepoPath`
   - 继续保留
   - 语义改成“运行快照”，表示该 run 实际使用的 repo path
   - 可考虑后续补 `repoBindingId`
3. `core.MergeAttempt.RepoPath`
   - 继续保留
   - 语义改成“合并快照”，表示该 merge 实际使用的 repo path
   - 可考虑后续补 `repoBindingId`

执行链路的取仓规则冻结为：

1. `Run.create`
   - 不再从 `issue.repoPath` 解析 repo
   - 而是从 `workspace default repo binding` 解析当前 repo
   - 在创建 run 时把解析结果快照进 `run.repoPath`
2. `GitIntegration.merge.request / approve`
   - merge attempt 同样从 workspace default repo binding 解析
   - 在创建 merge attempt 时把解析结果快照进 `mergeAttempt.repoPath`
3. `DeliveryPR.create.request`
   - 若其下游需要 repo 语义，同样只消费已快照或 workspace default repo，不向 issue 取值
4. 若 workspace 当前没有任何 default repo binding
   - `Run.create / merge / delivery` 必须明确失败
   - 错误语义应改成“workspace 缺少默认 repo 绑定”，而不是“issue 缺少 repoPath”

Action / API 契约冻结为：

1. 新的 canonical action 应改为：
   - `Workspace.bind_repo`
   - `targetType = workspace`
   - `payload` 至少包含：
     - `repoPath`
     - `label`（若未提供，可按 repo basename 生成）
     - `makeDefault`（可选，默认 true 当 workspace 尚无 default repo 时）
2. 兼容策略：
   - MVP 阶段不保留兼容映射
   - `Issue.bind_repo` 直接退出正式能力面
   - backend / frontend / 测试 / walkthrough 文档在这轮一起切到 `Workspace.bind_repo`
   - 若还有旧路径调用 `Issue.bind_repo`，应直接返回明确错误，提示改用 workspace 级入口
   - 也就是说：
     - 这轮允许大胆重构，不为旧 issue 级 repo 绑定入口保留过渡逻辑
     - 目标是尽快把模型拉正，而不是为未上线 MVP 继续背旧语义包袱
3. API 返回面：
   - `bootstrap / room detail / issue detail` 应补充 workspace repo bindings
   - issue/room 页面若需要显示 repo 状态，应显示：
     - workspace 是否已有 default repo
     - 当前 issue 的 effective repo 是哪个 binding / path

前端入口冻结为：

1. 绑定入口从 issue-room 右侧栏迁移到 workspace 级
   - issue room 不再承担 repo 绑定写入口
   - issue room 可以只显示当前 effective repo 和来源（workspace default）
2. 第一版 UI 不强求完整多 repo 路由控制台
   - 但至少要能：
     - 查看当前 workspace 已绑定 repo
     - 绑定新 repo
     - 看见哪个 repo 是 default
3. 如果这轮前端改动要收范围
   - 可以先把 issue-room 里的旧组件改造成 workspace 入口的代理视图
   - 但文案必须改清楚，不能继续显示“bind repo to this issue”

QA 与迁移边界冻结为：

1. 旧用例里“issue 绑定 repo 后 run / merge 带出 repoPath”应整体改写成：
   - workspace 绑定 default repo
   - issue / task / run / merge / delivery 均解析到该 repo
2. 需要新增至少 3 类回归：
   - workspace 无 default repo 时，执行链路报错是否正确
   - workspace 有 default repo 时，run / merge / delivery 是否稳定快照同一路径
   - 旧 `Issue.bind_repo` 入口在过渡期是否被正确兼容或正确拒绝
3. walkthrough / bug list / regression checklist 里所有“issue 级 repoPath 绑定”描述都要同步改口径

这次设计的明确取舍：

- 长期真相：workspace 可绑定多个 repo
- True P0 首版执行路由：只认一个 workspace default repo
- True P0 首版产品交互：只暴露一个 default repo 入口，不展示 bound repo 列表
- 不在这轮同时引入 issue / task 级 repo 选择器
- `Run / MergeAttempt` 保留 `repoPath`，但仅作为执行快照，不再作为绑定真相
- `Issue.bind_repo` 直接移出正式能力面，不做兼容保留

### 2. Task 创建与分派

1. 用户或 Agent 在 Room 内创建 Task
2. Planning & Tasking 创建 `task`
3. 若立即分派：
   - 写入 `task_assignment`
   - 创建 `task_branch`
   - 创建 `run`
4. 写入 outbox，通知 Room 和 Inbox

要求：

- Task 创建和首次 Run 创建可分开
- 但 Task 到 Agent 的绑定必须明确

### 2.1 Agent 执行中主动汇报与主动提问

1. Agent 已有 active `agent_session`
2. 若 Agent 只是汇报进度：
   - 直接生成 `progress_update` 消息
3. 若 Agent 需要代码执行：
   - 通过 `OpenShock CLI` 创建或推进 `run`
   - daemon 托管代码执行
   - Run 状态通过系统事件与摘要消息回流 Room
4. 若 Agent 遇到阻塞：
   - 生成 `clarification_request` 或 `blocked` 消息
   - 创建 `agent_wait`
   - session 进入 `waiting_human` 或 `waiting_agent`
5. 人类或其他 Agent 回复后：
   - Orchestrator 将回复绑定到 `agent_wait`
   - 生成下一条 `agent_turn`

要求：

- “提问”不能只表现为 run blocked 的系统提示
- 必须有可回复、可解除等待、可继续推进的语言对象

### 2.2 私聊控制与跨频道发言

1. 人类可在 DM 或其他控制入口中向 Agent 下达“去目标频道说一句话”这类指令
2. backend 仍然只为目标 Agent 创建 `agent_turn`
3. daemon 在 Agent 的长期 provider thread 上处理该 turn，并组装跨频道 `event_frame`
4. 若只是一次性投递：
   - Agent 通过正式动作向目标 Room 写入 `RoomMessage.post`
   - 消息元数据中必须保留：
     - `source_room_id`
     - `source_message_id`
     - `requested_by`
     - `related_issue_id`
     - `context_summary`
5. 若目标频道会继续形成对话：
   - 目标频道必须创建自己的本地 `agent_session`
   - 新 session 以桥接后的 `event_frame` 启动
   - 后续互动在目标频道本地继续收敛

要求：

- 跨频道上下文不依赖“全局 provider thread 自动理解一切”
- 必须通过显式 bridge context 把来源、目的、当前任务与预期动作传给目标侧
- 一次性投递和持续协作必须区分处理

### 3. Run 调度与 claim

1. `run` 进入 `queued`
2. Runtime Registry 按 capability 暴露可用 runtime
3. Run Control 选择候选 runtime
4. daemon 发起 claim
5. backend 使用 compare-and-set 方式把 `run` 从 `queued` 改到 `running`
6. 生成 `run_attempt`

要求：

- claim 必须防止双消费
- 使用乐观锁或 `WHERE status = 'queued'`

### 4. 本地执行与日志回流

1. daemon 为 task 准备 worktree
2. daemon 切到 `task_branch`
3. daemon 通过 ACP 建立与 Codex CLI 的执行会话
4. stdout / stderr / tool calls 分块回传 backend
5. backend 追加写入 `run_output_chunk` / `tool_call`
6. realtime 推送给订阅中的 Room / Run 页面

要求：

- 输出写入必须 append-only
- 不允许服务端覆盖历史块

### 4.1 Agent-Agent 协同与交接

1. Agent A 在 Room 中通过语言或 CLI 触发协同：
   - 创建 Task 给 Agent B
   - 或发出 `handoff` 消息
2. Orchestrator 创建 `handoff_record`
3. Agent B 收到新的 `agent_turn`
4. Agent B 必须回写：
   - `handoff_accept`
   - 或 `clarification_request`
   - 或 `handoff` 拒绝说明
5. 若交接接受：
   - Task assignment、后续 run、Room session 一并切换

要求：

- 交接必须显式，不允许只靠一条普通聊天消息隐式完成
- handoff 必须能追踪 from / to / summary / status

### 5. blocked / approval_required 回流

1. daemon 或 adapter 上报状态变化
2. Run Control 写 `run.status`
3. Audit & Eventing 写 `audit_log` + `outbox_event`
4. Inbox & Notification 生成 `inbox_item`
5. Collaboration 在 Room 默认 Channel 中插入结构化系统消息

要求：

- Inbox 项生成必须幂等
- 一个 run 的同类阻塞事件不能无限重复刷屏

### 6. Task 结果合入 Integration Branch

1. 某个 Task 被标记可集成
2. Git Integration Manager 发起 merge attempt
3. daemon 驱动本地 git merge
4. 结果写入 `merge_attempt`
5. 若成功：
   - 更新 `task.status = integrated`
   - 更新 `integration_branch` 聚合状态
6. 若失败：
   - 记录冲突
   - 生成 Inbox Item
  - 向 Room 写结构化消息

要求：

- merge attempt 必须记录：
  - source task
  - source task branch
  - source run
  - target integration branch
  - 执行者 runtime / actor
- backend 负责创建 merge attempt 和消费 merge result
- daemon 负责实际执行 merge，并返回 success / conflict / output

### 7. Delivery PR 建立

1. `integration_branch` 进入 `ready_for_delivery`
2. Repo Integration 调用 GitHub 创建 `delivery_pr`
3. 保存外部 PR id / url / status
4. webhook 回写 review / merge 状态
5. Issue 状态进入 `in_review` 或 `done`

要求：

- GitHub webhook 必须可重放
- webhook 处理必须幂等

---

## 九、实时事件设计

P0 只定义最小事件集，并明确传输与可用性策略。

### 0. 传输协议与前端消费

- 浏览器到 backend 采用 SSE 单向订阅
- 前端提交动作时仍走 REST
- 前端收到 realtime event 后，按 scope 做页面级 refresh 或局部 store 更新
- 对于当前 True P0 实现，优先采用页面级 refresh，避免过早引入双写状态源
- 订阅 scope 至少支持：
  - `workspace:<id>`
  - `room:<id>`
  - `issue:<id>`
  - `task:<id>`
  - `run:<id>`
  - `merge:<id>`
  - `runtime:<id>`
  - `board:default`
  - `inbox:default`

### 0.1 可用性要求

- SSE 连接断开后浏览器自动重连
- backend 必须保留有限长度的最近事件历史，用于断线恢复
- 客户端重连时通过 `Last-Event-ID` 请求补发缺失事件
- 若缺口超出保留窗口，backend 返回 `resync_required`
- 前端收到 `resync_required` 后必须立刻做一次全量刷新
- backend 必须定期发送 heartbeat，避免代理或浏览器中间层静默断开

### 1. 协作事件

- `room.updated`
- `message.created`
- `agent_session.updated`
- `agent_turn.created`
- `agent_turn.updated`
- `handoff.created`
- `handoff.updated`
- `task.created`
- `task.updated`
- `task.assigned`

### 2. 执行事件

- `run.queued`
- `run.started`
- `run.blocked`
- `run.approval_required`
- `run.failed`
- `run.completed`
- `run.output.appended`

### 3. Runtime 事件

- `runtime.online`
- `runtime.busy`
- `runtime.offline`
- `runtime.capabilities.updated`

### 4. Git / 交付事件

- `integration_branch.created`
- `merge.attempted`
- `merge.succeeded`
- `merge.conflicted`
- `delivery_pr.created`
- `delivery_pr.updated`

### 5. 通知事件

- `inbox_item.created`

规则：

- 事件名用过去式或状态变化式，禁止模糊命名
- payload 必须带 entity id、workspace id、occurred_at、actor

---

## 十、可扩展性设计

### 1. 先保留模块边界，再延后功能

True P0 不做插件平台，但要为未来保留替换点：

- CLI provider adapter interface
- Notification sender interface
- Memory writer interface
- Git host interface

原则：

- 有接口，但不做通用市场
- 有边界，但不做过度抽象

### 1.1 语言协作能力的扩展方式

True P0 不应把“Agent 会聊天”实现成 backend 内一堆 hardcode 模板。

推荐扩展方式：

- 继续复用 Codex 作为语言与执行智能
- 继续复用 `skills + OpenShock CLI`
- 在 backend 只扩：
  - Room 协作消息契约
  - agent turn 状态机
  - handoff / wait / audit / realtime

这样未来即使新增 provider，也主要替换 daemon provider adapter，而不需要推翻：

- Room 数据模型
- 协作消息契约
- Action Gateway
- CLI 契约

### 2. 模块化单体到服务化的拆分路径

如果未来需要拆服务，优先按下面顺序：

1. Local Daemon 已天然独立
2. Worker 可独立
3. Realtime fanout 可独立
4. Repo Integration 可独立

最后才考虑拆：

- Planning & Tasking
- Run Control
- Git Integration Manager

原因：

- 这三者在 P0 / P1 阶段事务耦合最强

### 3. 数据增长预期与处理

最先增长的数据会是：

- `message`
- `run_output_chunk`
- `tool_call`
- `audit_log`

P0 处理策略：

- 业务主表和大体量 append-only 表分离
- `run_output_chunk` 按 run_id + sequence 索引
- UI 默认分页 / 增量拉取
- 不做全局全文搜索

### 4. Runtime 扩展

P0 支持：

- 单 Runtime
- 多 Runtime
- 同一 Runtime 上的多执行槽

但调度策略只做最简单版本：

- capability match
- availability
- workspace / repo 归属

不做：

- 智能成本优化
- 复杂负载均衡
- 预测性调度

---

## 十一、关键风险点

### 1. 状态机竞争条件

风险：

- Task 状态、Run 状态、Integration Branch 状态会发生并发更新

后果：

- UI 显示错乱
- 重复通知
- 合并状态错误

策略：

- 明确单写模块
- 关键更新用事务
- claim / merge / webhook 全部幂等

### 2. Git 集成复杂度低估

风险：

- 多个 Task Branch 合入 Integration Branch 时，冲突频率会高于预期

后果：

- 用户体验断裂
- 集成状态不可理解

策略：

- `merge_attempt` 必须是一等对象
- 冲突必须显式建模，而不是仅靠日志文本
- Room 内必须产生结构化系统消息

### 3. daemon 与 backend 状态不一致

风险：

- daemon 认为 run 已经开始，backend 还停留在 queued
- daemon 进程崩溃但 backend 未及时感知

策略：

- run start 必须由 backend 确认 claim 成功后才允许开始
- heartbeat 超时触发 runtime 状态降级
- backend 定期做 running run reconciliation

### 4. CLI provider 差异

风险：

- 不同 CLI 的输出格式、工具调用能力、退出语义不同

策略：

- True P0 只接 Codex，先不引入多 provider 兼容层复杂度
- daemon 通过 ACP 接 Codex，再映射成统一的 execution envelope
- 后续新增 provider 时，必须同样通过 ACP 或等价适配层接入
- envelope 中至少统一：
  - stdout chunk
  - stderr chunk
  - tool call
  - final status
  - approval request

补充结论：

- 这里的 `CLI provider` 指 Agent 执行器，例如 Codex CLI
- OpenShock 自身对 Agent 暴露系统能力时，True P0 不优先做 MCP server
- True P0 优先做本地 `OpenShock CLI`，由 skills 驱动 Agent 调用
- 原因是这更贴近当前主流 agent 的工作方式，也更容易做本地调试、契约测试、审计和跨 provider 复用
- 但 `OpenShock CLI` 不允许绕过 backend / daemon 边界直接改系统真相
- 后续若需要更强的 tool discoverability 和协议化能力，可在不改变业务边界的前提下把同一能力面再包装为 MCP

### 4.1 语言协作被误实现成“普通聊天”

风险：

- Room 看起来像聊天工具，但实际上无法驱动 Agent 完成目标
- 人类发出指令后，没有明确 ack / plan / question / summary / handoff 这些正式语义

策略：

- `message.kind` 必须结构化
- `agent_turn` 必须是一等控制对象
- 语言交流的成功闭环必须可审计，而不是只看聊天文本

### 4.2 Agent 过度自主导致业务真相失控

风险：

- Agent 直接根据自由文本自行决定建 Task、发 Run、发 Merge
- 审批、权限、幂等和审计被绕过

策略：

- 高价值动作仍只能走 Action Gateway
- skills 只提供“如何调用系统”的能力，不授予绕过控制面的权限
- backend 永远只信 Action / protocol result，不直接信自由文本

### 4.3 Agent 消息洪泛

风险：

- 多个 Agent 同时汇报，Room 被低价值日志刷屏

策略：

- 进度汇报必须分级：
  - Room 只放摘要型进展
  - 细粒度 stdout/stderr 进入 run 详情
- 对同类 `progress_update` 做节流与合并
- `tool_call` 不直接原样刷入主聊天流

### 5. 日志与消息量膨胀

风险：

- Room 消息、Run 输出、审计日志会迅速增大

策略：

- 输出和消息分表
- append-only
- 默认增量拉取
- 先不做复杂搜索

### 6. 权限模型后补成本

风险：

- P0 先不做复杂权限，未来可能返工

策略：

- 现在就把授权入口集中到 policy checks
- 即使只有 owner / member 两级，也不允许把权限判断散落在 handler 里

---

## 十二、测试策略

True P0 必须采用分层测试，不接受“只跑几个端到端用例”。

### 1. 单元测试

覆盖对象：

- Task 状态流转
- Run 状态机
- Runtime claim 逻辑
- Integration Branch 聚合状态计算
- Inbox 去重规则
- Git merge result 解析

目标：

- 所有核心状态机转移都有测试
- 所有幂等入口都有测试

### 2. 模块集成测试

覆盖场景：

- CreateIssue 事务是否同时创建 Room / Channel / Integration Branch
- AssignTask 是否正确创建 Task Branch / queued Run
- Run claim 是否防双消费
- blocked / approval_required 是否正确回流 Inbox + Room
- merge success / conflict 是否正确更新 Task / Integration Branch

方法：

- 直接起真实 Postgres
- 通过 service layer 调用，不 mock DB

### 3. daemon 协议测试

覆盖场景：

- Runtime pairing
- heartbeat
- run claim
- output chunk 上报
- final result 上报
- daemon 意外中断后的恢复

方法：

- 用协议级 contract test
- backend 和 daemon 各自持有同一份协议测试样例

### 3.1 Agent 语言协作测试

覆盖场景：

- 人类在 Room 中给 Agent 下指令，Agent 回 `ack + plan`
- Agent 执行中主动发 `progress_update`
- Agent 遇阻塞发 `clarification_request`，人类回答后继续
- Agent 完成后发 `completion_summary`
- Agent A 委托 Agent B 创建 / 接管 Task
- Agent A 向 Agent B 发起 handoff，Agent B 接受并继续推进

方法：

- 使用固定 transcript fixture
- 使用 skills + CLI 的 contract test
- 验证最终留下的是：
  - 正确的 Room 消息类型
  - 正确的 Task / Run / handoff 状态
  - 正确的 audit / realtime 事件

### 4. Git 集成测试

覆盖场景：

- 创建 task branch
- 合入 integration branch 成功
- 合入冲突
- 重复 merge attempt 幂等
- delivery PR 创建前置条件判断

方法：

- 使用真实本地 Git repo fixture
- 不 mock Git 命令结果

### 5. 端到端测试

至少覆盖下面 5 条主链路：

1. 创建 Issue -> 自动生成 Room / Channel / Integration Branch
2. 创建两个 Task -> 分派两个 Agent -> 两个 Run 并行
3. 一个 Run blocked -> Inbox / Room 回流 -> 人类批准后继续
4. 一个 Task 合入成功，一个 Task 合入冲突
5. Integration Branch ready -> 创建 Delivery PR -> webhook 回写 -> Issue 完结

补充必须新增的语言协作主链路：

6. 人类在频道内给 Agent 下指令 -> Agent 回复理解和计划 -> Agent 创建 Task / Run
7. Agent 执行中汇报 -> 遇阻塞提问 -> 人类答复 -> Agent 继续
8. Agent A 与 Agent B 在 Room 中完成一次显式交接

### 6. 失败注入测试

必须覆盖：

- daemon 心跳丢失
- run claim 竞争
- webhook 重放
- merge 冲突
- DB 事务失败后的 outbox 一致性

### 7. 可观测性验收

不是传统测试用例，但属于发布前门槛。

要求至少能回答：

- 某个 Task 当前卡在哪
- 某个 Run 被哪个 Runtime claim
- 某次 merge attempt 为什么失败
- 某个 Inbox Item 是由哪个事件生成的
- 某个 Delivery PR 汇总了哪些 Task 结果

如果系统无法回答这些问题，就说明可运维性不足。

---

## 十三、发布策略

### 1. 功能开关

建议以下能力都加 feature flag：

- Task 自动创建 Run
- 自动合入 Integration Branch
- 自动发起 Delivery PR

原因：

- 这些都是高风险自动化点
- P0 需要允许先半自动运行

### 2. 渐进上线顺序

1. 单用户 + 单 Runtime + 双 Task 并行
2. 单用户 + 多 Runtime
3. 多成员协作
4. 自动集成增强

---

## 十四、建议的首批技术结论

1. 后端采用 Go 模块化单体，不拆微服务。
2. PostgreSQL 是唯一产品真相源，使用 outbox 驱动异步副作用。
3. daemon 是独立执行面，和 backend 通过 OpenShock 控制协议通信，并通过 ACP 驱动 Codex CLI。
4. `Task`、`Run`、`Task Branch`、`Integration Branch`、`Delivery PR` 都是一等技术对象。
5. 所有关键状态变化必须审计化、幂等化、可重放。
6. True P0 首个且唯一 provider 是 Codex，其他 provider 延后到后续阶段。
7. True P0 的 Room 不只是聊天 UI，而是语言驱动协作的正式控制入口。
8. P0 的复杂度中心不是“聊天视觉”，而是语言协作状态机、Git 集成和本地执行一致性。

---

## 十五、下一步设计拆分

如果继续往下做，建议按下面顺序继续产出子设计文档：

1. 数据库 schema 设计
2. daemon 协议设计
3. Run / Task / Integration Branch 状态机细化
4. Git merge orchestration 设计
5. Realtime event contract 设计
6. API 设计

顺序不要反过来。

原因：

- 如果状态机和协议没定，API 很快会漂
- 如果 Git orchestration 没定，Task / Run 的边界会持续模糊

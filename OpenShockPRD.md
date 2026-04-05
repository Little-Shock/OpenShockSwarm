# 产品需求文档 (PRD): OpenShock.ai

**版本:** 2.1 (产品对齐版)  
**版本日期:** 2026 年 4 月 5 日  
**产品定位:** 面向 AI 原生研发团队的本地优先协作操作系统  
**产品总纲:** **Slock 的壳，Multica 的骨，Lody 的隔离执行。**

---

## 一、文档目的

这份 PRD 的目标，是把 OpenShock.ai 从“多 Agent 协作平台”的抽象描述，收敛成一套更可执行的产品定义。

这次重梳理重点对齐三件事：

1. **Slock 的壳**
   - 协作入口是聊天、频道、Room、Thread、DM、Machine、Agent
   - 前端气质轻松、有趣、鲜明，不是传统企业看板
2. **Multica 的骨**
   - 控制面要有 Issue、Queue、Runtime、Inbox、Skill、Run History、PR 闭环
   - Agent 必须是系统一等对象，不只是 assignee 的一个值
3. **Lody 的隔离执行**
   - Session 是执行单元
   - Worktree 是隔离单元
   - Branch / PR 是交付单元

---

## 二、调研来源与结论

### 1. 调研来源

本次文档基于 2026 年 4 月 5 日的专项调研整理，核心参考对象包括：

- **Multica**
  - [README.zh-CN](https://github.com/multica-ai/multica/blob/main/README.zh-CN.md)
  - 本地 clone 后的代码、CLI 与 daemon 文档
- **Slock**
  - [app.slock.ai](https://app.slock.ai/)
  - 公开前端 bundle 与 CSS
- **Lody**
  - [Docs](https://lody.ai/docs.html)
  - [Workflow](https://lody.ai/docs/workflow.html)
  - [WorkTrees](https://lody.ai/docs/worktrees.html)
  - [Context, Token & Quota](https://lody.ai/docs/usage-and-quota.html)
- **Agent 记忆与插件参考**
  - [OpenClaw Memory Overview](https://docs.openclaw.ai/concepts/memory)
  - [OpenClaw Builtin Memory Engine](https://docs.openclaw.ai/concepts/memory-builtin)
  - [OpenClaw QMD Memory Engine](https://docs.openclaw.ai/concepts/memory-qmd)
  - [OpenClaw Honcho Memory](https://docs.openclaw.ai/concepts/memory-honcho)
  - [OpenClaw Dreaming (experimental)](https://docs.openclaw.ai/concepts/memory-dreaming)
  - [OpenMemory Overview](https://docs.mem0.ai/openmemory/overview)
  - [Mem0 Entity-Scoped Memory](https://docs.mem0.ai/platform/features/entity-scoped-memory)
  - [MemOS Architecture](https://memos-docs.openmem.net/open_source/home/architecture)
  - [MemOS Intro](https://memos-docs.openmem.net/home/memos_intro/)
  - [MemOS Memory Production](https://memos-docs.openmem.net/memos_cloud/introduction/mem_production)
  - [memU README](https://github.com/NevaMind-AI/memU)
  - [QMD README](https://github.com/tobi/qmd)

### 2. 一句话结论

OpenShock 不应该做成“传统看板里加一个聊天框”，而应该做成：

- **协作壳层像 Slock**
- **状态骨架像 Multica**
- **执行隔离像 Lody**

并且在记忆层上，OpenShock 也不能只依赖聊天历史，而应该采用：

- **Slock / OpenClaw 式文件记忆**
- **QMD 式本地搜索侧车**
- **Mem0 / MemOS / memU 式可插拔长期记忆与整理机制**

### 3. 三个参考对象分别教会了我们什么

#### Slock 的壳

Slock 最值得借鉴的不是单个功能，而是它的产品入口和气质：

- 默认入口是协作房间，不是 Kanban
- `channel / dm / thread / agent / machine / task` 共同构成工作台
- 有 stop / resume / follow thread / machine pairing 这类强实时协作能力
- 视觉语言轻松、有趣、鲜明，Agent 和 Machine 像“团队成员”而不是“配置项”

#### Multica 的骨

Multica 最成熟的地方在控制面：

- Agent 可被指派，是真正可管理对象
- Issue、Task Queue、Runtime、Inbox、Skill、Run History 关系清晰
- daemon、heartbeat、任务状态机、Run 日志已经验证可行
- 很适合作为 OpenShock 的后台骨架参考

#### Lody 的隔离执行

Lody 最值得借鉴的地方在执行模型：

- 一个 session 对应一个 feature/fix
- 一个 session 对应一个 worktree
- 一个 session 倾向对应一个 branch / PR
- 通过 worktree 实现并发开发的低冲突隔离
- 重视上下文窗口、token、quota 的可观测性

---

## 三、产品定义

### 1. OpenShock 是什么

OpenShock 是一个面向 AI 原生研发团队的协作操作系统。

它不是：

- 一个传统人类 PM 看板
- 一个只会聊天的 AI 群聊工具
- 一个单机 terminal wrapper

它是：

- **一个把 Agent 当队友管理的控制面**
- **一个把协作放在聊天房间中发生的前端壳层**
- **一个让多 Agent 在隔离 worktree 中并发执行的运行系统**

### 2. OpenShock 的核心命题

OpenShock 的目标不是“让 Agent 更聪明”，而是“让团队更能管理 Agent 的执行过程”。

换句话说，OpenShock 要解决的是：

1. 需求如何被拆解和派发
2. Agent 如何被组织和调度
3. 多个任务如何被安全并发执行
4. 讨论、执行、PR、Review、通知如何最终收敛成真相
5. 无状态 CLI 如何通过外部记忆保持跨 session 连续性
6. 账号、权限、仓库访问、通知投递与沙盒边界如何被系统化治理

---

## 四、目标用户与典型场景

### 1. 目标用户

- 2 至 10 人的 AI 原生研发团队
- 高频使用 Claude Code、Codex、Gemini CLI 等本地编码代理的团队
- 已经使用 GitHub / PR 流程，但多 Agent 协作混乱的团队

### 2. 典型场景

#### 场景 A：多个小需求并发推进

- PM 或负责人创建多个 Issue
- 多个 Agent 在多个 worktree 中并行执行
- 每个任务都保留 session、run、branch、PR、review 状态
- 人类通过聊天房间和 Inbox 做轻量干预

#### 场景 B：Agent 卡住，需要快速纠偏

- Agent 报告 blocked
- 系统推送 Inbox 通知
- 人类进入 Issue Room / Thread，追加指导
- 系统恢复原 session 或创建新的 follow-up run

#### 场景 C：异步夜间开发

- 团队下班前批量创建任务
- 本地 daemon 在多台机器上异步消费
- 第二天通过 Room、PR、Inbox、Review comments 集中验收

---

## 五、产品原则

### 1. Agent 必须是一等公民

Agent 不能只是一个“被分配对象”，而必须同时拥有：

- 身份与档案
- memory profile / memory binding
- provider / runtime 配置
- session / run 历史
- skill 绑定
- 评论与状态变更能力
- PR 与 review 闭环参与能力

### 2. 默认入口是协作壳，不是传统看板

- 首页优先看到 Room、Thread、Session、Inbox、Machine、Agent 状态
- 看板保留，但属于控制视图，不是产品气质中心

### 3. 一个会话只做一件事

- 一个 Session 尽量只对应一个 feature/fix
- 一个 Session 尽量只对应一个 branch / 一个 PR
- 避免长对话吞噬上下文

### 4. 真相分层，而不是单点真相

- `Issue` 是目标真相
- `Session / Run` 是执行真相
- `PR` 是交付真相
- `Inbox` 是待决策真相

### 5. 并发优先，但必须可追责

每次执行都必须明确：

- 谁在执行
- 在哪台 runtime 上执行
- 用了哪个 worktree / branch
- 开始与结束时间
- 产出了什么

### 6. 人类高于 Agent

- 人类可暂停、接管、恢复、重排优先级
- 人类可以随时对 session 注入纠偏信息
- Agent 不应在高优先级公共频道自由刷屏

### 7. 先把闭环跑通，再追求自治幻想

- MVP 不以“数字分身自治投票”作为核心卖点
- MVP 的关键是：队列、会话、隔离、通知、PR、Review

### 8. 记忆必须外置、可插拔、可治理

OpenShock 要默认接受一个现实：

- Codex、Claude Code、Gemini CLI 这类执行代理天然偏无状态
- 真正可持续的 Agent 记忆，不能寄托在模型“自己记住”
- 记忆必须被产品化成一个外部能力层

因此记忆需要满足：

- 可以被挂载到 Agent，而不是写死在某个模型里
- 可以按 user / agent / workspace / issue / session 分层隔离
- 可以被检索、写回、反馈修正、清理和审计
- 可以把高价值经验提升为 `Skill` 或 `Policy`

### 9. 账号、仓库访问、通知与执行安全是基础设施，不是边角料

OpenShock 不只是 Agent 控制台，也是一套真正面向团队上线的系统。

因此以下能力必须被产品化：

- 账号体系与 workspace 成员模型
- GitHub 连接与仓库安装模型
- 邀请、验证、重置密码、邮箱通知
- daemon / CLI 的浏览器设备授权
- run 级别的权限、密钥和沙盒配置

如果这些只停留在工程实现层，而没有进入 PRD，后面一定会返工。

---

## 六、前端体验原则

这是本次版本最重要的新增约束。

### 1. 整体气质：学 Slock，不学传统项目管理工具

OpenShock 的前端应该：

- 轻松
- 有点玩心
- 清晰但不死板
- 让 Agent 和 Machine 像角色，不像配置项

OpenShock 的前端不应该：

- 长成 Multica / Lody 那种更传统的人类任务板气质
- 长成 Jira / Linear / Asana 式首页
- 被大面积灰白卡片和严肃企业风淹没

### 2. 视觉语言方向

建议明确采用以下方向：

- 高对比、强边框、鲜明色块
- 允许 neo-brutalist / playful productivity 视觉
- 更活泼的按钮、状态块、空态、系统提示
- 更具“角色感”的 Agent / Machine 卡片

### 3. 交互优先级

首页应该优先强调：

1. 我现在在哪个协作房间
2. 哪些 Agent 正在工作
3. 哪些 Session 正在运行或卡住
4. 哪些通知需要我处理

而不是优先强调：

1. backlog 有几列
2. 哪张卡在哪一列
3. 用传统 PM 心智看待所有对象

### 4. 文案语气

前端文案要更偏：

- 直接
- 轻松
- 鼓励式
- 有行动感

少用纯企业流程术语，多用“现在发生了什么、你下一步该做什么”。

---

## 七、核心对象模型

| 对象 | 定义 | 是否 MVP 必须 |
| :--- | :--- | :--- |
| `Workspace` | 团队工作空间，隔离成员、Agent、Repo、设置 | 是 |
| `Repo` | 一个 Git 仓库接入单元 | 是 |
| `Issue` | 需求/缺陷/任务的业务对象 | 是 |
| `Room` | 与 Issue 绑定的协作讨论空间 | 是 |
| `Thread` | Room 内针对局部话题的分叉讨论 | 是 |
| `Member` | Workspace 内的人类成员，拥有角色与权限 | 是 |
| `Auth Identity` | 登录与外部身份绑定对象，如邮箱、GitHub、设备授权 | 是 |
| `Agent` | 可被指派的执行者，拥有 provider/runtime 配置 | 是 |
| `Runtime` | 可执行 Agent 的机器或环境 | 是 |
| `Session` | 一次面向单一目标的执行会话 | 是 |
| `Run` | Session 的某次具体运行记录 | 是 |
| `Worktree` | 本地执行隔离目录 | 是 |
| `Sandbox Profile` | run 的执行边界配置，如网络、文件、工具、时长、凭证注入 | 是 |
| `Branch` | 与 Session 或 Run 对应的 Git 分支 | 是 |
| `PR` | 代码交付实体 | 是 |
| `Inbox Item` | 需要人类处理或感知的通知项 | 是 |
| `Notification Endpoint` | 通知投递端点，如浏览器 push、邮箱、移动端 | 是 |
| `Skill` | 工作区级共享技能 / 操作套路 | 是 |
| `Memory Provider` | 一种记忆后端，可为内置文件、QMD、本地 MCP、外部服务 | 是 |
| `Memory Space` | 一个有边界的记忆空间，按 user / agent / workspace / issue / session 划分 | 是 |
| `Memory Item` | 一个可追溯的记忆条目，可为事实、偏好、摘要、工具轨迹、教训 | 是 |
| `Credential Profile` | Agent 或 Runtime 可用的凭证集合与注入规则 | 否，P1 |
| `Policy` | 规则、权限、开发约束、提示词模板 | 是 |
| `Digital Twin` | 人类偏好代理人格 | 否，P2 |

### 核心关系

- 1 个 `Workspace` 可包含多个 `Repo`
- 1 个 `Workspace` 可包含多个 `Member`
- 1 个 `Repo` 可包含多个 `Issue`
- 1 个 `Issue` 绑定 1 个 `Room`
- 1 个 `Issue` 可有多个 `Session`
- 1 个 `Session` 可有多个 `Run`
- 1 个 `Run` 必须绑定 1 个 `Runtime`
- 1 个 `Run` 必须绑定 1 个 `Sandbox Profile`
- 1 个 `Run` 必须绑定 1 个 `Worktree`
- 1 个 `Session` 最好只关联 1 个主 `PR`
- 1 个 `Member` 可绑定多个 `Auth Identity`
- 1 个 `Workspace` 可配置多个 `Notification Endpoint`
- 1 个 `Agent` 可挂载多个 `Memory Provider`
- 1 个 `Memory Provider` 可暴露多个 `Memory Space`
- 1 个 `Memory Space` 可绑定到 `User`、`Agent`、`Workspace`、`Issue`、`Session`
- 1 个 `Run` 可读写多个 `Memory Item`
- 1 个 `Memory Item` 可被提升为 `Skill` 或 `Policy`

---

## 八、信息架构

### 1. 外壳：Slock 式协作壳层

负责用户最先看到、最常进入的协作界面。

包含：

- 全局频道：`#all`、`#roadmap`、`#announcements`
- Issue Room：每个 Issue 一间房
- Thread：围绕具体消息、具体 run、具体 review 的分叉讨论
- DM：人类与 Agent，或人类与人类的直接沟通
- Agent / Machine presence：谁在线、谁在忙、谁被卡住
- SOS / Resume：紧急停止与恢复
- Inbox 入口与未读提示

### 2. 骨架：Multica 式控制面

负责目标、状态、身份、规则与系统真相。

包含：

- Workspace
- Members & Roles
- Account / GitHub / Device Auth
- Repo
- Issue Board
- Agent Directory
- Runtime / Machine 管理
- Notification Settings
- Secrets / Credentials
- Sandbox Policies
- Skill Library
- Memory Center
- Policy / Onboarding Spec
- Inbox 详情
- Run History
- PR / Review 回写
- Usage / Cost / Quota / Context Health

### 3. 执行：Lody 式隔离执行层

负责本地运行、并发隔离、日志采集、恢复执行。

包含：

- Local daemon
- Runtime registry
- Session runner
- Worktree manager
- CLI adapter（Claude Code / Codex / Gemini CLI / ACP-compatible tools）
- Terminal / tool-call / result streaming
- prior session / prior work_dir 复用

---

## 九、状态机设计

### 1. Issue 状态

```text
backlog -> todo -> in_progress -> in_review -> done
                           \-> blocked
                           \-> cancelled
```

### 2. Run 状态

```text
queued -> dispatched -> running -> completed
               \-> approval_required -> running
                           \-> failed
                           \-> blocked
                           \-> cancelled
```

### 3. Runtime 状态

```text
online -> busy -> offline
```

补充字段：

- heartbeat 时间
- provider 列表
- hostname / OS / daemon version
- quota / 订阅剩余量

---

## 十、关键工作流

### 工作流 A：工作区初始化

1. 用户通过邮箱验证登录或受邀加入
2. 创建 Workspace，或接受已有 Workspace 邀请
3. 连接 GitHub 身份，并安装 GitHub App 到目标仓库
4. 安装并启动本地 daemon
5. 通过浏览器设备授权绑定 daemon / CLI
6. 系统注册 Runtime，检测可用 CLI
7. 注入 Onboarding Spec / Policy / 初始 Skills

### 工作流 B：创建 Issue 并派发给 Agent

1. 用户创建 Issue
2. 系统自动生成对应 Room
3. 用户把 Issue 指派给 Agent
4. 系统将 Issue 入队为 `queued run`
5. 合适 runtime 领取任务并进入 `running`

### 工作流 C：Session 执行

1. 系统为本次 Session 分配 worktree 与 branch
2. daemon 启动目标 CLI
3. 前端实时展示：
   - stdout/stderr
   - tool call
   - 结构化消息
   - 运行状态
4. 如果重试或继续执行，优先复用 prior session / prior work_dir

### 工作流 D：PR 与 Review 闭环

1. Agent 完成代码修改
2. 系统引导或自动创建 PR
3. Issue 进入 `in_review`
4. Review comments、CI 状态、PR 状态回写到 Issue 和 Inbox
5. 如果被打回，创建 follow-up run 并提升优先级

### 工作流 E：Blocked 与人工纠偏

1. Agent 主动上报 `blocked`
2. 系统生成 Inbox Item
3. 人类进入对应 Room / Thread
4. 人类可执行：
   - 回复指导
   - 授权继续
   - 改优先级
   - 停止并改派
   - 新建 follow-up session

### 工作流 F：紧急停止与恢复

1. 人类对某个频道、Issue 或 Session 触发 `Stop`
2. 系统取消相关 queued/running run
3. 人类输入纠偏说明
4. 系统通过 `Resume` 恢复原 session 或创建新的 run

### 工作流 G：记忆回收、注入与提升

1. Agent 被派发任务时，系统先装配本次可见记忆：
   - Session 临时上下文
   - Workspace File Memory
   - 已挂载的外部 Memory Provider
2. daemon 启动 CLI 前，把可注入内容转成：
   - prompt 前置摘要
   - 工作区文件
   - 运行期可调用的 memory tools
3. Run 进行中，Agent 可搜索、读取、写入或反馈修正记忆
4. Run 结束后，系统生成结构化摘要，写回合适的 `Memory Space`
5. 后台整理任务对高频记忆做去重、压缩、打标签和提升
6. 被反复验证有效的经验，可被提升为 `Skill` 或 `Policy`

### 工作流 H：邀请、通知与恢复触达

1. Workspace owner / admin 邀请成员加入
2. 系统发送邮箱邀请，并支持复制 invite link
3. 成员完成邮箱验证、接受邀请并绑定 GitHub 身份
4. 用户可配置通知端点：
   - Inbox
   - 浏览器 Push
   - 邮箱
5. 当 run 完成、blocked、需要授权或 PR 待审阅时，系统按订阅规则投递
6. 点击通知可直接打开对应 Room / Thread / Session / PR

### 工作流 I：执行隔离与权限控制

1. 系统在 dispatch run 前确定 `Sandbox Profile`
2. `Sandbox Profile` 至少定义：
   - 文件写入边界
   - 网络访问策略
   - 可用工具白名单
   - 最大运行时长
   - 是否允许凭证注入
3. daemon 在 worktree 内启动 CLI，并应用对应限制
4. 如果 run 触发越权或敏感操作，系统进入 `approval required`
5. 审批结果写回 Inbox、审计日志与 run timeline

---

## 十一、MVP 功能范围

### P0：必须做

1. 邮箱验证登录 / Workspace 创建 / 基础成员体系
2. GitHub 连接、GitHub App 安装与 Workspace / Repo 绑定
3. 聊天壳首页：频道、Room、Thread、DM 基础框架
4. Agent、Runtime、Machine 管理
5. Issue Board + Issue Detail + Issue Room
6. Session / Run 列表与执行详情页
7. 本地 daemon pairing、heartbeat 与浏览器设备授权
8. Git worktree 隔离执行
9. Claude Code / Codex 两种 provider 接入
10. PR 创建与 Issue / Session 绑定
11. Inbox 通知中心
12. 基础浏览器通知
13. `blocked` / `failed` / `in_review` / `done` 状态闭环
14. 基础 Skill / Policy 注入
15. Workspace File Memory：`MEMORY.md`、`notes/`、`decisions/` 基础约定
16. Agent 记忆绑定配置：决定读写哪些 `Memory Space`
17. Run 结束后的基础摘要写回
18. Local Trusted Sandbox：worktree 边界、运行超时、审批闸门
19. 终端输出、工具调用、错误信息实时流

### P1：强烈建议纳入

1. Run message history / incremental fetch
2. Review comments 回写
3. Usage / token / quota 展示
4. 移动端轻观察
5. 恢复执行时复用 prior session / prior work_dir
6. 更完整的 Agent / Machine presence
7. QMD 侧车：本地文档 / session transcript 可搜索
8. OpenMemory / Mem0 / MemOS 等外部记忆插件适配
9. Memory Viewer：查看、纠正、删除和追溯记忆
10. 记忆整理任务：去重、TTL、promote-to-skill
11. 邮件通知：invite、verify、reset、blocked escalation、review reminder
12. 基础角色权限：owner / admin / member / viewer
13. Credential Profile 与加密 secrets 管理
14. Restricted Local Sandbox：网络、命令、工具白名单

### P2：后续探索

1. Cloud Sandbox
2. Digital Twin
3. 升级仲裁机制
4. 图谱记忆 / 多模态记忆
5. 更复杂的多 Agent 自动编排
6. 主动记忆代理 / 预测式记忆整理
7. Full Cloud Sandbox / ephemeral runtime
8. 更细粒度的 ABAC / 审计 / 合规策略

---

## 十二、明确不做

以下内容不进入 MVP：

- 传统 Kanban-first 首页
- 自动化政治式多 Agent 辩论系统
- 完整云端执行环境
- 通用企业 IM 替代品
- 过度复杂的知识图谱记忆系统
- 把所有记忆问题都简化成“接一个向量库”
- 黑箱式自动共享所有 Agent 记忆
- 让 Agent 在公共频道自由社交化发言

---

## 十三、技术架构建议

### 1. 推荐架构

| 组件 | 技术栈建议 | 职责 |
| :--- | :--- | :--- |
| Web App | Next.js + TypeScript | Slock 式协作壳 + 控制面 UI |
| API / Realtime Server | Go | REST API、WebSocket、任务状态机、事件广播 |
| Database | PostgreSQL | Workspace、Issue、Run、Inbox、Skill、Runtime、PR、Member、Auth 绑定 |
| Local Daemon | Go | Runtime 注册、worktree 管理、CLI 拉起、输出采集 |
| Mailer / Notification Worker | Go | 邮件投递、Push fanout、订阅规则执行 |

### 2. 核心架构原则

- MVP 不额外拆独立“Brain API”
- 先在 Go 服务里实现状态机与编排规则
- 给未来的 Digital Twin / deliberation 预留抽离空间

### 3. 借鉴映射

- **Slock 的壳**
  - Channel / Thread / Machine pairing / stop & resume / playful shell
- **Multica 的骨**
  - Issue / Queue / Runtime / Inbox / Skill / Run history
- **Lody 的隔离执行**
  - session-first workflow / worktree isolation / branch-pr alignment / usage observability

### 4. Agent 记忆与插件层

这部分是 OpenShock 成为“Agent 一等公民工具”的关键补充。

#### 记忆分层

OpenShock 的记忆不应被设计成单一数据库，而应至少分为四层：

1. **Session Memory**
   - 当前线程、当前 run、最近消息、即时中间结果
   - 生命周期短，主要用于当前执行恢复
2. **Workspace File Memory**
   - 以文件存在于仓库或工作区中，如 `MEMORY.md`、`notes/`、`decisions/`、`playbooks/`
   - 对无状态 CLI 最友好，也最容易被人类检查和纠正
3. **Search Sidecar**
   - 以 QMD 这类本地搜索侧车为代表
   - 负责把工作区外文档、历史 session transcript、团队知识库变得可搜索
4. **External Persistent Memory**
   - 以 OpenMemory / Mem0 / MemOS / memU 这类系统为代表
   - 负责跨 session、跨 agent、跨应用的长期记忆、结构化隔离与治理

#### 对无状态 CLI 的适配原则

Codex、Claude Code、Gemini CLI 这类工具本身不承担持久记忆。

OpenShock 应承担“记忆编排器”的角色：

- **执行前**：根据 Agent 配置和任务上下文，装配本次允许读取的记忆包
- **执行中**：把记忆能力暴露为文件、检索结果和工具调用
- **执行后**：把新结论、偏好、教训、工具轨迹回写到合适的 `Memory Space`

换句话说，CLI 是执行器，OpenShock 才是状态持有者。

#### 插件挂载模型

每个 `Agent` 都应支持挂载 0 到 N 个 `Memory Provider`，并声明：

- `read_scopes`
- `write_scopes`
- `recall_policy`
- `retention_policy`
- `sharing_policy`

建议的默认作用域：

- `workspace_id`
- `repo_id`
- `agent_id`
- `user_id`
- `issue_id`
- `session_id` / `run_id`

#### 统一插件接口

无论后端是文件记忆、QMD 还是 Mem0 / MemOS，OpenShock 对上层都应暴露统一能力：

- `memory.search`
- `memory.get`
- `memory.write`
- `memory.feedback`
- `memory.promote`
- `memory.forget`

其中：

- `memory.write` 用于保存事实、偏好、摘要、工具轨迹
- `memory.feedback` 用于纠正或覆盖旧记忆
- `memory.promote` 用于把稳定经验提升为 `Skill` / `Policy`
- `memory.forget` 用于删除、过期和权限撤销

#### 记忆与 Skill / Policy 的边界

这三者必须严格分层：

- `Memory`：事实、偏好、历史事件、任务摘要、工具使用痕迹
- `Skill`：可复用的执行套路和操作脚本
- `Policy`：边界、权限、规则、合规与团队约束

高价值的长期经验，应遵循：

`Memory -> curated Memory -> Skill / Policy`

而不是直接把所有聊天历史都变成提示词垃圾堆。

#### 推荐落地方向

MVP 到 P1 的建议顺序：

1. 先实现 Workspace File Memory
2. 再接入 QMD 这类本地搜索侧车
3. 再开放 OpenMemory / Mem0 / MemOS 插件接口
4. 最后再做 dreaming / proactive memory / skill evolution

### 5. 账号、邮箱、权限与执行安全

这是当前 PRD 必须补齐的另一块基础设施。

#### 账号与身份模型

建议 OpenShock 采用：

- **账号主标识：邮箱**
- **代码托管身份：GitHub 连接**
- **设备 / daemon 身份：浏览器设备授权**

原因：

- 邮箱更适合邀请、验证、重置密码和跨组织协作
- GitHub 更适合仓库授权、Issue / PR 绑定、成员映射
- daemon / CLI 不应长期持有可复制的静态 token，而应使用可撤销设备授权

#### 成员与角色

MVP 至少需要：

- `owner`
- `admin`
- `member`
- `viewer`

建议最先管住的动作：

- 安装 / 移除 GitHub App
- 邀请 / 移除成员
- 创建 / 编辑 Agent
- 修改 Skill / Policy / Memory Provider
- 审批高风险 run

#### 邮箱与通知模型

Inbox 是系统真相源，但不是唯一投递渠道。

建议拆成：

- **Inbox**：站内真相
- **Browser Push**：即时提醒
- **Email**：跨设备、跨时区、恢复访问链路

P1 前至少应覆盖这些邮件类型：

- 邮箱验证
- 邀请加入 Workspace
- 重置密码
- blocked escalation
- PR ready for review

#### GitHub 与仓库访问

建议把 GitHub 访问显式拆为两层：

1. **User-level identity**
   - 识别人是谁
   - 允许在 UI 中关联 GitHub 用户
2. **Workspace-level installation**
   - 决定哪些仓库可被 OpenShock 使用
   - 决定 Issue / PR / review comment 能否同步

不要把“登录 GitHub”误当成“完成了仓库授权”。

#### 沙盒与隔离分层

`worktree isolation` 解决的是 Git 文件冲突问题，但不等于完整沙盒。

OpenShock 需要明确区分三层：

1. **Repo Isolation**
   - 每个 session 一个 worktree / branch
2. **Runtime Isolation**
   - 每次 run 的进程、cwd、超时、并发限制
3. **Sandbox Policy**
   - 文件、网络、工具、凭证、审批边界

当前建议的路线：

- **P0**：Local Trusted Sandbox
  - 默认运行在用户自己的机器
  - worktree 隔离
  - 超时
  - 高风险动作审批
- **P1**：Restricted Local Sandbox
  - 细化网络 / 命令 / 工具白名单
  - 引入凭证注入规则
- **P2**：Cloud Sandbox
  - 真正临时化、可回收、可审计的远程运行环境

#### Secrets 与凭证

建议默认原则：

- 模型 API key 优先保留在 machine-local env
- Workspace secrets 仅在必要时引入
- 所有凭证注入都必须绑定 `Sandbox Profile`
- run timeline 中记录“注入了哪类凭证”，但不暴露具体值

---

## 十四、关键数据与实时事件

### 1. 关键数据实体

- `issue`
- `issue_room`
- `session`
- `run`
- `runtime`
- `agent`
- `skill`
- `member`
- `auth_identity`
- `github_installation`
- `sandbox_profile`
- `notification_endpoint`
- `audit_log`
- `memory_provider`
- `memory_space`
- `memory_item`
- `inbox_item`
- `pull_request`
- `review_comment`

### 2. 关键实时事件

- `message:new`
- `message:updated`
- `thread:updated`
- `run:queued`
- `run:started`
- `run:completed`
- `run:failed`
- `run:blocked`
- `run:approval_required`
- `runtime:heartbeat`
- `runtime:offline`
- `member:invited`
- `member:joined`
- `auth:device_authorized`
- `notification:delivered`
- `notification:failed`
- `memory:captured`
- `memory:promoted`
- `memory:feedback`
- `memory:provider_failed`
- `inbox:new`
- `pr:created`
- `pr:status_changed`

---

## 十五、成功指标

### 1. 产品指标

- 从创建 Issue 到首次 run 开始的时间
- 从邀请发出到成员加入成功的时间
- 单日并发运行的 Session 数
- 平均每个 Issue 的人工介入次数
- PR 自动创建率
- 跨 Session 记忆召回命中率
- 重复指令减少率
- `blocked` 任务在 24 小时内恢复率
- 运行失败后的二次成功率

### 2. 体验指标

- 用户能否在 30 秒内定位某次失败发生在哪个 session / runtime / worktree
- 用户能否在 2 分钟内从 Inbox 完成一次纠偏
- 用户能否在 5 分钟内完成设备授权并连接第一台 runtime
- 用户能否无歧义区分：
  - 目标在哪
  - 讨论在哪
  - 代码在哪
  - 卡点在哪
- 用户能否解释一条关键记忆来自哪里、被谁写入、何时更新

### 3. 设计指标

- 用户首次进入时看到的是协作壳，而不是传统看板
- 用户能一眼识别正在工作的 Agent 与 Machine
- 看板是有用的，但不会盖过 Room / Session / Inbox

---

## 十六、阶段路线图

### Milestone 1：协作壳与运行时上线

- 邮箱验证登录 / Workspace 创建 / GitHub 连接
- 成员邀请与基础角色
- Workspace / Repo / Agent / Runtime / Machine 管理
- daemon pairing
- 聊天壳首页

### Milestone 2：会话与隔离执行上线

- Session / Run 模型
- worktree 创建与销毁
- CLI provider 接入
- Workspace File Memory
- Local Trusted Sandbox
- 实时终端输出与任务状态流

### Milestone 3：控制面与闭环上线

- Issue Board
- Inbox
- Browser Push
- PR 创建与状态回写
- blocked / resume / stop

### Milestone 4：强化体验

- run history
- review 同步
- token / quota / context 可观测
- 外部记忆插件适配与 Memory Viewer
- 邮件通知与 Restricted Local Sandbox
- 移动端轻观察

### Milestone 5：高级治理

- Digital Twin
- 升级仲裁机制
- 更复杂的多 Agent 编排

---

## 十七、验收标准

MVP 的真正验收标准不是“有页面了”，而是以下闭环能在真实仓库里跑通：

1. 人类创建一个真实 Issue
2. 将 Issue 指派给 Agent
3. 系统创建 Session，并在独立 worktree 中执行
4. 前端实时展示 run、日志、状态变化
5. Agent 创建 PR，并使 Issue 进入 `in_review`
6. 系统把关键结论写回可追溯的 `Memory Space`
7. 人类通过 Room / Thread / Inbox / Memory Viewer 进行纠偏
8. 系统完成 follow-up run
9. PR 合并后，Issue 自动进入 `done`

建议的吃狗粮验收任务：

> “为 OpenShock 添加一个全局设置页，并支持查看 Runtime 状态、最近 Runs 和 Inbox 未读数。”

---

## 十八、当前开放问题

1. `Issue` 与 `Session` 的默认关系是否为 1:N 且由系统自动维护？
2. 一个 Issue 是否允许同时存在多个活跃 Session？
3. PR 是否强制一对一绑定 Session？
4. Runtime 的 provider 能力是机器级配置，还是 Agent 级覆盖？
5. Inbox 是否只面向人类，还是也支持 Agent Mailbox？
6. 公共频道的 Agent 发言规则是否做成策略配置项？
7. MVP 是否需要基础 mobile web 观察模式？
8. 默认给 Agent 挂载哪些 Memory Provider，哪些需要用户显式开启？
9. user / agent / workspace / issue / session 记忆的优先级如何合并？
10. 哪些记忆允许自动写回，哪些必须经过人类确认？
11. 记忆提升为 `Skill` / `Policy` 的阈值与审核机制是什么？
12. 账号主标识是否确定为邮箱，GitHub 是否只作为连接身份？
13. 浏览器 Push 与 Email 的默认订阅策略是什么？
14. P0 的 Local Trusted Sandbox 具体允许哪些命令与网络访问？
15. 哪些动作必须强制进入 `approval required`？
16. GitHub App 安装失败或权限不足时，是否提供 PAT / SSH fallback？
17. 计费、配额与成员席位是按 workspace、runtime 还是 provider 消耗来计？

---

## 十九、最终结论

OpenShock 的真正机会，不是做一个更会聊天的 AI 工具，也不是做一个更聪明的自动决策系统。

OpenShock 的真正机会，是把下面这件事产品化：

**让一个 AI 原生团队，既能像在聊天室里协作一样自然地和 Agent 共事，又能像在任务系统里一样清晰地管理状态，还能像在本地开发环境里一样安全地并发执行。**

因此，OpenShock 的最终定义应该被固定为：

**Slock 的壳，Multica 的骨，Lody 的隔离执行。**

这不是一句营销口号，而是后续所有产品与设计决策的判断标准：

- 如果一个功能强化了协作壳层，符合 Slock 的方向
- 如果一个功能强化了系统真相和状态骨架，符合 Multica 的方向
- 如果一个功能强化了并发隔离和执行闭环，符合 Lody 的方向

只要这三层被稳定地叠在一起，OpenShock 就有机会成为 AI 原生研发团队真正可用的协作操作系统。

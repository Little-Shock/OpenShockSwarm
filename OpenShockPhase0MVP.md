# OpenShock Phase 0 MVP 骨架功能要求

**版本:** 0.1  
**版本日期:** 2026 年 4 月 5 日  
**关联文档:** [OpenShockPRD.md](./OpenShockPRD.md)

---

## 一、文档目标

这份文档不是完整 PRD 的重复，而是把 OpenShock 的第一阶段落地成一份可执行的骨架需求。

Phase 0 的目标只有一个：

**在一个真实本地仓库里，把 `聊天壳 + Agent 管理 + Session / Run + worktree 隔离 + 基础记忆 + PR 闭环` 跑通成第一条可用主链路。**

这阶段强调：

- 先把骨架搭起来
- 先把真实链路打通
- 先让团队真的能用

这阶段不强调：

- 完整自治
- 完整云沙盒
- 复杂多 Agent 编排
- 豪华权限中心

---

## 二、Phase 0 一句话定义

Phase 0 是 OpenShock 的第一个可用骨架版本：

- 外面看起来像一个可协作的 Agent 工作台
- 里面真的能连上本地机器、拉起本地 CLI、跑出 worktree 和 run
- 最后能把结果收回到 Room、Inbox 和 PR

---

## 三、Phase 0 成功标准

只要下面这条链路跑通，Phase 0 就算成功：

1. 用户注册或登录，创建 Workspace
2. 连接 GitHub，绑定一个真实 Repo
3. 绑定一台本地 Runtime，检测到 Codex / Claude Code CLI
4. 创建一个 Issue
5. 系统自动生成对应 Room
6. 用户把 Issue 派给 Agent
7. 系统创建 Session，并在 worktree 中拉起 run
8. 前端实时显示 run 状态、日志、工具调用
9. Agent 完成修改并生成 PR
10. 人类在 Room / Thread / Inbox 中完成纠偏和验收

---

## 四、Phase 0 范围

### 1. 必须真实工作的部分

- 账号与 Workspace
- GitHub 连接与 Repo 绑定
- 本地 daemon pairing
- Runtime / Agent 管理
- Issue / Room / Session / Run 主链路
- Git worktree 隔离
- Local Trusted Sandbox
- Workspace File Memory
- Inbox
- Browser Push
- PR 创建与状态回写

### 2. 可以先做骨架或占位的部分

- DM 的复杂体验
- Agent Mailbox
- 移动端适配
- 邮件通知
- 更强的 Sandbox 细粒度控制
- 外部 Memory Provider 插件

---

## 五、用户与场景

### 核心用户

- 2 到 10 人的 AI 原生研发团队
- 高频使用本地 CLI 代理的人
- 需要让多个 Agent 在真实仓库里并行工作的人

### 核心场景

- 负责人创建任务，派给 Agent
- Agent 在本地 worktree 中执行
- 人类通过 Room 和 Inbox 做纠偏
- 结果通过 PR 回收

---

## 六、功能骨架要求

### 1. 账号、Workspace 与仓库接入

必须支持：

- 邮箱登录 / 注册 / 基础验证
- 创建 Workspace
- 连接 GitHub 身份
- 以 GitHub App 方式绑定 Repo
- GitHub App 失败时保留 PAT / SSH fallback 设计位

Phase 0 约束：

- 先支持单用户创建 Workspace
- 支持基础成员模型，但不追求完整组织治理

### 2. 本地 Runtime 与 daemon pairing

必须支持：

- 在浏览器中发起本地 daemon 配对
- Runtime 心跳上报
- 检测本地可用 CLI
- 展示 Runtime 在线 / 离线 / 忙碌状态

Runtime 能力模型：

- Runtime 负责暴露机器上真实存在的 CLI 能力
- Agent 只负责偏好与默认 provider 选择

### 3. Agent 管理

必须支持：

- 创建 Agent
- 配置 Agent 名称、说明、默认 provider 偏好
- 配置 Agent 读写哪些基础 Memory Space
- 查看 Agent 当前状态与最近 Runs

Phase 0 不做：

- 复杂人格系统
- 多层技能市场

### 4. 聊天壳首页

首页必须默认呈现协作壳，而不是 Kanban。

必须有：

- 左侧：频道 / Room 列表
- 中间：消息流 / Thread 入口
- 右侧：Issue / Agent / Runtime / Session 上下文

首页必须让用户一眼看到：

- 我在哪个 Room
- 哪些 Agent 在工作
- 哪些 Session 正在运行
- 哪些任务卡住了

### 5. Issue、Room、Session、Run

必须支持：

- 创建 Issue
- Issue 自动生成对应 Room
- 一个 Issue 下允许多个活跃 Session
- Session 列表
- Run 列表
- Run Detail 页面

关键约束：

- `Issue -> Session` 默认 `1:N`
- `PR` 不强制一对一绑定 `Session`
- 更推荐以 `Room / Workroom` 聚合交付

### 6. 执行详情页

Run Detail 必须展示：

- 当前状态
- 当前 Runtime
- 当前 worktree / branch
- stdout / stderr
- tool call
- 时间线
- 错误信息
- 是否进入 `approval_required`

### 7. Local Trusted Sandbox

Phase 0 沙盒不是完整云沙盒，而是本地可信沙盒。

必须做到：

- 每个 Session 独立 worktree
- run 有超时
- 可以定义高风险动作审批
- 默认继承本地 Codex / Claude Code CLI 配置

默认进入 `approval_required` 的动作：

- 强制删除
- 破坏性 Git 操作
- 越界写入
- 敏感凭证注入

### 8. Workspace File Memory

Phase 0 默认只做文件级记忆。

必须支持：

- 在工作区中维护 `MEMORY.md`
- 支持 `notes/`
- 支持 `decisions/`
- run 结束后把摘要自动写回

不要求：

- 向量数据库
- 图谱记忆
- 跨应用长期记忆

### 9. Inbox 与通知

必须支持：

- Inbox 列表
- `blocked`、`approval_required`、`review pending` 等事件入站
- 基础 Browser Push

默认通知策略：

- Inbox 收全部系统事件
- Browser Push 只推送高时效事件
- Email 暂不进入 Phase 0 必做

### 10. PR 闭环

必须支持：

- 从 Run / Room 进入 PR 创建
- PR 与 Issue / Room 绑定
- PR 状态回写
- Review 状态回写到 Issue / Inbox

---

## 七、前端实现要求

### 1. 视觉参考顺序

前端实现时的参考优先级：

1. **Slock**
   - 主参考，负责气质、信息密度、Agent / Machine 主角感
2. **awesome-design-md**
   - 作为可复制的 `DESIGN.md` 参考库
3. **现有 PRD 的前端体验原则**

### 2. awesome-design-md 的使用方式

我已经把仓库 clone 到本地：

- [__external_awesome_design_md](/E:/00.Lark_Projects/00_OpenShock/__external_awesome_design_md)

它不是一个标准 Codex `SKILL.md` 仓库，更像一个 `DESIGN.md` 语料库，所以当前不把它当成可直接安装的 Codex skill 使用。

Phase 0 前端建议优先参考这几套：

- `voltagent`
  - 开发者原生、终端感、强信号 UI
- `posthog`
  - 轻松、有玩心、反企业模板化
- `lovable`
  - 更有人味、柔和但不弱

不建议参考：

- `linear.app`
  - 太容易把 OpenShock 做回传统任务工具

### 3. 视觉约束

必须遵守：

- 默认首页不是传统看板
- Agent 和 Machine 不是“配置项”，而是主角对象
- 避免 Jira / Linear / Asana 气质
- 避免大面积灰白企业卡片
- 允许更强烈的边框、色块、角色感和轻松文案

---

## 八、前端开发流程建议

### 1. 推荐流程

Phase 0 前端开发建议采用浏览器在环的快速迭代方式：

1. 先写页面骨架
2. 本地跑起来
3. 立即在浏览器里看真实页面
4. 一边改代码，一边看布局、状态、空态、响应式
5. 用真实数据或高保真假数据校验

### 2. Carbonyl 的位置

可以参考：

- [Carbonyl](https://github.com/fathyb/carbonyl)

它适合：

- 远程 SSH 环境
- 只有终端可用的开发场景
- 快速看网页是否能正常打开

但它不是我们当前桌面开发环境的主工作流。当前更适合：

- 常规桌面浏览器做主预览
- Carbonyl 作为补充工具

说明：

我没能直接可靠读取你给的那条 X 帖子原文，所以这里不引用它的具体话术，只吸收“前端开发要浏览器在环、快速验证”的方向。

---

## 九、明确不做

Phase 0 不做：

- Cloud Sandbox
- 外部记忆插件平台
- 完整邮件通知体系
- 复杂 Agent Mailbox 协议
- 高级计费后台
- 多租户企业权限中心
- 三巨头委员会自动仲裁

---

## 十、页面清单

Phase 0 至少需要这些页面或主视图：

- 登录 / 注册 / Workspace 创建
- Repo 连接页
- Runtime / Machine 配对页
- 聊天壳首页
- Issue 列表页
- Issue 详情页
- Room 详情页
- Session / Run 列表页
- Run Detail 页
- Agent 列表 / Agent 详情
- Inbox
- 全局设置页

---

## 十一、验收要求

### 功能验收

- 可以从浏览器完成账号进入、Repo 绑定、Runtime 配对
- 可以创建 Issue 并看到自动生成的 Room
- 可以派发给 Agent 并跑出 Session / Run
- 可以看到 worktree、branch、日志、工具调用
- 可以回收到 PR
- 可以从 Inbox 完成一次纠偏

### 体验验收

- 首页第一眼是 Agent 协作壳，不是传统看板
- 用户能在 30 秒内定位一个失败 run
- 用户知道当前哪个 Agent 在跑、跑在哪台机器上

---

## 十二、Phase 0 之后

Phase 0 完成后，下一阶段优先顺序建议为：

1. 邮件通知
2. Agent Mailbox
3. Restricted Local Sandbox
4. QMD 侧车
5. 外部 Memory Provider 插件

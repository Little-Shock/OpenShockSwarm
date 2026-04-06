# 产品需求文档 (PRD): OpenShock.ai

**版本:** 3.0
**版本日期:** 2026 年 4 月 6 日
**产品定位:** 面向 AI 原生研发团队的本地优先协作操作系统  
**产品总纲:** **Slock 的壳，Multica 的骨，Lody 的 worktree 隔离。**

---

## 一、文档目的

这份 PRD 不再把“愿景、参考栈、未来能力、当前代码”混写。

它只负责 3 件事：

1. 定义 OpenShock 是什么
2. 锁定 Phase 0 的产品边界
3. 明确 **当前仓库真值** 与 **下一阶段目标** 的分界线

---

## 二、当前仓库真值

### 1. 仓库里已经存在的三段式架构

OpenShock 当前仓库不是纯前端稿，而是三段式基线：

- `apps/web`
  - Next.js 16 + React 19 前端壳
- `apps/server`
  - Go 控制面 API
  - 文件状态存储
  - repo binding / GitHub readiness / runtime pairing / issue-room-run-session control surface
- `apps/daemon`
  - Go 本地 runtime bridge
  - 本地 CLI 执行
  - 流式执行
  - `git worktree` lane ensure

### 2. 当前用户已经能看到的前台模型

Web 当前已经有这些一等入口：

- `Chat`
- `Board`
- `Inbox`
- `Issues`
- `Rooms`
- `Runs`
- `Agents`
- `Setup`
- `Settings`

这说明 OpenShock 当前的产品基线，已经是一个 chat-first 的协作壳，而不是只剩一页 landing。

### 3. 当前控制面已经能做什么

Server 当前已经支持：

- 读取 workspace、channels、issues、rooms、runs、agents、sessions、inbox、memory、pull requests
- 创建 issue，并同时生成：
  - issue
  - room
  - run
  - session
  - branch / worktree 命名
- 调 daemon 创建 worktree lane
- 更新 pull request 状态
- 读取并更新 runtime pairing 状态
- 读取并更新 repo binding
- 探测 GitHub CLI / remote readiness
- 转发同步执行与流式执行

### 4. 当前 daemon 已经能做什么

Daemon 当前已经支持：

- 报告 runtime heartbeat
- 探测 `codex` / `claude`
- 同步 prompt 执行
- 流式 prompt 执行
- worktree ensure

### 5. 当前已经落地的文件级记忆

Server 在当前仓库里已经会维护：

- `MEMORY.md`
- `notes/`
- `decisions/`
- `.openshock/agents/<agent>/...`

也就是说，Phase 0 的“文件级记忆”在这个仓库里已经不是空概念，而是明确进入了 scaffold 和写回路径。

---

## 三、OpenShock 的产品定义

### 1. OpenShock 不是

- 不是传统人类任务看板上加一个聊天窗
- 不是单纯的 CLI wrapper
- 不是只会展示 mock 截图的前端壳

### 2. OpenShock 是

- 一个把 `Channel / Room / Topic / Run / Inbox / Agent / Machine` 放进同一操作系统里的协作壳
- 一个把 Agent 当成一等对象管理的控制面
- 一个让本地 runtime、CLI 执行和 worktree 隔离进入产品模型的系统

### 3. OpenShock 的核心命题

OpenShock 不试图先解决“Agent 是否足够聪明”，而是先解决：

1. 任务如何从聊天升级成可执行 lane
2. Agent 如何在房间、Run、PR、Inbox 之间留下可追的真相
3. 多条执行 lane 如何在 worktree 中低冲突并行
4. 人类如何在最少上下文切换里介入、审批、review 和收口

---

## 四、产品原则

### 1. 默认入口是协作壳

首页优先看到：

- 频道
- 讨论间
- Agent / Machine 在线状态
- 当前 issue / room / run 的上下文

看板存在，但不是产品主气质。

### 2. Agent 是一等公民

Agent 不应该只表现为一个 assignee 字段。

Agent 必须拥有：

- 名称与描述
- provider 偏好
- runtime 偏好
- memory spaces
- recent runs
- lane / mood / state

### 3. Run 是执行真相

只要进入执行，就必须能回答：

- 哪个 issue / room / topic
- 哪个 agent / runtime / machine
- 哪条 branch / worktree
- stdout / stderr / tool call / timeline / next action

### 4. Inbox 是人类决策面

Inbox 不是报错垃圾桶，而是人类判断：

- blocked
- approval
- review
- status upgrade

的统一入口。

### 5. Worktree 是并发隔离单元

Phase 0 默认按 lane 创建 worktree，而不是把多条任务揉进同一个源码目录。

### 6. 记忆必须外置

Phase 0 默认只做文件级记忆，但这条原则已经成立：

- 记忆不能只活在对话历史里
- 记忆必须能被写回、检查、审计和清理

---

## 五、Phase 0 目标

### 1. Phase 0 的一句话目标

把 `聊天壳 + 控制面 + 本地 runtime + worktree lane + 基础记忆 + PR 状态` 收成一条可运行、可验证、可继续扩展的本地基线。

### 2. Phase 0 当前必须成立的主链路

1. 用户打开 web 壳
2. 在 Setup 页看到 repo、GitHub readiness、runtime pairing 和 live bridge
3. server 与 daemon 在线
4. 系统能创建 issue
5. issue 自动生成 room / run / session
6. daemon 能为这条 lane 创建 worktree
7. room / run detail 能显示执行真相
8. PR 状态和 Inbox 决策可在壳层继续收口

### 3. Phase 0 当前的成功标准

不是“概念上像 OpenShock”，而是这几个事实要同时成立：

- web 可以跑
- server 可以跑
- daemon 可以跑
- repo binding / GitHub readiness / runtime pairing 有真实接口
- issue 创建能推进到 room / run / session / worktree lane
- bridge 能走到本地 CLI
- 所有这些状态都能在前台看到

---

## 六、当前明确不算已完成的部分

下面这些能力在产品方向上成立，但 **当前仓库还不能写成“已完成”**：

- 邮箱登录 / 完整 workspace 成员系统
- GitHub App 安装与 webhook 流
- 真实远端 PR 创建与状态同步
- 完整审批中心
- 浏览器 push / 邮件通知生产化
- 多 runtime 调度器
- 长期自治、多 Agent 协商和自动 merge

这些都应该写成“下一阶段目标”，不能写成“仓库当前真值”。

---

## 七、当前用户画像与场景

### 用户画像

- 2 至 10 人的 AI 原生研发团队
- 高频使用本地 CLI 代理的人
- 需要让 issue、room、run、PR、runtime 真相收束到同一个操作台的人

### 典型场景

#### 场景 A：本地 Phase 0 演示

- 打开 Setup
- pair runtime
- 检查 repo / GitHub readiness
- 发送一条 bridge prompt

#### 场景 B：创建新 issue lane

- 创建 issue
- 系统生成 room / run / session
- daemon 创建 worktree
- 人类从 room 和 run detail 继续跟进

#### 场景 C：人类介入与收口

- blocked / approval / review 事件进入 Inbox
- 人类跳回 room / run detail
- PR 状态继续在控制面里推进

---

## 八、Phase 0 之后的方向

如果当前基线稳定，下一阶段再继续：

1. 把 mock/seed 状态逐步替换成真实 repo / GitHub / runtime 真值
2. 把 PR 创建从“本地状态对象”升级成真实远端闭环
3. 把审批、通知和多 runtime 调度正式产品化
4. 把 file memory 进一步收成可治理的 memory subsystem

---

## 九、参考文档

- [Phase 0 MVP](./Phase0-MVP.md)
- [Runbook](../engineering/Runbook.md)
- [Research Index](../research/README.md)
- [Reference Stack](../research/Reference-Stack.md)
- [Slock Local Notes](../research/Slock-Local-Notes.md)
- [DESIGN.md](../../DESIGN.md)
- [SOUL.md](../../SOUL.md)

# Docs

这份索引只做一件事：告诉你 **OpenShock 当前仓库真值** 应该去哪里看。

如果根 README 负责项目入口，这里就负责文档分层和“哪份文档是合同、哪份只是参考”。

## 先看哪几份

### 入口级

- [README](../README.md)
  - 项目是什么、当前仓库真值、启动入口、最小验证
- [Runbook](./engineering/Runbook.md)
  - Phase 0 本地怎么跑、怎么 pair runtime、怎么走最小验收链路

### 产品合同

- [PRD](./product/PRD.md)
  - OpenShock 的产品定义、Phase 0 边界、当前已落地 / 未落地能力
- [Phase 0 MVP](./product/Phase0-MVP.md)
  - 第一轮执行范围、验收门、Review/Merge 前要过什么

### 设计与品牌

- [DESIGN.md](../DESIGN.md)
  - 设计约束主文件，前端实现优先读它
- [Design Notes](./design/README.md)
  - 设计侧补充记录
- [Hero Asset](./assets/openshock-hero.png)
  - 当前 README hero 图

### 调研与参考

- [Research Index](./research/README.md)
- [Reference Stack](./research/Reference-Stack.md)
- [Slock Local Notes](./research/Slock-Local-Notes.md)

## 当前仓库真值应该怎么读

### 已落地能力

- web 壳：Next.js 16 / React 19，路由和控制面已接到当前 Phase 0 shell
- server：Go API + 文件状态存储，支持 workspace / issue / room / run / agent / inbox / session / PR / runtime pairing / repo binding / GitHub probe
- daemon：Go 本地 runtime bridge，支持 CLI 探测、prompt 执行、流式执行、worktree ensure

### 还不能在文档里写成“已完成”的能力

- 真实 GitHub PR 创建
- GitHub App 安装流
- 邮箱登录与完整 workspace 权限系统
- 生产级 realtime
- 真正的多 Agent 自治编排

如果某份文档把这些写成“已经做完”，那份文档就是漂了。

## 应用级 README

- [apps/web/README.md](../apps/web/README.md)
- [apps/server/README.md](../apps/server/README.md)
- [apps/daemon/README.md](../apps/daemon/README.md)

它们更适合回答某一个应用自己的实现边界，不替代产品合同。

## 文档维护规则

- 根 README 只写入口级真值，不堆未来路线图
- PRD 写产品合同，但必须显式区分“当前仓库基线”和“下一阶段目标”
- Phase 0 MVP 只写第一轮必须交付和验收门，不写超出当前 repo 的幻想
- Runbook 只能写当前仓库实际能跑的启动方式和验证步骤
- Research 文档允许更宽，但不能冒充“已落地功能说明”

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
  - OpenShock 的完整产品基线，恢复到最初全量 PRD 口径
- [Phase 0 MVP](./product/Phase0-MVP.md)
  - 当前仓库实现切片、第一轮执行范围、验收门
- [Product Checklist](./product/Checklist.md)
  - 按 PRD 拆开的合同项、当前状态与 GAP
- [Execution Tickets](./product/Execution-Tickets.md)
  - 未完成功能的 canonical ticket backlog，按落地顺序和测试用例对齐
- [To Do List](./product/TODO-List.md)
  - 基于 Checklist 收敛出来的近期推进顺序和开票规则
- [Team Execution Directive](./product/Team-Execution-Directive.md)
  - 后续团队继续推进时的统一执行指令、交付格式与 merge gate

### 测试与验证

- [Testing Index](./testing/README.md)
  - 当前全部测试报告、headed harness 和证据入口
- [Test Cases](./testing/Test-Cases.md)
  - 按 `PRD -> Checklist -> Test Case` 整理的全量验证项
- [Test Report 2026-04-08 Work Shell Smoke](./testing/Test-Report-2026-04-08-work-shell-smoke.md)
  - 这轮 `chat / setup / issues / memory / inbox / board / room / run` 统一壳层走查结果

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
- [Upstream Branch Harvest 2026-04-10](./research/Upstream-Branch-Harvest-2026-04-10.md)

## 当前仓库真值应该怎么读

### 已落地能力

- web 壳：Next.js 16 / React 19，路由和控制面已接到当前 Phase 0 shell
- server：Go API + 文件状态存储，支持 workspace / issue / room / run / agent / inbox / session / PR / runtime pairing / repo binding / GitHub probe
- server：GitHub PR 路径已支持按 effective auth path 在 `gh CLI / GitHub App` 间切换，并带 contract tests
- daemon：Go 本地 runtime bridge，支持 CLI 探测、prompt 执行、流式执行、worktree ensure
- memory：artifact detail / version / governance contract 已有后端与测试基线
- 审批与通知：approval center lifecycle、browser push / email delivery 已有浏览器级证据
- 执行控制：stop / resume / follow-thread、多 runtime scheduler / failover 已有浏览器级证据
- 前端壳：real quick search、DM / followed / saved、room workbench、profile drill-in、board planning mirror 都已有 headed evidence
- onboarding / mailbox / multi-agent：模板 onboarding、Agent Mailbox、governance topology、config persistence 都已有当前主线验证证据
- control-plane / runtime replay：版本化 `/v1/control-plane/*`、`/v1/runtime/publish*`、runtime replay evidence packet 与 Windows Chrome 有头证据已经补齐
- no-shadow-truth：visible truth hygiene、dirty projection fail-closed 与 `verify:web` regression gate 已进入主线
- profile / secrets：Agent profile editor、machine capability binding、credential profile / encrypted secret scope 已接到同一份 live truth

### 还不能在文档里写成“已完成”的能力

- `app.slock.ai` 式 profile-grade 入口和更细的主壳气质仍能继续抠细
- onboarding 的 identity chain 还没和模板 bootstrap 完全并成一条首次启动旅程
- PM / Architect / Splitter / Developer / Reviewer / QA 等 team topology 还没做成正式可配置团队模板
- memory provider health / recovery 已有正式产品面和 Windows Chrome 证据，但真实 remote external provider、cleanup orchestration、workspace plan / retention 仍在后续 backlog
- restricted sandbox profile / network / tool policy 还没全部完成
- delivery entry / release-ready contract / handoff note 还没完全收成单一标准

如果某份文档把这些写成“已经做完”，那份文档就是漂了。

## 应用级 README

- [apps/web/README.md](../apps/web/README.md)
- [apps/server/README.md](../apps/server/README.md)
- [apps/daemon/README.md](../apps/daemon/README.md)

它们更适合回答某一个应用自己的实现边界，不替代产品合同。

## 文档维护规则

- 根 README 只写入口级真值，不堆未来路线图
- PRD 写完整产品合同；当前仓库实现边界由 Phase 0 MVP 和 Checklist 承接
- Phase 0 MVP 只写第一轮必须交付和验收门，不写超出当前 repo 的幻想
- Checklist 必须把“已完成 / 部分完成 / 未完成”分清楚
- Test Cases 必须能追溯回 Checklist，而不是零散 checklist
- Runbook 只能写当前仓库实际能跑的启动方式和验证步骤
- Research 文档允许更宽，但不能冒充“已落地功能说明”

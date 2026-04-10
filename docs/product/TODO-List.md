# OpenShock To Do List

**版本:** 0.9
**更新日期:** 2026 年 4 月 11 日
**关联文档:** [PRD](./PRD.md) · [Product Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、这份文档现在只做什么

- 只维护当前最需要推进的 GAP、优先级和推荐顺序
- 不再把“完整产品范围”和“当前已完成实现”混在一起
- 不再把“contract 已落地”和“浏览器级 / 线上级闭环已验证”混写

如果 live board 和文档冲突：

- 实时状态以 live board 为准
- 需求边界以 `PRD + Checklist` 为准
- 测试结论以 `Test Report` 为准

---

## 二、当前已经站住的基线

- 统一 workspace shell 已站住:
  - `chat / inbox / board / setup / issues / runs / agents / memory / access / settings` 已共享同一套壳体
  - `Chat / Work` 顶部切换、同源 `/api/control/*` proxy、work surface 去白缝与密度收紧已完成当天有头走查
- 消息工作面已站住:
  - real quick search、DM / followed / saved、room workbench、topic route、mobile inbox triage 都已有 headed evidence
- profile / onboarding / mailbox 已站住:
  - Agent profile editor、machine capability binding、scenario onboarding、Agent Mailbox、多 Agent governance、config persistence 都已有当前主线验证
- Setup 主链、runtime pairing 冷启动一致性、release smoke gate 已站住
- 真实远端 PR browser loop、signed webhook replay 已站住
- login / session / invite / member role / action-level authz matrix 已站住
- approval center、notification delivery、memory governance、memory correction / cleanup、credential profile、stop/resume/follow-thread 已站住
- multi-runtime scheduler / active lease / offline failover 已站住

这些能力的详细验收见 [Product Checklist](./Checklist.md) 和 [Testing Index](../testing/README.md)。

---

## 三、本轮已收口 / 当前必须先收的 GAP

### 2026-04-10 已收口

- `GAP-24 / TKT-61`
  - routing policy、escalation SLA、notification policy、response aggregation audit 已落到同一份 workspace governance truth，并有 Windows Chrome 有头证据。
- `GAP-28 / TKT-58`
  - 版本化 `/v1/control-plane/commands`、`/events`、`/debug/commands/:id`、`/debug/rejections` contract 已站住，并覆盖 idempotency / stable error family / browser readback。
- `GAP-29 / TKT-59`
  - live truth hygiene、dirty projection fail-closed 与 `verify:web` regression gate 已形成 no-shadow-truth 主线约束。
- `GAP-30 / TKT-60`
  - `/v1/runtime/publish`、cursor dedupe、replay evidence packet、run detail replay panel 已形成可回放 contract。

### 2026-04-11 已收口

- `GAP-21 / TKT-39`
  - review comment / review thread / changes requested 现在会稳定回写到 PR conversation ledger，并且 Inbox、Room PR tab、PR Detail 已统一深链到同一条 review 上下文。
- `GAP-22 / TKT-41`
  - run / room / workspace 三层 usage、quota、retention 与 warning 已进入正式产品面，并已有 Windows Chrome 有头证据，不再只停在 smoke / logs / setup 边栏。

### 当前必须先收的 GAP

### GAP-23 Invite / Verify / Reset Notification Template Delivery

- 现状:
  - device auth、verify、reset、identity binding 已进入产品
  - 但通知模板、恢复触点和首次启动旅程还没完全并成一条链
- 对应票:
  - `TKT-44`
- 相关合同:
  - `CHK-11`
  - `CHK-13`
  - `CHK-20`
- 优先级: P1

### GAP-25 Restricted Local Sandbox / Network / Tool Policy

- 现状:
  - destructive guard、secret boundary、credential profile 已站住
  - 但 restricted sandbox profile、network/tool allowlist 还没有正式产品面
- 对应票:
  - `TKT-46`
- 相关合同:
  - `CHK-12`
  - `CHK-15`
- 优先级: P1

### GAP-26 Workspace Plan / Usage Limit / Retention Surface

- 现状:
  - 当前 workspace limits 仍主要藏在默认值和内部 truth 里
  - 用户还看不到 plan、usage、retention 的正式汇总面
- 对应票:
  - `TKT-48`
- 相关合同:
  - `CHK-15`
  - `CHK-22`
- 优先级: P2

### GAP-27 Delivery Entry / Release Gate / Handoff Contract

- 现状:
  - headed suite、Windows Chrome 全量报告、runbook 都已存在
  - 但 release-ready、handoff note、customer-facing evidence 还没收成单一合同
- 对应票:
  - `TKT-49`
- 相关合同:
  - `CHK-15`
  - `CHK-21`
- 优先级: P2

---

## 四、推荐推进顺序

1. `TKT-39` `TKT-41` 已收口；下一批先做 `TKT-44`，把恢复通知链、invite / verify / reset 和 template bootstrap 收成同一条首次启动旅程。
2. 接着做 `TKT-46`，把 restricted sandbox、network / tool policy 收成正式配置面。
3. 再做 `TKT-48`，把 workspace plan / usage limit / retention 拉到正式产品面。
4. 最后做 `TKT-49`，把 release-ready / handoff contract 收成交付闭环。

---

## 五、这轮知识回收带来的新增要求

- 以后再看历史平行分支，默认顺序是:
  - `eng01/pr1-head-regression-fix`
  - `feat/initial-implementation`
  - `eng01/batch6-83`
  - `feat/tff`
- 允许吸收的是:
  - `/v1` contract、debug / replay read-model、runtime publish cursor、staged backlog 拆法、局部组件拆分
- 不允许吸收的是:
  - 旧 JS `apps/server / apps/shell` 主体代码
  - `tff` 的 dashboard 气质
  - 提前把 hosted billing / subscription 拖回当前主线

---

## 六、每张执行票最少要写清什么

- `Goal`
- `Scope`
- `Dependencies`
- `Self-Check`
- `Review Gate`
- `Merge Gate`
- `Related Checklist IDs`
- `Related Test Case IDs`

没有这 8 项，不进入 active execution。

---

## 七、每一轮固定 Loop

每一轮开发固定按这个顺序：

1. PI / 架构锁 active batch
2. owner claim 并实现
3. owner 自测并贴证据
4. reviewer 只报 blocker / no-blocker
5. blocker 按最小范围回补
6. reviewer 重核
7. `in_review -> done`
8. round-end verify / push / board 清绿
9. 立刻起下一轮 planning 票

不允许停在：

- 只有口头同步，没有仓库文档
- 只有实现，没有 reviewer 证据
- 只有 reviewer PASS，没有板面收口
- 当前 batch 刚结束，下一轮却没人开票

---

## 八、维护规则

- 每一轮收口后，先更新这份文档，再开下一轮 planning 票
- 如果 live board 已经收掉某条 face，对应条目要同步从“下一步”挪到“已完成”
- 如果 backlog 方向变了，必须先更新这里，再去频道口头宣布

这份文档的目标不是写愿景，而是让大家下一次开票时不需要重新争论：

- 现在已经做完了什么
- 还剩哪些 face
- 下一张票该怎么开

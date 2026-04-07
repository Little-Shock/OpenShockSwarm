# OpenShock Execution Tickets

**版本:** 1.0
**更新日期:** 2026 年 4 月 7 日
**关联文档:** [PRD](./PRD.md) · [Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、使用方式

- 这份文档只承接 **未完成功能** 的 canonical ticket backlog。
- 已完成能力继续以 [Checklist](./Checklist.md) 和记实测试报告为准，不再重新起票。
- 每张票必须绑定对应 `Checklist` 和 `Test Case`，否则不能 claim。

### 状态定义

- `todo`: 还没开始
- `active`: 已 claim，正在实现
- `review`: 已提测，等待 reviewer / QA
- `done`: 已过 gate 并进入主线

---

## 二、P0 收口票

## TKT-01 Runtime Pairing 冷启动一致性

- 状态: `todo`
- 优先级: `P0`
- 目标: 修复 server 冷启动后 pairing URL 与真实 daemon 漂移的问题，保证 Setup 首跳不 502。
- 范围:
  - server pairing state 选取与 heartbeat 同步
  - pairing GET truth 与 exec bridge truth 对齐
  - regression tests
- 依赖: 无
- Done When:
  - 非默认 daemon 端口启动时，`GET /v1/runtime/pairing` 与 `POST /v1/exec` 首次即一致
  - 相关 contract tests 通过
- Checklist: `CHK-04` `CHK-14`
- Test Cases: `TC-004` `TC-021` `TC-026`

## TKT-02 Release Gate 与 Smoke Hardening

- 状态: `todo`
- 优先级: `P0`
- 目标: 让 `ops:smoke` 和 release gate 真正能挡住 pairing 漂移，而不是假绿。
- 范围:
  - `scripts/ops-smoke.sh`
  - release gate pairing truth check
  - Runbook / Observability 更新
- 依赖: `TKT-01`
- Done When:
  - pairing URL 漂移时 smoke 失败
  - release gate 输出能明确指出失败原因
- Checklist: `CHK-15`
- Test Cases: `TC-021`

## TKT-03 Headed Setup 主链 E2E

- 状态: `todo`
- 优先级: `P0`
- 目标: 建立非无头浏览器自动化，串起 Setup 主链和基础 product shell。
- 范围:
  - headed browser automation harness
  - Setup repo binding / GitHub readiness / runtime pairing / bridge
  - 安全的 screenshot / evidence 输出
- 依赖: `TKT-01` `TKT-02`
- Done When:
  - headed 模式能稳定回放 Setup 主链
  - 报告里有截图、步骤、结果
- Checklist: `CHK-04` `CHK-15`
- Test Cases: `TC-001` `TC-002` `TC-003` `TC-026`

---

## 三、GitHub 闭环票

## TKT-04 GitHub App Onboarding 与 Repo Binding UX

- 状态: `todo`
- 优先级: `P1`
- 目标: 把当前 effective auth path 和 install state，收成真正可操作的 GitHub App onboarding 体验。
- 范围:
  - Setup 中的 installation action、missing fields、repo binding blocked contract
  - 文档和运维配置说明
  - 浏览器回放证据
- 依赖: `TKT-03`
- Done When:
  - 用户能从 Setup 明确看到缺什么、去哪装、装完后怎么回来
  - repo binding 在 app 未安装时给出清晰 blocked contract
- Checklist: `CHK-04` `CHK-07`
- Test Cases: `TC-015` `TC-022` `TC-026`

## TKT-05 Webhook Replay / Review Sync 实机验证

- 状态: `todo`
- 优先级: `P1`
- 目标: 把 webhook ingest、review/comment/check/merge 事件写回，从 contract test 推进到实机验证。
- 范围:
  - webhook replay fixture
  - signature verify / normalization
  - state / inbox / room / PR reconciliation
- 依赖: `TKT-04`
- Done When:
  - webhook 事件回放能更新 PR / inbox / room
  - 错误态有显式 observability
- Checklist: `CHK-07`
- Test Cases: `TC-015` `TC-025`

## TKT-06 真实远端 PR 浏览器安全闭环

- 状态: `todo`
- 优先级: `P1`
- 目标: 在安全测试仓库里验证从 room 发起 PR、sync、merge 的浏览器级闭环。
- 范围:
  - safe test repo / branch hygiene
  - PR create / sync / merge happy path
  - review decision / failure path evidence
- 依赖: `TKT-04` `TKT-05`
- Done When:
  - 浏览器级和 API 级证据都能证明远端 PR 闭环真实可用
  - failure path 不会静默吞掉
- Checklist: `CHK-07`
- Test Cases: `TC-016` `TC-022` `TC-025` `TC-026`

---

## 四、身份与权限票

## TKT-07 登录 / Session Foundation

- 状态: `todo`
- 优先级: `P1`
- 目标: 收住登录、会话和基础身份链，结束“只有读取面、没有真实登录”的状态。
- 范围:
  - login / logout / session lifecycle
  - session persistence
  - access 页面与 server contract
- 依赖: 无
- Done When:
  - 用户能完成登录并拿到真实 session
  - 非登录态和登录态行为可区分
- Checklist: `CHK-13`
- Test Cases: `TC-012` `TC-014`

## TKT-08 Workspace Invite / Member / Role

- 状态: `todo`
- 优先级: `P1`
- 目标: 把 workspace member、invite、role 管理做成真实团队能力。
- 范围:
  - invite / accept
  - member roster
  - role change UI + API
- 依赖: `TKT-07`
- Done When:
  - workspace 成员能被邀请、加入、调整角色
  - 权限变化在 UI 和 API 同时生效
- Checklist: `CHK-13`
- Test Cases: `TC-014` `TC-024`

## TKT-09 Action-level AuthZ Matrix

- 状态: `todo`
- 优先级: `P1`
- 目标: 把 issue / room / run / inbox / repo binding / PR 相关关键动作全接到角色权限矩阵。
- 范围:
  - permission matrix
  - backend guards
  - UI disable / denied states
- 依赖: `TKT-07` `TKT-08`
- Done When:
  - viewer / reviewer / admin 的动作边界清楚且有测试锁住
  - 写接口不会再凭默认本地身份放行
- Checklist: `CHK-12` `CHK-13`
- Test Cases: `TC-011` `TC-024` `TC-027`

---

## 五、审批与通知票

## TKT-10 Approval Center Lifecycle

- 状态: `todo`
- 优先级: `P1`
- 目标: 把当前 Inbox 卡片提升成完整审批中心，而不是只做局部 decision mutation。
- 范围:
  - approval / blocked / review / status lifecycle
  - filter / unread / resolution semantics
  - room / run / PR back-link
- 依赖: `TKT-09`
- Done When:
  - approval center 有稳定生命周期
  - 人类决策能完整回写对应对象
- Checklist: `CHK-08` `CHK-11`
- Test Cases: `TC-010` `TC-027`

## TKT-11 Notification Preference 与 Delivery

- 状态: `todo`
- 优先级: `P1`
- 目标: 做出浏览器 push / email fanout 的真实通知链。
- 范围:
  - notification preferences
  - subscriber model
  - browser push / email delivery worker
- 依赖: `TKT-10`
- Done When:
  - blocked / review / approval 事件能主动触达
  - 失败和重试有显式状态
- Checklist: `CHK-11`
- Test Cases: `TC-017`

---

## 六、执行控制与治理票

## TKT-12 Memory Injection / Promotion / Governance Surface

- 状态: `todo`
- 优先级: `P1`
- 目标: 把当前后端已有的 memory contract 继续推进成可治理、可注入、可提升的产品面。
- 范围:
  - memory center
  - diff / audit / governance UI
  - injection policy
  - skill / policy promotion flow
- 依赖: 无
- Done When:
  - 用户能看到 version / diff / audit
  - 高价值经验可提升为 skill / policy
- Checklist: `CHK-10`
- Test Cases: `TC-019` `TC-023`

## TKT-13 Stop / Resume / Follow-thread

- 状态: `todo`
- 优先级: `P1`
- 目标: 让人类可以真正暂停、恢复和接续线程。
- 范围:
  - run state machine
  - room / run UI controls
  - follow-thread semantics
- 依赖: `TKT-09`
- Done When:
  - stop / resume / follow-thread 都有真实状态变化和回写
- Checklist: `CHK-09`
- Test Cases: `TC-018`

## TKT-14 Multi-runtime Scheduler / Failover

- 状态: `done`
- 优先级: `P1`
- 目标: 从 registry/pairing 基线升级到真实调度器、lease 和 failover。
- 范围:
  - runtime scheduler
  - selection / lease / conflict guard
  - offline / failover handling
- 依赖: `TKT-01`
- Done When:
  - 多 runtime 调度决策可见
  - offline runtime 有显式 failover 行为
- Checklist: `CHK-14`
- Test Cases: `TC-020`

## TKT-15 Sandbox / Secrets / Destructive Action Guard

- 状态: `todo`
- 优先级: `P1`
- 目标: 把执行安全从“继承本地环境”推进到产品化 guard。
- 范围:
  - secret boundary
  - destructive git / filesystem approval
  - sandbox mode visibility
- 依赖: `TKT-09`
- Done When:
  - destructive action 进入 approval required
  - secrets 与 runtime capability 边界清楚
- Checklist: `CHK-12`
- Test Cases: `TC-027`

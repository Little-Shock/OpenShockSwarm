# Testing Docs

- [Test Cases](./Test-Cases.md)
  - 以 `PRD -> Checklist -> Test Case` 链路整理的全量验证项
- [Test Report 2026-04-06 Main](./Test-Report-2026-04-06-main.md)
  - 本轮在 `main` 基线上的实际执行结果、失败项和 GAP
- [Test Report 2026-04-07 Headed Setup](./Test-Report-2026-04-07-headed-setup.md)
  - `TKT-03` headed Chromium 自动化回放，覆盖 `TC-001` `TC-002` `TC-003` `TC-026`
- [Test Report 2026-04-07 GitHub App Onboarding](./Test-Report-2026-04-07-github-app-onboarding.md)
  - `TKT-04` headed GitHub App onboarding / repo binding blocked contract 回放，覆盖 `TC-015` `TC-022` `TC-026` 的 blocked-path 证据
- [Test Report 2026-04-07 Webhook Replay](./Test-Report-2026-04-07-webhook-replay.md)
  - `TKT-05` 的 webhook replay / review sync exact replay evidence
- [Test Report 2026-04-07 Remote PR Browser Loop](./Test-Report-2026-04-07-remote-pr-browser-loop.md)
  - `TKT-06` 的真实远端 PR create / merge browser-level exact evidence
- [Test Report 2026-04-07 Login Session Foundation](./Test-Report-2026-04-07-login-session-foundation.md)
  - `TKT-07` 的 login / logout / session persistence browser evidence
- [Test Report 2026-04-07 Workspace Invite Member Role](./Test-Report-2026-04-07-workspace-invite-member-role.md)
  - `TKT-08` 的 owner-side invite / member role-status mutation browser evidence
- [Test Report 2026-04-07 Action AuthZ Matrix](./Test-Report-2026-04-07-action-authz-matrix.md)
  - `TKT-09` 的 board / room / inbox / setup action-level authz matrix exact evidence
- [Test Report 2026-04-07 Approval Center Lifecycle](./Test-Report-2026-04-07-approval-center-lifecycle.md)
  - `TKT-10` 的 approval / blocked / review lifecycle browser evidence
- [Test Report 2026-04-07 Notification Preference Delivery](./Test-Report-2026-04-07-notification-preference-delivery.md)
  - `TKT-11` 的 browser push / email policy, subscriber, fanout, retry evidence
- [Test Report 2026-04-07 Memory Governance](./Test-Report-2026-04-07-memory-governance.md)
  - `TKT-12` 的 memory injection preview, skill/policy promotion, governed ledger evidence
- [Test Report 2026-04-07 Stop Resume Follow-thread](./Test-Report-2026-04-07-stop-resume-follow-thread.md)
  - `TKT-13` 的 stop / resume / follow-thread browser exact replay evidence
- [Test Report 2026-04-07 Multi-runtime Scheduler Failover](./Test-Report-2026-04-07-multi-runtime-scheduler-failover.md)
  - `TKT-14` 的 multi-runtime scheduler / active lease / offline failover browser exact evidence
- [Test Report 2026-04-08 Shell Thread Polish](./Test-Report-2026-04-08-shell-thread-polish.md)
  - `TKT-16` `TKT-17` `TKT-20` 当前这轮 shell / thread / board demotion 的 headed walkthrough evidence
- [Test Report 2026-04-08 Work Shell Smoke](./Test-Report-2026-04-08-work-shell-smoke.md)
  - `chat / setup / issues / memory / inbox / board / room / run` 在统一 workspace shell 下的当前有头走查结果
- [Test Report 2026-04-08 Memory Governance](./Test-Report-2026-04-08-memory-governance.md)
  - `TKT-12` 当天重跑后的有头记忆治理证据
- [Test Report 2026-04-08 Stop Resume Follow-thread](./Test-Report-2026-04-08-stop-resume-follow-thread.md)
  - `TKT-13` 当天重跑后的有头 stop / resume / follow-thread 证据

常用入口：

- `pnpm test:headed-setup`
  - 启动临时 workspace、daemon、server、web 和 headed Chromium，产出 `/tmp/openshock-tkt03-headed-setup-*` 证据目录
- `pnpm test:headed-github-onboarding`
  - 启动临时 workspace、daemon、server、web 和 headed Chromium，模拟 GitHub App installation pending，产出 `/tmp/openshock-tkt04-github-onboarding-*` 证据目录
- `pnpm test:webhook-replay`
  - 回放 signed GitHub webhook fixture，验证 review/comment/check/merge 写回与 failure-path observability
- `pnpm test:headed-remote-pr-loop`
  - 在 headed Chromium 中串起 `/setup -> issue -> room -> remote PR create -> merge`
- `pnpm test:headed-session-foundation`
  - 验证 login / logout / session persistence
- `pnpm test:headed-workspace-member-role`
  - 验证 invite / role / status / member login lifecycle
- `pnpm test:headed-action-authz-matrix`
  - 验证 owner / member / viewer / signed-out 的关键动作矩阵
- `pnpm test:headed-approval-center-lifecycle`
  - 验证 approval center 的 approval / blocked / review lifecycle
- `pnpm test:headed-notification-preference-delivery`
  - 验证 browser push / email policy、subscriber、receipt、retry
- `pnpm test:headed-memory-governance`
  - 验证 memory center 的 injection preview、promotion queue、governed ledger
- `pnpm test:headed-stop-resume-follow-thread`
  - 验证 stop / resume / follow-thread exact replay
- `pnpm test:headed-multi-runtime-scheduler-failover`
  - 验证 multi-runtime scheduler、active lease、offline failover
- `pnpm test:headed-work-shell-smoke`
  - 验证统一 workspace shell 下的 `chat / setup / issues / memory / inbox / board / room / run` 页面走查

说明：

- 名字带 `headed` 的浏览器脚本现在默认都按有头模式执行。
- 如果确实要在无显示环境里回放，再显式传 `OPENSHOCK_E2E_HEADLESS=1`。

如果 `Test Cases` 和 `Test Report` 冲突：

- 用 `Test Cases` 判断应该测什么
- 用 `Test Report` 判断这一轮实际测到了什么、结果如何

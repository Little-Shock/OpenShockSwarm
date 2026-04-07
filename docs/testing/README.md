# Testing Docs

- [Test Cases](./Test-Cases.md)
  - 以 `PRD -> Checklist -> Test Case` 链路整理的全量验证项
- [Test Report 2026-04-06 Main](./Test-Report-2026-04-06-main.md)
  - 本轮在 `main` 基线上的实际执行结果、失败项和 GAP
- [Test Report 2026-04-07 Webhook Replay](./Test-Report-2026-04-07-webhook-replay.md)
  - `TKT-05` 的 webhook replay / review sync exact replay evidence
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
- [Test Report 2026-04-07 Remote PR Browser Loop](./Test-Report-2026-04-07-remote-pr-browser-loop.md)
  - `TKT-06` 的真实远端 PR create / merge browser-level exact evidence

如果 `Test Cases` 和 `Test Report` 冲突：

- 用 `Test Cases` 判断应该测什么
- 用 `Test Report` 判断这一轮实际测到了什么、结果如何

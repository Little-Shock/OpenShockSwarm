# TKT-10 Approval Center Lifecycle Report

- Command: `pnpm test:headed-approval-center-lifecycle -- --report docs/testing/Test-Report-2026-04-09-approval-center-lifecycle-refresh.md`
- Artifacts Dir: `/tmp/openshock-tkt68-approval-artifacts`

## Results

### Approval Center Truth

- `/inbox` 现在直接消费 `/v1/approval-center`，初始 badge 收成 `3 open / 3 unread / 1 recent / 1 blocked` -> PASS
- review signal 直接给出 Room / Run / PR back-link，并显式标记 unread hotspot -> PASS

### Human Decision Lifecycle

- approval card `Approve` 后，badge `3 open -> 2 open`、`1 recent -> 2 recent`，`run_runtime_01` 恢复 `running` -> PASS
- blocked card `Resolve` 后，badge `2 open -> 1 open`、`2 recent -> 3 recent`，`run_memory_01` 恢复 `running` -> PASS
- review card `Request Changes` 这拍按 current remote sync 收：`PR #22` 已在 GitHub merged，所以 badge `1 open -> 0 open`、`3 recent -> 4 recent`，且 `pr-inbox-22.status = merged`、`OPS-19.state = done` -> PASS

### Scope Boundary

- 这轮只收 approval center lifecycle / unread / backlinks / local decision writeback。
- destructive approval guard 仍留给 `TC-027 / TKT-15`，没有被借写成已完成。

### Screenshots

- review-signal-backlinks: /tmp/openshock-tkt68-approval-artifacts/run/screenshots/01-review-signal-backlinks.png
- approval-approved: /tmp/openshock-tkt68-approval-artifacts/run/screenshots/02-approval-approved.png
- blocked-resolved: /tmp/openshock-tkt68-approval-artifacts/run/screenshots/03-blocked-resolved.png
- review-synced-merged: /tmp/openshock-tkt68-approval-artifacts/run/screenshots/04-review-synced-merged.png

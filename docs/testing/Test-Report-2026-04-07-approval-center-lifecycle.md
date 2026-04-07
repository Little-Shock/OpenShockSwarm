# TKT-10 Approval Center Lifecycle Report

- Command: `pnpm test:headed-approval-center-lifecycle -- --report docs/testing/Test-Report-2026-04-07-approval-center-lifecycle.md`
- Artifacts Dir: `/tmp/openshock-tkt10-approval-center-9tlodu`

## Results

### Approval Center Truth

- `/inbox` 现在直接消费 `/v1/approval-center`，初始 `open = 3`、`unread = 3`、`recent = 1` -> PASS
- review signal 直接给出 Room / Run / PR back-link，并显式标记 unread hotspot -> PASS

### Human Decision Lifecycle

- approval card `Approve` 后，open count `3 -> 2`，recent resolution `1 -> 2`，`run_runtime_01` 恢复 `running` -> PASS
- blocked card `Resolve` 后，open count `2 -> 1`，recent resolution `2 -> 3`，`run_memory_01` 恢复 `running` -> PASS
- review card `Request Changes` 后，本地无远端 GitHub 时 failure path 会显式升级成新的 blocked follow-up：`PR #22 同步失败` 可见，且 `pr-inbox-22.status = changes_requested`、`OPS-19.state = blocked` -> PASS

### Scope Boundary

- 这轮只收 approval center lifecycle / unread / backlinks / local decision writeback。
- destructive approval guard 仍留给 `TC-027 / TKT-15`，没有被借写成已完成。

### Screenshots

- review-signal-backlinks: /tmp/openshock-tkt10-approval-center-9tlodu/run/screenshots/01-review-signal-backlinks.png
- approval-approved: /tmp/openshock-tkt10-approval-center-9tlodu/run/screenshots/02-approval-approved.png
- blocked-resolved: /tmp/openshock-tkt10-approval-center-9tlodu/run/screenshots/03-blocked-resolved.png
- review-converted-to-blocked: /tmp/openshock-tkt10-approval-center-9tlodu/run/screenshots/04-review-converted-to-blocked.png

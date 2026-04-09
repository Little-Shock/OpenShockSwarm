# Test Report 2026-04-09 Runtime Lease Conflict / Scheduler Hardening

- Harness: `pnpm test:headed-runtime-lease-conflict-recovery -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-runtime-lease-conflict-recovery.md`
- Scope: `TKT-31 / CHK-14 / CHK-15 / TC-020 / TC-021`
- Result: `PASS`

## Environment

- server URL: `http://127.0.0.1:43604`
- web URL: `http://127.0.0.1:43304`
- runtimes:
  - selected runtime: `shock-main`
  - pressured runtime: `shock-sidecar`
  - failover runtime: `shock-spare`

## Assertions

1. Scheduler failover remains stable under lease pressure
   - owner `Claude Review Runner` first created a lane on `shock-sidecar`
   - after forcing `shock-main` stale, `/setup` switched scheduler strategy to `自动 Failover`
   - next lane truth pointed to `shock-spare`
2. Runtime lease conflict now writes recovery truth into live state
   - posting `force-conflict` to room `room-offline-failover-lane` returned 409 with lease holder `session-other`
   - blocked run `run_offline-failover-lane_01` carried control-note recovery guidance instead of only generic blocked text
3. `/setup` and `/agents` both surface the current decision reason
   - browser `/setup` rendered the runtime lease recovery panel and recovery note
   - browser `/agents` rendered the blocked session summary plus `recovery:` line with the same holder-aware note
   - run detail showed `当前控制说明` with the same lease recovery guidance

## Daemon Evidence

- main ensure hits: 0
- sidecar ensure hits: 1
- spare ensure hits: 1
- spare exec hits: 1
- spare conflict hits: 1

## Screenshots

- setup-lease-recovery: `/tmp/openshock-tkt31-runtime-lease-HJmsvv/screenshots/01-setup-lease-recovery.png`
- agents-lease-recovery: `/tmp/openshock-tkt31-runtime-lease-HJmsvv/screenshots/02-agents-lease-recovery.png`
- run-lease-recovery: `/tmp/openshock-tkt31-runtime-lease-HJmsvv/screenshots/03-run-lease-recovery.png`

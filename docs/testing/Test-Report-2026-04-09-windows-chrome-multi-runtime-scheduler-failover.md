# Test Report 2026-04-07 Multi-runtime Scheduler Failover

- Harness: `pnpm test:headed-multi-runtime-scheduler-failover -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-multi-runtime-scheduler-failover.md`
- Scope: `TKT-14 / CHK-14 / TC-020`
- Result: `PASS`

## Environment

- server URL: `http://127.0.0.1:43620`
- web URL: `http://127.0.0.1:44608`
- runtimes:
  - selected runtime: `shock-main`
  - secondary runtime: `shock-sidecar`
  - spare runtime: `shock-spare`

## Assertions

1. Scheduler preference / lease pressure
   - owner `Claude Review Runner` first created a lane on `shock-sidecar`
   - browser `/runs/run_sidecar-preference-lane_01` rendered `shock-sidecar / Claude Code CLI`
2. Offline failover preview
   - after marking `shock-main` stale/offline, `/setup` switched strategy to `自动 Failover`
   - live scheduler summary pointed next lane to `shock-spare`
3. Failover execution truth
   - owner `Codex Dockmaster` next created a lane on `shock-spare`
   - browser `/runs/run_offline-failover-lane_01` rendered `shock-spare / Codex CLI`
   - run detail timeline included `Runtime 已 failover 到 shock-spare`

## Daemon Routing Evidence

- main ensure hits: 0
- sidecar ensure hits: 1
- spare ensure hits: 1

## Screenshots

- run-sidecar-preference: `/tmp/openshock-tkt14-runtime-scheduler-dfhnnS/screenshots/01-run-sidecar-preference.png`
- setup-failover-preview: `/tmp/openshock-tkt14-runtime-scheduler-dfhnnS/screenshots/02-setup-failover-preview.png`
- run-failover-detail: `/tmp/openshock-tkt14-runtime-scheduler-dfhnnS/screenshots/03-run-failover-detail.png`

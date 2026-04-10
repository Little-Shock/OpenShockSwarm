# Test Report 2026-04-11 Windows Chrome Delivery Entry / Release Gate / Handoff Contract

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-delivery-entry-release-gate -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-delivery-entry-release-gate.md`
- Artifacts Dir: `/tmp/openshock-tkt49-delivery-entry-y01bEn`
- Web: `http://127.0.0.1:43976`
- Server: `http://127.0.0.1:44532`

## Results

- `/pull-requests/pr-runtime-18` 已把 delivery status、release ready、4 个 gate、2 个 template 和 6 条 evidence 收到同一页，不再散在 room / settings / runbook。当前判断结果 = `blocked` / releaseReady=`false`。
- release gate 当前全部可复核：review-merge:blocked / run-usage:ready / workspace-quota:ready / notification-delivery:ready。
- operator handoff note 已有 8 条可执行说明，并且 UI 与 API 都把当前状态显示为 `handoff blocked`。
- browser walkthrough 已验证 delivery template 可回到 `/settings`，room PR backlink 可回到同一条 PR workbench，run usage gate 也能回到对应 run context。

## Evidence

- fanout summary before drill-in: attempted=4 delivered=4 failed=0
- delivery templates: `ops_approval:ready, ops_status_update:ready`
- evidence bundle ids: `release-contract, room-pr-tab, run-context, remote-pr, notification-templates, decision-ledger`

## Screenshots

- pull-request-delivery-entry: `../../../tmp/openshock-tkt49-delivery-entry-y01bEn/run/screenshots/01-pull-request-delivery-entry.png`
- settings-delivery-surface: `../../../tmp/openshock-tkt49-delivery-entry-y01bEn/run/screenshots/02-settings-delivery-surface.png`
- room-pr-workbench-backlink: `../../../tmp/openshock-tkt49-delivery-entry-y01bEn/run/screenshots/03-room-pr-workbench-backlink.png`
- run-gate-context: `../../../tmp/openshock-tkt49-delivery-entry-y01bEn/run/screenshots/04-run-gate-context.png`

VERDICT: PASS

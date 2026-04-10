# 2026-04-11 Windows Chrome PR Conversation / Usage Observability Report

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-pr-conversation-usage-observability -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-pr-conversation-usage-observability.md`
- Artifacts Dir: `/tmp/openshock-tkt39-41-headed-jsILd8`
- Web: `http://127.0.0.1:43680`
- Server: `http://127.0.0.1:45134`

## Results

### Check: TKT-39 review conversation / room-inbox-PR backlinks
- API replay: `pull_request_review(changes_requested)` -> `pull_request_review_comment` -> replay dedupe -> `pull_request_review_thread(resolved)`
- Observed: conversation IDs=`review_thread:7001, review_comment:9001, review:7000`, blocked inbox href=`/rooms/room-runtime?tab=pr`, PR detail related inbox count=`1`
- Result: PASS. review comment、thread resolution、changes requested 已稳定回写到同一条 PR conversation ledger，Inbox 与 Room 统一深链到 PR workbench，而不是把人带离 review 上下文。

### Check: TKT-41 run / room / workspace usage observability
- Browser path: `/rooms/room-runtime?tab=run -> /runs/run_runtime_01 -> /settings`
- Observed: room usage=`6 msgs / 5,498 tokens; 1 human / 1 agent; window=过去 6h`, workspace usage=`Builder P0; 3/8 agents; 3/16 rooms; retention=30d 消息 / 14d Run / 90d 草稿`, run status=`健康`, settings usage=`22,184 tokens / 5 runs / 16 msgs`, retention=`30d 消息 / 14d Run / 90d 草稿`
- Result: PASS. run / room / workspace 三层 usage、quota、retention 与 warning 已进入正式产品面，不再只藏在日志、默认值或 setup 侧栏。

## Screenshots

- pr-detail-conversation-and-inbox-backlinks: `../../../tmp/openshock-tkt39-41-headed-jsILd8/screenshots/01-pr-detail-conversation-and-inbox-backlinks.png`
- room-pr-workbench-conversation-ledger: `../../../tmp/openshock-tkt39-41-headed-jsILd8/screenshots/02-room-pr-workbench-conversation-ledger.png`
- approval-center-pr-review-backlinks: `../../../tmp/openshock-tkt39-41-headed-jsILd8/screenshots/03-approval-center-pr-review-backlinks.png`
- room-run-usage-observability: `../../../tmp/openshock-tkt39-41-headed-jsILd8/screenshots/04-room-run-usage-observability.png`
- run-detail-token-quota-surface: `../../../tmp/openshock-tkt39-41-headed-jsILd8/screenshots/05-run-detail-token-quota-surface.png`
- settings-workspace-plan-usage-retention: `../../../tmp/openshock-tkt39-41-headed-jsILd8/screenshots/06-settings-workspace-plan-usage-retention.png`

VERDICT: PASS

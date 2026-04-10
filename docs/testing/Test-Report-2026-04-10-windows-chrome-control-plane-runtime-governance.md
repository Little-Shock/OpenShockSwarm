# 2026-04-10 Windows Chrome Control-Plane / Runtime Replay / Governance Report

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-control-plane-runtime-governance -- --report docs/testing/Test-Report-2026-04-10-windows-chrome-control-plane-runtime-governance.md`
- Artifacts Dir: `/tmp/openshock-tkt58-61-headed-Es05pQ`
- Web: `http://127.0.0.1:44592`
- Server: `http://127.0.0.1:45266`

## Results

### Check: TKT-61 routing policy / escalation SLA / notification policy / aggregation
- Browser path: `/setup -> /mailbox?roomId=room-runtime -> /agents`
- Observed: governance template=`开发团队治理链`, routing rules=`5`, notification targets=`mailbox, inbox, browser_push`, audit trail=`4`
- Result: PASS. blocked escalation、final response aggregation、routing matrix、SLA 和 notification policy 已围同一份 workspace governance truth 前滚。

### Check: TKT-58 control-plane /v1 command-event-debug contract
- API: `POST /v1/control-plane/commands` -> `GET /v1/control-plane/events` -> `GET /v1/control-plane/debug/commands/cp-1775837061660740699` -> `GET /v1/control-plane/debug/rejections?family=not_found`
- Observed: command=`cp-1775837061660740699`, aggregate=`OPS-28`, eventCursor=`1`, replayDeduped=`true`, rejectionFamily=`not_found`
- Result: PASS. command write、event read、debug read-model、idempotency 和稳定 error family 已成立；browser 侧已能直接回看新建 issue。

### Check: TKT-60 runtime publish cursor / replay evidence packet
- API: `POST /v1/runtime/publish` x2 + retry -> `GET /v1/runtime/publish` -> `GET /v1/runtime/publish/replay?runId=run_memory_01`
- Observed: sequences=`1, 2`, lastCursor=`2`, closeout=`等待治理规则对齐后再恢复记忆写回。`, failureAnchor=`notes/rooms/room-memory.md#policy-conflict`
- Result: PASS. daemon publish retry 不再重复落账；replay packet 会把 cursor、closeout reason、failure anchor 和 browser run detail 对齐。

### Check: TKT-59 no-shadow-truth / dirty projection fail-closed
- Browser path: intercepted dirty `/v1/state` on `/agents` with EventSource disabled
- Observed: template fallback=`当前治理链正在整理中。`, summary fallback=`当前多 Agent 治理摘要正在整理中。`, aggregation fallback=`等待当前治理链收口。`
- Result: PASS. 浏览器 adapter 在 dirty projection 下会 fail-closed 回退到产品级 fallback，不会继续展示 placeholder / mock / path residue。

## Screenshots

- setup-dev-team-template: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/01-setup-dev-team-template.png`
- mailbox-handoff-requested: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/02-mailbox-handoff-requested.png`
- mailbox-handoff-blocked: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/03-mailbox-handoff-blocked.png`
- mailbox-handoff-completed: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/04-mailbox-handoff-completed.png`
- agents-governance-routing-sla-aggregation: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/05-agents-governance-routing-sla-aggregation.png`
- control-plane-issue-browser-surface: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/06-control-plane-issue-browser-surface.png`
- runtime-replay-browser-surface: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/07-runtime-replay-browser-surface.png`
- dirty-projection-fail-closed: `../../../tmp/openshock-tkt58-61-headed-Es05pQ/screenshots/08-dirty-projection-fail-closed.png`

VERDICT: PASS

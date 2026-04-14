# 2026-04-14 Cross-Room Governance Auto-Closeout Report

- Ticket: `TKT-72` + `TKT-95`
- Checklist: `CHK-21`
- Test Case: `TC-061` + `TC-084`
- Scope: cross-room graph lifecycle, governed route -> QA -> auto-complete delivery closeout, mailbox/agents done-route sync, reload continuity, sidecar-safe blocker retention
- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-cross-room-governance-auto-closeout -- --report docs/testing/Test-Report-2026-04-14-windows-chrome-cross-room-governance-auto-closeout.md`
- Artifacts Dir: `/tmp/openshock-tkt95-cross-room-governance-vdgqg7`

## Results

- runtime room 通过真实 blocked inbox replay 进入 cross-room governance rollup 后，会带出 `current owner / current lane / next governed route` 元数据，不再只剩 room 状态摘要 -> PASS
- `/mailbox` 与 `/agents` 现在都会把 hot room 重新组织成 `room -> current owner/lane -> next route` 的 cross-room dependency graph；人类不必逐卡读长文也能看出哪一棒卡住、下一棒准备交给谁 -> PASS
- `/mailbox` 上的 cross-room rollup 在 route `ready` 时会开放 `Create Governed Handoff`，并通过正式 `POST /v1/mailbox/governed` 合同起单，而不是前端本地拼接 mutation -> PASS
- governed create 成功后，runtime room 的 route metadata 会从 `ready` 切成 `active`，`Open Next Route` 也会深链到新建 handoff；说明 room-level orchestration 已进入正式产品面 -> PASS
- `/agents` 会镜像同一份 route status 与 deep-link，不会出现 mailbox 已 active、orchestration 仍停在 ready 的分裂真相 -> PASS
- reviewer -> QA -> delivery auto-complete 走完后，runtime room 仍会因为最初的 blocker 保持 hot，但 route 会同步切到 `done`，且不会额外长出 `delivery-closeout / delivery-reply` sidecar；说明 blocker truth 与 closeout truth 已被正确拆开 -> PASS
- `/pull-requests/pr-runtime-18` 的 Delivery Delegation 会直接显示 `已完成`，并保留 auto-complete policy 摘要；用户能在交付面确认正式收口，而不是只在后台状态里猜测 -> PASS
- `/mailbox` 与 `/agents` 在 reload 后仍会维持同一条 `done` route truth，而且 Mailbox 当前 room ledger 不会露出 `交付收尾 / 收尾回复` sidecar 卡片 -> PASS

## Assertions

- Baseline rollup length: 1
- Ready route: Codex Dockmaster / Architect / Codex Dockmaster -> Claude Review Runner
- Created handoff: handoff-1776176854836079832 (Codex Dockmaster -> Claude Review Runner)
- Active route href: /inbox?handoffId=handoff-1776176854836079832&roomId=room-runtime
- QA followup: handoff-1776176855968708029 (Memory Clerk)
- Final rollup length: 2
- Final runtime route: done / /pull-requests/pr-runtime-18
- Final delegation status: done
- Visible mailbox kinds after closeout: 自动交接, 自动交接

## Screenshots

- mailbox-cross-room-baseline: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/01-mailbox-cross-room-baseline.png
- mailbox-cross-room-route-ready: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/02-mailbox-cross-room-route-ready.png
- orchestration-cross-room-route-ready: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/03-orchestration-cross-room-route-ready.png
- mailbox-cross-room-route-active: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/04-mailbox-cross-room-route-active.png
- inbox-cross-room-route-focus: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/05-inbox-cross-room-route-focus.png
- orchestration-cross-room-route-active: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/06-orchestration-cross-room-route-active.png
- pr-detail-cross-room-auto-closeout-done: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/07-pr-detail-cross-room-auto-closeout-done.png
- mailbox-cross-room-auto-closeout-done: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/08-mailbox-cross-room-auto-closeout-done.png
- mailbox-cross-room-auto-closeout-reloaded: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/09-mailbox-cross-room-auto-closeout-reloaded.png
- orchestration-cross-room-auto-closeout-done: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/10-orchestration-cross-room-auto-closeout-done.png
- orchestration-cross-room-auto-closeout-reloaded: /tmp/openshock-tkt95-cross-room-governance-vdgqg7/screenshots/11-orchestration-cross-room-auto-closeout-reloaded.png

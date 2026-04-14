# 2026-04-14 Cross-Room Governance Orchestration Report

- Ticket: `TKT-95`
- Checklist: `CHK-21`
- Test Case: `TC-084`
- Scope: cross-room rollup route metadata, dependency graph surface, room-level governed create action, mailbox + orchestration mirror, inbox deep-link
- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-cross-room-governance-orchestration -- --report docs/testing/Test-Report-2026-04-14-windows-chrome-cross-room-governance-dependency-graph.md`
- Artifacts Dir: `/tmp/openshock-tkt95-cross-room-governance-bsYEuZ`

## Results

- runtime room 通过真实 blocked inbox replay 进入 cross-room governance rollup 后，会带出 `current owner / current lane / next governed route` 元数据，不再只剩 room 状态摘要 -> PASS
- `/mailbox` 与 `/agents` 现在都会把 hot room 重新组织成 `room -> current owner/lane -> next route` 的 cross-room dependency graph；人类不必逐卡读长文也能看出哪一棒卡住、下一棒准备交给谁 -> PASS
- `/mailbox` 上的 cross-room rollup 在 route `ready` 时会开放 `Create Governed Handoff`，并通过正式 `POST /v1/mailbox/governed` 合同起单，而不是前端本地拼接 mutation -> PASS
- governed create 成功后，runtime room 的 route metadata 会从 `ready` 切成 `active`，`Open Next Route` 也会深链到新建 handoff；说明 room-level orchestration 已进入正式产品面 -> PASS
- `/agents` 会镜像同一份 route status 与 deep-link，不会出现 mailbox 已 active、orchestration 仍停在 ready 的分裂真相 -> PASS

## Assertions

- Baseline rollup length: 1
- Ready route: Codex Dockmaster / Architect / Codex Dockmaster -> Claude Review Runner
- Created handoff: handoff-1776128142301894999 (Codex Dockmaster -> Claude Review Runner)
- Active route href: /inbox?handoffId=handoff-1776128142301894999&roomId=room-runtime

## Screenshots

- mailbox-cross-room-baseline: /tmp/openshock-tkt95-cross-room-governance-bsYEuZ/screenshots/01-mailbox-cross-room-baseline.png
- mailbox-cross-room-route-ready: /tmp/openshock-tkt95-cross-room-governance-bsYEuZ/screenshots/02-mailbox-cross-room-route-ready.png
- orchestration-cross-room-route-ready: /tmp/openshock-tkt95-cross-room-governance-bsYEuZ/screenshots/03-orchestration-cross-room-route-ready.png
- mailbox-cross-room-route-active: /tmp/openshock-tkt95-cross-room-governance-bsYEuZ/screenshots/04-mailbox-cross-room-route-active.png
- inbox-cross-room-route-focus: /tmp/openshock-tkt95-cross-room-governance-bsYEuZ/screenshots/05-inbox-cross-room-route-focus.png
- orchestration-cross-room-route-active: /tmp/openshock-tkt95-cross-room-governance-bsYEuZ/screenshots/06-orchestration-cross-room-route-active.png

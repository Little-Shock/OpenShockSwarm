# 2026-04-09 Planner Dispatch / First-Instruction Replay Report

- Command: `pnpm test:headed-planner-dispatch-replay -- --report docs/testing/Test-Report-2026-04-09-planner-dispatch-replay.md`
- Artifacts Dir: `/tmp/openshock-tkt53-planner-dispatch-d8NTw9`

## Results

- `/board` 真创建 issue 后，`/v1/planner/queue` 会立即露出同一条 visible item（本次 initial status = `blocked`）；随后把 session assignment 前滚给 `Codex Dockmaster` 后，`/agents` orchestration page 会直接显示 owner / runtime / gate / auto-merge guard truth -> PASS
- orchestration page 现在不再只剩旧的 fail-closed copy；`planner queue + governed topology + issue -> handoff -> review -> test -> final response` walkthrough 已经同页可见 -> PASS
- adversarial non-happy probe 已覆盖 `blocked` without note：`POST /v1/mailbox/:id` 在缺 note 时稳定返回 `400`，不会把 reviewer blocker 假绿吞掉 -> PASS
- blocked escalation 与 final response aggregation 都能在同一条 orchestration page 上前滚：`human override = watch`，随后 closeout note 会进入 response aggregation 与 final-response step -> PASS

## Screenshots

- room-after-board-create: /tmp/openshock-tkt53-planner-dispatch-d8NTw9/screenshots/01-room-after-board-create.png
- agents-after-planner-assignment: /tmp/openshock-tkt53-planner-dispatch-d8NTw9/screenshots/02-agents-after-planner-assignment.png
- agents-after-blocked-escalation: /tmp/openshock-tkt53-planner-dispatch-d8NTw9/screenshots/03-agents-after-blocked-escalation.png
- agents-after-final-response: /tmp/openshock-tkt53-planner-dispatch-d8NTw9/screenshots/04-agents-after-final-response.png

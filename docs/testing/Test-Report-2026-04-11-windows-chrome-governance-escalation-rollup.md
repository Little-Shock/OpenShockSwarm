# 2026-04-11 Governance Escalation Rollup Report

- Ticket: `TKT-93`
- Checklist: `CHK-21`
- Test Case: `TC-082`
- Scope: cross-room escalation rollup, mailbox + orchestration mirror, blocked+active room split, clear-down
- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governance-escalation-rollup -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governance-escalation-rollup.md`
- Artifacts Dir: `/tmp/openshock-tkt93-escalation-rollup-ljqmjE`

## Results

- primary room Runtime 讨论间 被 blocker 抬进 governance 后，cross-room rollup 会把它显示为 blocked room，并给出 room-level deep link -> PASS
- secondary room Inbox 讨论间 即便只是 active handoff，也会进入同一条 rollup；治理面不再只认 blocker，不会漏掉另一个仍在推进的 hot room -> PASS
- `/mailbox` 与 `/agents` 会镜像同一份 rollup truth，而不是一个页面有 room rollup、另一个页面只剩 aggregate counter -> PASS
- primary room closeout 后，rollup 会只保留 secondary room；两边都完成后 rollup 会回退到 baseline hot-room 数量，说明跨 room 视角同样沿正式 handoff truth 清退 -> PASS

## Assertions

- Baseline rollup length: 1
- Hot rooms: Runtime 讨论间:blocked:2 | 记忆写回讨论间:blocked:1 | Inbox 讨论间:active:1
- Final rollup length: 1

## Screenshots

- mailbox-rollup-baseline: /tmp/openshock-tkt93-escalation-rollup-ljqmjE/screenshots/01-mailbox-rollup-baseline.png
- mailbox-rollup-hot-rooms: /tmp/openshock-tkt93-escalation-rollup-ljqmjE/screenshots/02-mailbox-rollup-hot-rooms.png
- orchestration-rollup-hot-rooms: /tmp/openshock-tkt93-escalation-rollup-ljqmjE/screenshots/03-orchestration-rollup-hot-rooms.png
- mailbox-rollup-primary-cleared: /tmp/openshock-tkt93-escalation-rollup-ljqmjE/screenshots/04-mailbox-rollup-primary-cleared.png
- mailbox-rollup-cleared: /tmp/openshock-tkt93-escalation-rollup-ljqmjE/screenshots/05-mailbox-rollup-cleared.png

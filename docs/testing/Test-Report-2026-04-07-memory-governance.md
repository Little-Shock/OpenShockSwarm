# TKT-12 Memory Injection / Promotion / Governance Report

- Command: `pnpm test:headed-memory-governance -- --report docs/testing/Test-Report-2026-04-07-memory-governance.md`
- Artifacts Dir: `/tmp/openshock-tkt12-memory-governance-dbjJD5`

## Results

### Injection Policy + Preview

- `/memory` 现在直接消费 `/v1/memory-center`，`session-memory` preview 默认会把 `MEMORY.md`、room note、decision ledger 拉进 next-run recall pack -> PASS
- 打开 `Agent Memory` 并把 preview 容量扩到 `8 items` 后，同一页 preview 会立刻补进 `.openshock/agents/memory-clerk/MEMORY.md`，不再停在静态文案 -> PASS

### Skill / Policy Promotion

- `notes/rooms/room-memory.md` 可被发起为 `Skill` promotion，并在人工 approve 后落进 `notes/skills.md` -> PASS
- `decisions/ops-27.md` 可被发起为 `Policy` promotion，并在人工 approve 后落进 `notes/policies.md`，同时重新进入 next-run preview -> PASS

### Scope Boundary

- 这轮只收 `TC-019` 的 injection / promotion / governance loop。
- 长期记忆引擎、外部 provider 编排和更重的后台整理任务继续留在后续范围，不借写成这张票已完成。

### Screenshots

- initial-memory-center: /tmp/openshock-tkt12-memory-governance-dbjJD5/run/screenshots/01-initial-memory-center.png
- policy-preview-updated: /tmp/openshock-tkt12-memory-governance-dbjJD5/run/screenshots/02-policy-preview-updated.png
- skill-promotion-approved: /tmp/openshock-tkt12-memory-governance-dbjJD5/run/screenshots/03-skill-promotion-approved.png
- policy-ledger-approved: /tmp/openshock-tkt12-memory-governance-dbjJD5/run/screenshots/04-policy-ledger-approved.png

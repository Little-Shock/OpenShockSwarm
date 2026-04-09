# Test Report 2026-04-09 Memory Viewer / Correction / Forget Surface

- Command: `pnpm test:headed-memory-viewer-correction-forget -- --report docs/testing/Test-Report-2026-04-09-memory-viewer-correction-forget.md`
- Artifacts Dir: `/tmp/openshock-tkt42-memory-viewer-PANGSC`
- Scope: `TKT-42 / CHK-10 / CHK-22 / TC-023 / TC-036`
- Result: `PASS`

## Results

### Correction Loop

- `/memory` 现在不只读 detail：对 `notes/rooms/room-memory.md` 提交 human correction 后，同一页 detail / version trace 会立刻读回 `memory.feedback` -> PASS
- correction 不会写进 shadow state；同一份 artifact content、latest source/actor 与 correction count 都同步更新 -> PASS

### Forget Surface

- 对同一条 room artifact 执行 forget 后，detail status 变成 `forgotten`，并保留 reason / actor / audit trace -> PASS
- forgotten artifact 会从 `session-memory` recall preview 中移除，不再继续注入 next-run pack -> PASS

### Scope Boundary

- 这轮只收 memory viewer 上的 correction / forget / audit / provenance product surface。
- 更重的 cleanup worker、TTL、批量整理和外部 memory provider 继续留给后续票，不混写成这张已完成。

### Screenshots

- initial-memory-viewer: /tmp/openshock-tkt42-memory-viewer-PANGSC/run/screenshots/01-initial-memory-viewer.png
- memory-correction-written: /tmp/openshock-tkt42-memory-viewer-PANGSC/run/screenshots/02-memory-correction-written.png
- memory-forgotten: /tmp/openshock-tkt42-memory-viewer-PANGSC/run/screenshots/03-memory-forgotten.png

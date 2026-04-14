# Headed Room Chat Reload Continuity Report

- Generated at: 2026-04-14T00:01:45.990Z
- Command: `pnpm test:headed-room-chat-reload-continuity -- --report output/testing/headed-room-chat-reload-continuity-report.md`
- Artifacts Dir: `/tmp/openshock-room-chat-reload-qSvAex`

## Verification

### Check: Room Thread Query State
**Command run:**
  GET http://127.0.0.1:43724/rooms/room-runtime
**Output observed:**
  打开线程后，selected thread、reply target 和 thread rail 都会写回 room URL。

### Check: Room Draft Session State
**Command run:**
  fill http://127.0.0.1:43724/rooms/room-runtime
**Output observed:**
  在房间输入的未发送草稿会写入浏览器 session draft state。

### Check: Room Reload Continuity
**Command run:**
  reload http://127.0.0.1:43724/rooms/room-runtime
**Output observed:**
  reload 后 thread、reply target 和未发送 draft 都会恢复到同一条房间会话。

## Screenshots

- room-thread-selected: /tmp/openshock-room-chat-reload-qSvAex/screenshots/01-room-thread-selected.png
- room-draft-filled: /tmp/openshock-room-chat-reload-qSvAex/screenshots/02-room-draft-filled.png
- room-reload-restored: /tmp/openshock-room-chat-reload-qSvAex/screenshots/03-room-reload-restored.png

VERDICT: PASS

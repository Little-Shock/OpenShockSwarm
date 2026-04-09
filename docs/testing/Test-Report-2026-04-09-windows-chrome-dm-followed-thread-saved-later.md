# 2026-04-08 DM / Followed Thread / Saved Later Report

- Command: `pnpm test:headed-dm-followed-thread-saved-later -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-dm-followed-thread-saved-later.md`
- Artifacts Dir: `/tmp/openshock-dm-followed-thread-HGl3Fw`

## Results
- Sidebar now exposes direct messages; entering a DM keeps the operator inside the same workspace shell.
- Channel thread rail can now follow a thread and send it to saved-later without leaving chat.
- Followed thread queue can reopen the same thread back into chat without re-scanning the message stream.
- Saved-later queue keeps revisit intent in the same shell and can reopen the exact thread when the operator is ready.

## Screenshots
- dm-surface: /tmp/openshock-dm-followed-thread-HGl3Fw/screenshots/01-dm-surface.png
- channel-thread-actions: /tmp/openshock-dm-followed-thread-HGl3Fw/screenshots/02-channel-thread-actions.png
- followed-panel: /tmp/openshock-dm-followed-thread-HGl3Fw/screenshots/03-followed-panel.png
- followed-reopen: /tmp/openshock-dm-followed-thread-HGl3Fw/screenshots/04-followed-reopen.png
- saved-panel: /tmp/openshock-dm-followed-thread-HGl3Fw/screenshots/05-saved-panel.png
- saved-reopen: /tmp/openshock-dm-followed-thread-HGl3Fw/screenshots/06-saved-reopen.png

## Single Value
- Workspace shell now carries DM entry, followed thread revisit, and saved-later revisit inside the same `/chat/:channelId` workbench; the operator can enter a DM, follow a channel thread, save it for later, and reopen that same thread from either queue without promoting it to a room.

# 2026-04-08 Shell / Thread / Workspace Polish Report

- Scope: `TKT-16` `TKT-17` `TKT-20`
- Verification:
  - `pnpm typecheck:web`
  - `pnpm build:web`
  - local headed Chromium walkthrough on `http://127.0.0.1:3001`
- Artifacts Dir: `/tmp/openshock-shell-pass-QLOhBV`

## Results

### Workspace shell is now shared across primary and secondary surfaces

- `/chat/all`、`/inbox`、`/board`、`/setup` 都进入同一套 workspace shell，左栏统一保留 `Channels / Rooms / Inbox / Board / presence`，不再出现 chat 页和 utility 页两套导航 -> PASS
- web 默认改走同源 `/api/control/*` proxy，Windows 浏览器看 `127.0.0.1:3001` 时不再因为直接访问 `127.0.0.1:8080` 而整页卡在 `syncing` -> PASS

### Channel / Room thread rail is no longer placeholder-only

- 频道消息行现在可直接打开右侧 thread rail，并把当前消息作为 reply target 交回底部 composer；composer 保持可见 -> PASS
- room 消息行同样可打开 thread rail，而且 right rail 已把 `follow_thread` 控制接进去，不再只是静态“Thread”占位卡 -> PASS

### Board has been demoted but not fully closed

- Board 已从主消息导航降到左下角次级入口，符合“planning mirror 而不是首页中心”的方向 -> PASS
- 但 board 和 room / issue 的回跳关系、planning card 的轻量化语言还没完全收平 -> GAP

## Evidence

- chat-all: `/tmp/openshock-shell-pass-QLOhBV/01-chat-all.png`
- chat-thread: `/tmp/openshock-shell-pass-QLOhBV/02-chat-thread.png`
- room-context: `/tmp/openshock-shell-pass-QLOhBV/03-room-context.png`
- room-thread: `/tmp/openshock-shell-pass-QLOhBV/04-room-thread.png`
- inbox: `/tmp/openshock-shell-pass-QLOhBV/05-inbox.png`
- board: `/tmp/openshock-shell-pass-QLOhBV/06-board.png`
- setup: `/tmp/openshock-shell-pass-QLOhBV/07-setup.png`

## Remaining Gaps

- `DM / followed thread / saved later / real quick switch results` 仍未闭环，所以 `TKT-16` `TKT-17` 继续保持 `active`
- room 右 rail 已有 `Context / Thread` 切换，但还没把 `Topic / Run / PR` 收成真正稳定的单房间 workbench
- 现有持久化 state 里还残留部分早前乱码历史文案（例如旧 issue / room 标题与消息），这不是这轮字体 fallback 的问题，而是历史数据本身需要清理

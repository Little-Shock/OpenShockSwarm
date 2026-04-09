# 2026-04-08 Work Shell Smoke Report

- Command: `pnpm test:headed-work-shell-smoke -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-work-shell-smoke.md`
- Artifacts Dir: `/tmp/openshock-work-shell-smoke-n5wDQk`

## Results

- `/chat/all`、`/setup`、`/issues`、`/memory`、`/inbox`、`/board`、`/rooms/room-runtime`、`/runs/run_runtime_01` 已在同一套 workspace shell 下完成有头浏览器走查 -> PASS
- Work 模式现在会在左侧 `Chat / Work` 顶部切换上显示明确激活态，不再让 utility surface 像未激活副按钮 -> PASS
- 中栏背景已从纯白整块改回统一工作台底色，左栏与中栏之间不再出现突兀白缝；`setup / issues / memory / run` 的卡片密度也已收紧 -> PASS
- Board 仍保持次级 planning surface 位置，但 card 语言和 room / issue 回跳仍有继续压缩空间 -> GAP

## Screenshots

- chat-all: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/01-chat-all.png
- setup: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/02-setup.png
- issues: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/03-issues.png
- memory: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/04-memory.png
- inbox: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/05-inbox.png
- board: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/06-board.png
- room-runtime: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/07-room-runtime.png
- run-runtime: /tmp/openshock-work-shell-smoke-n5wDQk/screenshots/08-run-runtime.png

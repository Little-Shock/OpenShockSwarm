# 2026-04-08 Agent / Machine / Human Profile Surface Report

- Command: `pnpm test:headed-profile-surface -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-profile-surface.md`
- Artifacts Dir: `/tmp/openshock-profile-surface-Rl9JzS`

## Results
- 从 room context 点击 active agent 后，会进入统一 Agent profile，并直接显示 presence、runtime capability、recent run/room 关系。
- 从 room context 点击 machine profile 后，会进入统一 Machine profile，并直接显示 heartbeat、runtime capability、recent run/room 与 bound agents。
- shell right rail 里的 Human entry 现在也会进入统一 Human profile，并直接显示 session、role/permission 与最近 run/room 关系。

## Screenshots
- room-context-entry: /tmp/openshock-profile-surface-Rl9JzS/screenshots/01-room-context-entry.png
- agent-profile: /tmp/openshock-profile-surface-Rl9JzS/screenshots/02-agent-profile.png
- machine-profile: /tmp/openshock-profile-surface-Rl9JzS/screenshots/03-machine-profile.png
- human-profile: /tmp/openshock-profile-surface-Rl9JzS/screenshots/04-human-profile.png

## Single Value
- `Agent / Machine / Human` 现在都能从 shell 或 room drill-in 到同一套 profile surface；presence、activity、capability 和最近 run/room 关系直接读取 live truth，不再只剩零散 badge 或孤立详情页。

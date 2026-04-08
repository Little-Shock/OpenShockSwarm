# TKT-24 Frontend Interaction Polish Report

- Command: `pnpm test:headed-frontend-interaction-polish -- --report docs/testing/Test-Report-2026-04-08-frontend-interaction-polish.md`
- Artifacts Dir: `/tmp/openshock-tkt24-exact-artifacts`

## Scope Boundary
- `TKT-24` 当前只验证 interaction polish：不包含 quick search result surface，也不依赖 room workbench 新 contract。

## Results

### Channel Shell + Scrollback
- Sidebar Quick Search 命中区 264x44，达到高频点击下限 -> PASS
- Topbar Quick Search 命中区 320x52，达到高频点击下限 -> PASS
- Channel composer 保持在当前视口内 (1186 / 1200) -> PASS
- Channel composer after scroll 保持在当前视口内 (1186 / 1200) -> PASS
- Channel reply action 命中区 58x44，达到高频点击下限 -> PASS
- 频道消息流滚动后，reply action 仍可直接把 thread 交给右侧 rail，说明高亮与入口没有漂移 -> PASS

### Room Composer + Thread Rail
- Room issue link 命中区 72x44，达到高频点击下限 -> PASS
- Room board link 命中区 128x44，达到高频点击下限 -> PASS
- Room composer 保持在当前视口内 (1164 / 1200) -> PASS
- Room composer after scroll 保持在当前视口内 (1164 / 1200) -> PASS
- Room reply action 命中区 87x44，达到高频点击下限 -> PASS
- Thread lock action 命中区 109x44，达到高频点击下限 -> PASS
- room message list 在滚动与 thread 打开后，composer 仍常驻可见，follow-thread 控件也维持可点 -> PASS

### Work Surface Density
- Setup work surface 在 1600px 视口下没有横向溢出 -> PASS
- Inbox work surface 在 1600px 视口下没有横向溢出 -> PASS
- Setup / Inbox 都沿用更紧凑的 work shell 卡片密度，没有再出现需要横向挤压的白缝 -> PASS

### Narrow Viewport Spot Check
- Narrow room surface 在 1180px 视口下没有横向溢出 -> PASS
- Narrow room composer 保持在当前视口内 (1064 / 1100) -> PASS
- 1180px 窄屏抽查下，message list 与 composer 仍同页可用，不需要横向拖拽 -> PASS

## Screenshots

- chat-channel-scrollback: /tmp/openshock-tkt24-exact-artifacts/screenshots/01-chat-channel-scrollback.png
- chat-thread-focus: /tmp/openshock-tkt24-exact-artifacts/screenshots/02-chat-thread-focus.png
- room-scrollback: /tmp/openshock-tkt24-exact-artifacts/screenshots/03-room-scrollback.png
- room-thread-rail: /tmp/openshock-tkt24-exact-artifacts/screenshots/04-room-thread-rail.png
- setup-density: /tmp/openshock-tkt24-exact-artifacts/screenshots/05-setup-density.png
- inbox-density: /tmp/openshock-tkt24-exact-artifacts/screenshots/06-inbox-density.png
- room-narrow: /tmp/openshock-tkt24-exact-artifacts/screenshots/07-room-narrow.png

# 2026-04-11 Windows Chrome Shell Profile Hub / Profile Surface Report

- Scope: `TKT-88 / CHK-16 / TC-077` + regression of `TKT-25 / TC-030`
- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-profile-surface -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-shell-profile-hub.md`
- Artifacts Dir: `/tmp/openshock-profile-surface-tfrXAH`

## Results
- 左栏固定 Profile Hub 现在会常驻显示当前 Human / Machine / Agent，点 Human 会直接进入统一 Human profile，并保留同一套壳层。
- Profile Hub 里的 Machine entry 会一跳进入当前 paired machine profile，直接看到 heartbeat、runtime capability、recent run/room 与 bound agents。
- Profile Hub 里的 Agent entry 会一跳进入当前 preferred/on-duty agent profile，不再需要绕到右栏或独立列表页。
- room context 里的 active agent drill-in 仍保持可用；Room 与 shell footer 都能进入同一套 Agent profile surface。
- room context 里的 machine drill-in 也保持可用；当前 room 的执行上下文和 shell-level machine 入口继续收敛到同一份 live profile truth。

## Screenshots
- room-context-shell-profile-hub: /tmp/openshock-profile-surface-tfrXAH/screenshots/01-room-context-shell-profile-hub.png
- shell-human-profile: /tmp/openshock-profile-surface-tfrXAH/screenshots/02-shell-human-profile.png
- shell-machine-profile: /tmp/openshock-profile-surface-tfrXAH/screenshots/03-shell-machine-profile.png
- shell-agent-profile: /tmp/openshock-profile-surface-tfrXAH/screenshots/04-shell-agent-profile.png
- room-agent-profile: /tmp/openshock-profile-surface-tfrXAH/screenshots/05-room-agent-profile.png
- room-machine-profile: /tmp/openshock-profile-surface-tfrXAH/screenshots/06-room-machine-profile.png

## Single Value
- 左栏固定 Profile Hub 现在把当前 Human / Machine / Agent 收成 app.slock.ai 式壳层入口；shell footer 与 room context 都会进入同一套 unified profile surface，profile truth 不再散落在右栏或孤立页面里。

# TKT-03 Headed Setup E2E Report

Date: 2026-04-09T15:14:58.377Z
Project Root: /home/lark/OpenShock
Workspace Root: /tmp/openshock-tkt03-headed-setup-8KIrTF/workspace
Artifacts Root: /tmp/openshock-tkt03-headed-setup-8KIrTF
Chromium: /snap/bin/chromium

## Environment

- Web: http://127.0.0.1:43528
- Server: http://127.0.0.1:43568
- Daemon: http://127.0.0.1:44170

## Setup Checks

- Repo Binding Status: 已绑定
- Repo Binding Message: 当前工作区已读取到仓库真值：Larkspur-Wang/OpenShock
- GitHub Readiness Status: 可进远端 PR
- GitHub Message: GitHub CLI 已认证，可以继续推进真实远端 PR 集成。
- Runtime Selection: shock-main
- Pairing Value: browser-approved / 已配对
- Bridge Output (excerpt): The setup bridge is online.

## Lane Checks

- Issue: OPS-28 / TKT-03 headed setup e2e 1775747632830
- Room: room-tkt-03-headed-setup-e2e-1775747632830
- Run: run_tkt-03-headed-setup-e2e-1775747632830_01
- Pull Request Action: 发起 PR (enabled)
- Pull Request Label: 未创建 PR
- Pull Request Status: allowed
- Run Next Action: 等待 worktree lane；`shock-sidecar` 当前不可调度，调度器已 failover 到 `shock-main`，当前承载 2 条 active lease。
- Room URL: http://127.0.0.1:43528/rooms/room-tkt-03-headed-setup-e2e-1775747632830

## Evidence

- setup-shell: /tmp/openshock-tkt03-headed-setup-8KIrTF/screenshots/01-setup-shell.png
- setup-binding-and-github: /tmp/openshock-tkt03-headed-setup-8KIrTF/screenshots/02-setup-binding-and-github.png
- setup-runtime-and-bridge: /tmp/openshock-tkt03-headed-setup-8KIrTF/screenshots/03-setup-runtime-and-bridge.png
- room-pr-entry-ready: /tmp/openshock-tkt03-headed-setup-8KIrTF/screenshots/04-room-pr-entry-ready.png
- trace: /tmp/openshock-tkt03-headed-setup-8KIrTF/trace.zip
- daemon log: /tmp/openshock-tkt03-headed-setup-8KIrTF/logs/daemon.log
- server log: /tmp/openshock-tkt03-headed-setup-8KIrTF/logs/server.log
- web log: /tmp/openshock-tkt03-headed-setup-8KIrTF/logs/web.log

## Result

- TC-001 Setup shell visibility: PASS
- TC-002 Repo binding via Setup: PASS
- TC-003 Runtime pairing and bridge prompt via Setup: PASS
- TC-026 Headed Setup to PR entry-ready journey: PASS

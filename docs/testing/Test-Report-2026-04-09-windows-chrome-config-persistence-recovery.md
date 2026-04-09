# Test Report 2026-04-09 Config Persistence / Recovery

- Command: `pnpm test:headed-config-persistence-recovery -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-config-persistence-recovery.md`
- Generated At: 2026-04-09T14:49:54.994Z

## Result

- Settings writes now carry onboarding plus workspace sandbox baseline, and survive immediate browser reload without falling back to client-only draft state.
- `/access` projects the same member preference and GitHub identity snapshot that `/settings` wrote.
- `/setup` reads the same onboarding template, status, and resume URL from the durable workspace snapshot.
- Restarting the server against the same state file keeps both workspace and member config truth intact.
- A second browser context still reads the same workspace/member truth, so recovery is not tied to one browser tab.

## Evidence

- settings-before-write: `../../../tmp/openshock-tkt37-config-persistence-oXhfEZ/run/screenshots/01-settings-before-write.png`
- settings-after-write: `../../../tmp/openshock-tkt37-config-persistence-oXhfEZ/run/screenshots/02-settings-after-write.png`
- access-projection: `../../../tmp/openshock-tkt37-config-persistence-oXhfEZ/run/screenshots/03-access-projection.png`
- setup-projection: `../../../tmp/openshock-tkt37-config-persistence-oXhfEZ/run/screenshots/04-setup-projection.png`
- settings-after-server-restart: `../../../tmp/openshock-tkt37-config-persistence-oXhfEZ/run/screenshots/05-settings-after-server-restart.png`
- second-device-recovery: `../../../tmp/openshock-tkt37-config-persistence-oXhfEZ/run/screenshots/06-second-device-recovery.png`

## Scope

- Edited workspace onboarding/template/browser-push/memory-mode/sandbox baseline from `/settings`.
- Edited member preferred-agent/start-route/github-identity from `/settings`.
- Verified same truth from `/access` and `/setup` after reload, server restart, and second browser context replay.

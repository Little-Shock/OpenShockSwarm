# Test Report 2026-04-09 Config Persistence / Recovery

- Command: `pnpm test:headed-config-persistence-recovery -- --report docs/testing/Test-Report-2026-04-09-config-persistence-recovery.refresh.md`
- Generated At: 2026-04-08T17:10:14.539Z

## Result

- Settings writes survive immediate browser reload without falling back to client-only draft state.
- `/access` projects the same member preference and GitHub identity snapshot that `/settings` wrote.
- `/setup` reads the same onboarding template, status, and resume URL from the durable workspace snapshot.
- Restarting the server against the same state file keeps both workspace and member config truth intact.
- A second browser context still reads the same workspace/member truth, so recovery is not tied to one browser tab.

## Evidence

- settings-before-write: `../openshock-tkt37-artifacts-r2/run/screenshots/01-settings-before-write.png`
- settings-after-write: `../openshock-tkt37-artifacts-r2/run/screenshots/02-settings-after-write.png`
- access-projection: `../openshock-tkt37-artifacts-r2/run/screenshots/03-access-projection.png`
- setup-projection: `../openshock-tkt37-artifacts-r2/run/screenshots/04-setup-projection.png`
- settings-after-server-restart: `../openshock-tkt37-artifacts-r2/run/screenshots/05-settings-after-server-restart.png`
- second-device-recovery: `../openshock-tkt37-artifacts-r2/run/screenshots/06-second-device-recovery.png`

## Scope

- Edited workspace onboarding/template/browser-push/memory-mode from `/settings`.
- Edited member preferred-agent/start-route/github-identity from `/settings`.
- Verified same truth from `/access` and `/setup` after reload, server restart, and second browser context replay.

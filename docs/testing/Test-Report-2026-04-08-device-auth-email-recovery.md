# 2026-04-08 Device Authorization / Email Verification / Reset Report

- Command: `pnpm test:headed-device-auth-email-recovery -- --report docs/testing/Test-Report-2026-04-08-device-auth-email-recovery.md`
- Artifacts Dir: `/tmp/openshock-tkt29-artifacts`

## Results
- Invited member can log in on a named device and immediately surface pending email verification plus pending device authorization in the same `/access` recovery panel.
- Verifying email and authorizing the current device push both member truth and session truth forward without dropping role-based permissions.
- Password reset recovery on another device keeps the same member permission boundary while switching the active session onto the recovery device.
- External identity binding lands in the same member truth and is visible alongside authorized devices and recovery status.

## Screenshots
- owner-baseline: /tmp/openshock-tkt29-artifacts/run/screenshots/01-owner-baseline.png
- member-invited: /tmp/openshock-tkt29-artifacts/run/screenshots/02-member-invited.png
- pending-verify-device: /tmp/openshock-tkt29-artifacts/run/screenshots/03-pending-verify-device.png
- verified-and-authorized: /tmp/openshock-tkt29-artifacts/run/screenshots/04-verified-and-authorized.png
- reset-requested: /tmp/openshock-tkt29-artifacts/run/screenshots/05-reset-requested.png
- password-reset-recovered: /tmp/openshock-tkt29-artifacts/run/screenshots/06-password-reset-recovered.png
- identity-bound: /tmp/openshock-tkt29-artifacts/run/screenshots/07-identity-bound.png

## Single Value
- `/access` 现在已经把 `device authorization / email verification / password reset / session recovery / external identity binding` 收成同一条 live identity chain；新成员、换设备和忘记密码不再停在 invite / quick login 的半成品状态。

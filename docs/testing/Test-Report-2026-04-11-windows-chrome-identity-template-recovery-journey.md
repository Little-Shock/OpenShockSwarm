# 2026-04-11 Windows Chrome Identity Template Recovery Journey Report

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-identity-template-recovery-journey -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-identity-template-recovery-journey.md`
- Artifacts Dir: `/tmp/openshock-tkt44-identity-template-journey-tCJB2m`
- Web: `http://127.0.0.1:43730`
- Server: `http://127.0.0.1:44758`

## Results

- `/settings` 已先接住 workspace email subscriber `ops@openshock.dev`，identity template chain 不再停在局部 auth mutation。
- `/access` invite 之后，`auth_invite` 会直接出现在 `/settings` 的 identity template chain；首次 fanout 已送达 `1` 条 invite receipt。
- invited member quick login 后，再触发 reset pending，会把 `auth_verify_email` / `auth_password_reset` / `auth_blocked_recovery` 同时折进统一 delivery truth；第二次 fanout 已送达 `5` 条 recovery receipts。
- 返回 `/access` 完成邮箱验证、当前设备授权和另一设备密码重置后，session recovery 会回到 `已恢复`，说明 invite -> verify/reset -> delivery -> recovery 已经是同一条产品旅程。

## Template Evidence

- invite fanout templates: `ops_approval, ops_blocked_escalation, auth_invite`
- recovery fanout templates: `ops_approval, ops_blocked_escalation, auth_password_reset, auth_verify_email, auth_blocked_recovery`

## Screenshots

- settings-identity-delivery-ready: `../../../tmp/openshock-tkt44-identity-template-journey-tCJB2m/run/screenshots/01-settings-identity-delivery-ready.png`
- access-invite-created: `../../../tmp/openshock-tkt44-identity-template-journey-tCJB2m/run/screenshots/02-access-invite-created.png`
- settings-invite-template-fanout: `../../../tmp/openshock-tkt44-identity-template-journey-tCJB2m/run/screenshots/03-settings-invite-template-fanout.png`
- access-verify-reset-pending: `../../../tmp/openshock-tkt44-identity-template-journey-tCJB2m/run/screenshots/04-access-verify-reset-pending.png`
- settings-recovery-template-fanout: `../../../tmp/openshock-tkt44-identity-template-journey-tCJB2m/run/screenshots/05-settings-recovery-template-fanout.png`
- access-recovery-complete: `../../../tmp/openshock-tkt44-identity-template-journey-tCJB2m/run/screenshots/06-access-recovery-complete.png`

## Scope

- Configured `/settings` notification policy + email subscriber for identity delivery.
- Verified `/access` invite writes `auth_invite` into the identity template chain and fanout worker.
- Verified quick login + reset pending writes `auth_verify_email`, `auth_password_reset`, and `auth_blocked_recovery` into the same template chain and worker receipts.
- Verified final `/access` recovery completes on another device after verify + authorize.

VERDICT: PASS

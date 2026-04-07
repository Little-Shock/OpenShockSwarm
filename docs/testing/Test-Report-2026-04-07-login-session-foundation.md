# TKT-07 Login / Session Foundation Report

- Command: `pnpm test:headed-session-foundation -- --report docs/testing/Test-Report-2026-04-07-login-session-foundation.md`
- Artifacts Dir: `/tmp/openshock-tkt07-session-foundation-ABvVCt`

## Results

### Access Session Lifecycle

- Initial session: `active / larkspur@openshock.dev / Owner`
- Quick login member: `mina@openshock.dev / Member`
- Session persistence after reload: PASS
- Logout state: `signed out / 未分配`
- Signed-out persistence after reload: PASS
- Owner restore after quick login: PASS

### Permission Surface

- Owner: `issue.create = allowed`, `runtime.manage = allowed`
- Member: `issue.create = allowed`, `runtime.manage = blocked`
- Signed out: `issue.create = blocked`, `inbox.review = blocked`

### Screenshots

- owner-session: /tmp/openshock-tkt07-session-foundation-ABvVCt/run/screenshots/01-owner-session.png
- member-session: /tmp/openshock-tkt07-session-foundation-ABvVCt/run/screenshots/02-member-session.png
- member-session-persisted: /tmp/openshock-tkt07-session-foundation-ABvVCt/run/screenshots/03-member-session-persisted.png
- signed-out-session: /tmp/openshock-tkt07-session-foundation-ABvVCt/run/screenshots/04-signed-out-session.png
- signed-out-session-persisted: /tmp/openshock-tkt07-session-foundation-ABvVCt/run/screenshots/05-signed-out-session-persisted.png
- owner-session-restored: /tmp/openshock-tkt07-session-foundation-ABvVCt/run/screenshots/06-owner-session-restored.png

## Conclusion

- `/access` 现在已站住真实 login / logout / session lifecycle，不再停在静态占位说明。
- 刷新后 session 仍保持当前登录态，证明 foundation 不只是单次前端内存状态。
- 当前票只收 session foundation；invite / role mutation / action-level authz matrix 继续留给后续票。

# TKT-08 Workspace Invite / Member / Role Report

- Command: `pnpm test:headed-workspace-member-role -- --report docs/testing/Test-Report-2026-04-07-workspace-invite-member-role.md`
- Artifacts Dir: `/tmp/openshock-tkt08-workspace-member-role-DknmOQ`

## Results

### Invite / Role / Status Lifecycle

- Owner invited `reviewer@openshock.dev` as `Viewer` -> PASS
- Owner changed invited reviewer role from `Viewer` to `Member` -> PASS
- Reviewer quick login activated invited member and surfaced `Member` session -> PASS
- Owner suspended reviewer and roster status flipped to `已暂停` -> PASS
- Suspended reviewer login failed closed with `workspace member is suspended` -> PASS

### Permission Surface

- Owner session: `members.manage = live`, `runtime.manage = allowed`
- Reviewer member session: `issue.create = allowed`, `runtime.manage = blocked`, `members.manage = hidden`
- Suspended reviewer login attempt leaves owner session intact and surfaces explicit error

### Screenshots

- invited-viewer: /tmp/openshock-tkt08-workspace-member-role-DknmOQ/run/screenshots/01-invited-viewer.png
- invited-member: /tmp/openshock-tkt08-workspace-member-role-DknmOQ/run/screenshots/02-invited-member.png
- member-activated: /tmp/openshock-tkt08-workspace-member-role-DknmOQ/run/screenshots/03-member-activated.png
- member-suspended: /tmp/openshock-tkt08-workspace-member-role-DknmOQ/run/screenshots/04-member-suspended.png
- suspended-login-blocked: /tmp/openshock-tkt08-workspace-member-role-DknmOQ/run/screenshots/05-suspended-login-blocked.png

## Conclusion

- `/access` 现在已把 owner-side invite、member role/status mutation 接到 live API，而不是只展示 read-only roster。
- invited member 会在首次登录时转成 `active`，role 变化会同步反映到 session permissions 和 browser probes。
- 当前票只收 workspace invite / member / role；更大范围的 action-level authz matrix 继续留给 `TKT-09`。

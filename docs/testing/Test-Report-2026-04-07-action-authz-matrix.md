# TKT-09 Action-level AuthZ Matrix Report

- Generated At: 2026-04-07T06:47:37.314Z
- Scope: Board / Room / Inbox / Setup action-level authz matrix
- Result: PASS
- Exact Checks:
  - `pnpm test:headed-action-authz-matrix -- --report docs/testing/Test-Report-2026-04-07-action-authz-matrix.md`
  - `cd apps/server && ../../scripts/go.sh test ./internal/api -run 'TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces' -count=1`
  - `pnpm verify:release`

## Owner

- Board create issue: allowed / create button enabled
- Room reply: allowed / send enabled
- Room PR action: allowed / merge action enabled on existing PR
- Inbox review/approval actions: owner can merge review items and approve approval cards
- Setup repo/runtime/exec authz: repo.admin + runtime.manage + run.execute all allowed

## Member

- Board create issue: allowed / create button enabled
- Room reply: allowed / send enabled
- Room PR action: review_only / sync enabled, merge withheld
- Inbox split: changes_requested enabled, merge/approve disabled
- Setup repo/runtime/exec authz: repo/runtime admin blocked, exec allowed

## Viewer

- Board create issue: blocked / create button disabled
- Room reply + PR: reply + PR actions blocked
- Inbox actions: review / approve / merge actions blocked
- Setup actions: repo / runtime / exec all blocked

## Signed Out

- Board / Room / Setup actions: board create, room reply, room PR, setup repo/runtime/exec all signed_out + disabled

## Boundary

- `TC-024` 当前按这张票转成 `Pass`。
- `TC-027` 仍保持 `Not Run`；destructive approval / sandbox / 越界写保护继续留给后续安全票，不借写成已完成。

## Evidence

- owner-board: /tmp/openshock-tkt09-authz-r3/run/screenshots/01-owner-board.png
- owner-room: /tmp/openshock-tkt09-authz-r3/run/screenshots/02-owner-room.png
- owner-inbox: /tmp/openshock-tkt09-authz-r3/run/screenshots/03-owner-inbox.png
- owner-setup: /tmp/openshock-tkt09-authz-r3/run/screenshots/04-owner-setup.png
- member-room: /tmp/openshock-tkt09-authz-r3/run/screenshots/05-member-room.png
- member-setup: /tmp/openshock-tkt09-authz-r3/run/screenshots/06-member-setup.png
- viewer-room: /tmp/openshock-tkt09-authz-r3/run/screenshots/07-viewer-room.png
- viewer-setup: /tmp/openshock-tkt09-authz-r3/run/screenshots/08-viewer-setup.png
- signed-out-setup: /tmp/openshock-tkt09-authz-r3/run/screenshots/09-signed-out-setup.png

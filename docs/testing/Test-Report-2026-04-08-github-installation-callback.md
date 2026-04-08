# Test Report 2026-04-08 GitHub Installation Callback

- Branch: `tkt-28-installation-complete-callback`
- Workspace: `/tmp/openshock-tkt28`
- Scope: `TKT-28 / CHK-07 / TC-015`
- Evidence mode: near-real exact-head contract + production build replay

## Scope

- 覆盖 installation-complete callback 持久化与 repo binding refresh。
- 覆盖 tracked PR backfill 在 callback 完成后自动前滚。
- 覆盖 Setup callback return page 的 typecheck / build / release gate。
- 覆盖 fail-closed 探测：空 `installationId` 与 `repo.admin` 权限 guard。

## Commands

### GitHub installation state fallback and probe contract

- Command: `go test ./apps/server/internal/github -run 'TestProbeFallsBackToPersistedInstallationState|TestLoadInstallationStateRoundTrips|TestSyncPullRequestUsesPersistedInstallationStateWhenEnvInstallationIDIsMissing' -count=1`
- Result: `PASS`
- Output:

```text
ok  	github.com/Larkspur-Wang/OpenShock/apps/server/internal/github	0.159s
```

### Installation callback happy-path and fail-closed path

- Command: `go test ./apps/server/internal/api -run 'TestGitHubInstallationCallbackPersistsInstallTruthAndRefreshesRepoBinding|TestGitHubInstallationCallbackRejectsMissingInstallationID' -count=1`
- Result: `PASS`
- Output:

```text
ok  	github.com/Larkspur-Wang/OpenShock/apps/server/internal/api	0.139s
```

### Auth mutation guard includes callback route

- Command: `go test ./apps/server/internal/api -run 'TestMutationRoutesRequireActiveAuthSession|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations|TestViewerRoleCannotMutateProtectedSurfaces' -count=1`
- Result: `PASS`
- Output:

```text
ok  	github.com/Larkspur-Wang/OpenShock/apps/server/internal/api	0.530s
```

### Frontend callback page typecheck

- Command: `pnpm typecheck:web`
- Result: `PASS`
- Output:

```text
Generating route types...
✓ Types generated successfully
```

### Release gate replay

- Command: `pnpm verify:release`
- Result: `PASS`
- Key observations:
  - `next build` 成功产出 `/setup/github/callback` 静态页面。
  - `verify:server`、`verify:daemon` 全绿。
  - lint 仍打印 `stitch-chat-room-views.tsx` 里 4 条既有 `react-hooks/exhaustive-deps` warnings，但没有升级成 error，也不属于本票 touched scope。

## TC-015 GitHub App 安装与 Webhook

- 当前执行状态: Pass
- 实际结果:
  - installation-complete callback 会把 `installationId` 写入 `data/phase0/github-app-installation.json`。
  - callback 成功后会重新 probe GitHub readiness、refresh repo binding，并对 store 内 tracked PR 做 backfill sync。
  - `/setup/github/callback` 现在可独立 typecheck/build，并自动把用户带回 Setup。
  - 空 `installationId` 会 400 fail-closed，未授权 session 也不能调用该写接口。
  - webhook 事件持续同步这半段继续沿用 `TKT-05` 的 signed replay exact evidence。
- 业务结论: 当前 `installation-complete callback -> repo sync -> UI update -> webhook replay` 已能在同一条真值链上独立复核；未覆盖项只剩 GitHub-hosted 公网 callback / webhook delivery 的生产态复核。

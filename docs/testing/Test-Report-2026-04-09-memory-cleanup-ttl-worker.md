# 2026-04-09 Memory Cleanup / TTL / Promotion Worker Report

- Ticket: `#151 / TKT-43`
- Checklist: `CHK-10`
- Test Cases: `TC-019` `TC-023`
- Workspace: `/tmp/openshock-tkt43`

## Commands

```bash
./scripts/go.sh test ./apps/server/internal/store -run 'TestMemoryCenterBuildsInjectionPreviewAndPromotionLifecycle|TestMemoryCleanupPrunesStaleQueueAndKeepsPromotionPathLive' -count=1
./scripts/go.sh test ./apps/server/internal/api -run 'TestMemoryCenterRoutesExposePolicyPreviewAndPromotionLifecycle|TestMemoryCenterCleanupRoutePrunesQueueAndKeepsPromotionFlowLive|TestMutationRoutesRequireActiveAuthSession|TestViewerRoleCannotMutateProtectedSurfaces|TestMemberRoleGuardsAllowReviewAndExecutionButDenyAdminAndMergeMutations' -count=1
pnpm install --frozen-lockfile
pnpm -C apps/web typecheck
pnpm -C apps/web build
pnpm verify:release
```

## Results

- Store cleanup regression: PASS
  - stale pending, duplicate pending, forgotten-source pending, and expired rejected promotions are pruned from the queue
  - cleanup ledger records actor, summary, recovery note, and removal counts
  - cleanup leaves the promotion path live: a fresh policy promotion still approves into `notes/policies.md` and re-enters next-run preview truth
- API cleanup contract: PASS
  - `POST /v1/memory-center/cleanup` returns `cleanup + center + state`
  - route is guarded by `memory.write`
  - cleanup response updates pending counts and ledger truth immediately
- Web surface: PASS
  - memory center now exposes cleanup summary, recovery note, recent ledger entries, and a `run cleanup` action on the same live truth as promotion review
- Release gate: PASS
  - residual remains only the repo-known 4 `stitch-chat-room-views.tsx` `react-hooks/exhaustive-deps` warnings

## Adversarial Probe

Exact live probe:

```json
{
  "cleanupStatus": "cleaned",
  "removed": 3,
  "deduped": 1,
  "superseded": 1,
  "forgotten": 1,
  "pendingAfterCleanup": 1,
  "freshPromotionStatus": "approved",
  "policiesInjected": true
}
```

Probe meaning:

- two duplicate review requests were collapsed to one live pending request
- a stale request tied to an older artifact version was removed
- a request tied to a forgotten artifact was removed
- after cleanup, a fresh policy promotion still approved and the policies ledger re-entered preview truth

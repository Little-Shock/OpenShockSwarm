# OpenShock Stage 3 Entry

This repository is in Stage 3 delivery and operations readiness.

Use fixed directory `/Users/atou/OpenShockSwarm` as the only release and handoff root.

Start here:

- `docs/stage3-delivery-ops-entry.md`
- `docs/stage3-release-gate.md`
- `apps/shell/README.md`

Current regression baseline:

- `feat/initial-implementation@0116e37`
- `apps/server 33/33 pass`

Run the default Stage 3 release gate from repo root:

```bash
bash scripts/stage3-release-gate.sh
```

Boundary lock:

- Keep `channel -> workspace(root) -> repo/worktree -> agent`
- Do not re-introduce multi-human collaboration scope
- Do not add new backend truth or shadow shell truth paths

# Stage 3 Delivery and Ops Entry

This document is the single Stage 3 handoff entry for delivery and operations readiness.

Fixed root:

- `/Users/atou/OpenShockSwarm`

Do not use `.slock/.../OpenShockSwarm` copies as release or handoff entry.

## Required Entry Set

Use this set together and keep it aligned:

- `README.md`
- `docs/stage3-delivery-ops-entry.md`
- `docs/stage3-release-gate.md`
- `apps/shell/README.md`

## Stage 3 Scope in This Entry

- Shell entry and directory stability
- Release gate fan-in and long-term baseline
- Delivery/ops references aligned to fixed root

Out of scope:

- New runtime features
- Multi-human collaboration scope
- New backend nouns or truth surfaces

## Operator Handoff Checklist

1. Open this file from fixed root.
2. Run `bash scripts/stage3-release-gate.sh`.
3. Record head ref and gate output in the handoff note.
4. If gate fails, stop handoff and attach failing command output.
5. Use component docs only as detail references, not as parallel entry roots.

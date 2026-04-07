# Stage 3 Release Gate

This gate is the default release and handoff check for Stage 3.

## Baseline

- Minimum baseline ref: `0116e37` (or newer head that contains it)
- Test baseline: `apps/server 33/33 pass`

## Run

From repo root:

```bash
bash scripts/stage3-release-gate.sh
```

## Gate Contents

- Shell adapter syntax:
  - `node --check apps/shell/scripts/dev-server.mjs`
  - `node --check apps/shell/src/app.js`
- Server automated tests:
  - `cd apps/server && node --test`
- `/v1` smoke on isolated local server port:
  - `POST /runtime/fixtures/seed`
  - `GET /v1/topics?limit=1`
  - `GET /runtime/smoke`
- Entry contract check:
  - Stage 3 entry files exist
  - Stage 3 entry files do not point to `.slock/.../OpenShockSwarm`

## Output Contract

Gate must end with:

- `STAGE3_GATE_OK ...`

Any non-zero exit is a blocker for release or handoff.

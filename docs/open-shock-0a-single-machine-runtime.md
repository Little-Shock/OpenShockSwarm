# OpenShock 0A Single-Machine Runtime Entry

This file is the component-level 0A integrated runtime note.

Stage 3 release and handoff entry has moved to:

- `docs/stage3-delivery-ops-entry.md`
- `docs/stage3-release-gate.md`

Use `runtime/shared-runtime-config.example.json` as the shared config template for server, daemon, and shell bring-up.

## Paths Locked by #14

- Shared config template: `runtime/shared-runtime-config.example.json`
- Runtime entry doc: `docs/open-shock-0a-single-machine-runtime.md`

Segment references that stay as component detail notes:

- `apps/server/README.md`
- `apps/shell/README.md`
- `docs/daemon-integrated-runtime.md`

## Single-Machine Up

0. Ensure no stale single-machine runtime process is still using the fixed ports:

```bash
pkill -f 'apps/server/src/index.js' || true
pkill -f 'apps/shell/scripts/dev-server.mjs' || true
```

1. Prepare runtime config from template:

```bash
cp runtime/shared-runtime-config.example.json runtime/shared-runtime-config.json
```

2. Start server runtime:

```bash
PORT=4315 node apps/server/src/index.js
```

3. Start shell runtime on top of the same server:

```bash
SHELL_PORT=4174 SHELL_API_UPSTREAM=http://127.0.0.1:4315 node apps/shell/scripts/dev-server.mjs
```

4. Bring daemon into integrated runtime and run one demo publish:

```bash
go run ./cmd/openshock-daemon integrated-up --config runtime/shared-runtime-config.json
go run ./cmd/openshock-daemon integrated-demo --config runtime/shared-runtime-config.json
```

5. Quick integrated health checks:

```bash
curl -sS http://127.0.0.1:4315/runtime/smoke
curl -sS http://127.0.0.1:4174/api/v0a/shell-state
```

## Single-Machine Down

Stop server and shell processes started in the up sequence:

```bash
pkill -f 'apps/server/src/index.js' || true
pkill -f 'apps/shell/scripts/dev-server.mjs' || true
```

Daemon commands above are one-shot and exit after completion.

## QA Operator Note

QA rerun should start from this file only.

Pass/fail is based on the same shared config and the same live server path:

- server runtime endpoints reachable via `/runtime/*`
- shell state and actions reachable via `/api/v0a/*` adapter backed by server-owned endpoints
- daemon integrated-up and integrated-demo can publish runtime events into server stream

If any step fails, record the failing command and stop the rerun until owner fixes that segment.

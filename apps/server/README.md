# OpenShock Server

Go API for the OpenShock local-first control plane baseline.

Canonical product/start/release docs:

- root `README.md`
- `docs/engineering/Runbook.md`
- `docs/engineering/Release-Gate.md`

Current live baseline:

- `cmd/openshock-server/main.go` exposes a small standard-library HTTP server
- `GET /healthz` returns liveness
- `GET /v1/state`, `GET /v1/state/stream`, and `GET /v1/experience-metrics` expose the current workspace snapshot and observable product baseline
- `GET /v1/workspace`, `GET /v1/channels`, `GET /v1/issues`, `GET /v1/rooms`, `GET /v1/runs`, `GET /v1/agents`, `GET /v1/inbox`, `GET /v1/mailbox`, `GET /v1/memory`, `GET /v1/memory-center`, and `GET /v1/pull-requests` expose live control-plane objects
- `GET /v1/auth/session` and `GET /v1/workspace/members` expose the current auth/member baseline
- `GET /v1/notifications`, `GET /v1/credentials`, and `GET /v1/planner/queue` expose notification, secret-scope, and planner/governance surfaces already used by the product shell
- `POST /v1/issues` creates issue -> room -> run -> session and attempts worktree lane ensure
- `POST /v1/runs/:id/control` supports stop / resume / follow-thread
- `GET/POST/DELETE /v1/runtime/pairing` manages server <-> daemon pairing state
- `GET /v1/runtime/registry` and `GET /v1/runtime/live-service` expose runtime heartbeat and live-stack parity signals
- `GET/POST /v1/repo/binding` and `GET /v1/github/connection` expose setup readiness
- GitHub App installation callback, signed webhook replay, and effective auth path are part of the current baseline
- `POST /v1/exec` and room message streaming proxy prompt execution to the local daemon
- GitHub PR create / sync / merge can use `gh CLI` or GitHub App effective auth, depending on probe truth

Still not production-grade:

- hosted identity, multi-tenant member operations, and full external auth operations
- Internet-facing GitHub SaaS hardening, DNS/TLS environment drills, and broader webhook failure operations
- external notification provider operations and delivery infrastructure
- DB-backed control plane, hosted deployment topology, and fully automated release infrastructure

Run:

```powershell
go run ./cmd/openshock-server
```

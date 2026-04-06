# OpenShock Server

Go API shell for the OpenShock Phase 0 control plane.

Current shape:

- `cmd/openshock-server/main.go` exposes a small standard-library HTTP server
- `GET /healthz` returns liveness
- `GET /v1/state` returns the aggregated Phase 0 workspace snapshot
- `GET /v1/workspace`, `GET /v1/channels`, `GET /v1/issues`, `GET /v1/rooms`, `GET /v1/runs`, `GET /v1/agents`, `GET /v1/inbox`, `GET /v1/memory`, `GET /v1/pull-requests` expose live control-plane objects
- `GET /v1/auth/session` and `GET /v1/workspace/members` expose the current auth/member baseline
- `POST /v1/issues` creates issue -> room -> run -> session and attempts worktree lane ensure
- `GET/POST/DELETE /v1/runtime/pairing` manages server <-> daemon pairing state
- `GET/POST /v1/repo/binding` and `GET /v1/github/connection` expose setup readiness
- `POST /v1/exec` and room message streaming proxy prompt execution to the local daemon

Still not complete:

- GitHub App install/webhook/real remote PR sync
- full auth/member/role management
- production notification delivery
- full multi-runtime scheduler/failover

Run:

```powershell
go run ./cmd/openshock-server
```

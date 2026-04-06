# OpenShock Daemon

Go local runtime bridge for the OpenShock Phase 0 machine lane.

Current shape:

- `cmd/openshock-daemon/main.go` exposes a local HTTP daemon
- `GET /healthz` returns liveness
- `GET /v1/runtime` reports detected local providers and runtime snapshot
- `POST /v1/exec` and `POST /v1/exec/stream` execute prompts through local CLI tools
- detects local CLI binaries like `codex` and `claude`
- reports runtime heartbeats back to the server
- ensures `git worktree` lanes for issue execution
- supports a `-once` mode for one-shot inspection output

Still not complete:

- multi-runtime scheduler participation and failover
- stricter sandbox/policy enforcement
- richer approval handoff and execution governance

Run:

```powershell
go run ./cmd/openshock-daemon --workspace-root E:\00.Lark_Projects\00_OpenShock
```

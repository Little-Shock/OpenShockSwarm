# OpenShock Daemon

Go local runtime bridge for the OpenShock machine lane.

Canonical product/start/release docs:

- root `README.md`
- `docs/engineering/Runbook.md`
- `docs/engineering/Release-Gate.md`

Current live baseline:

- `cmd/openshock-daemon/main.go` exposes a local HTTP daemon
- `GET /healthz` returns liveness
- `GET /v1/runtime` reports detected local providers and runtime snapshot
- `POST /v1/exec` and `POST /v1/exec/stream` execute prompts through local CLI tools
- per-session execution now persists `SOUL.md / MEMORY.md / SESSION.json / CURRENT_TURN.md / notes/channels.md / notes/operating-rules.md / notes/skills.md / notes/rooms/<room>.md / notes/work-log.md` under the daemon session workspace root
- Codex session continuity now uses a session-scoped `OPENSHOCK_CODEX_HOME` under the same workspace root
- provider thread state can now be written back through the daemon thread-state file contract and persisted into `SESSION.json.appServerThreadId`
- detects local CLI binaries like `codex` and `claude`
- reports runtime heartbeats back to the server and participates in runtime registry truth
- ensures `git worktree` lanes for issue execution
- supports a `-once` mode for one-shot inspection output

Still not production-grade:

- deeper multi-machine scheduler operations, fleet failover, and hosted runtime lifecycle management
- stricter sandbox / network / tool policy enforcement beyond the current baseline
- richer approval handoff, operator controls, and cross-machine execution governance

Run:

```powershell
go run ./cmd/openshock-daemon --workspace-root E:\00.Lark_Projects\00_OpenShock
```

Optional environment:

- `OPENSHOCK_AGENT_SESSION_ROOT`
  - override the default daemon session workspace root for persistent per-session continuity files

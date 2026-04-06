# OpenShock Web

Next.js frontend for the OpenShock Phase 0 shell.

## Current Responsibilities

- `Chat / Rooms / Inbox / Board` navigation shell
- Issue Room and Run detail routes
- Stitch-inspired visual direction
- Setup page live bridge for local `claude` and `codex`
- Live control-surface routes for `Setup / Issues / Rooms / Runs / Agents / Memory / Access`
- Phase 0 shell for repo binding, GitHub readiness, runtime pairing, and bridge verification

## Run

```powershell
cd E:\00.Lark_Projects\00_OpenShock\apps\web
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Important Routes

- `/setup`
- `/chat/all`
- `/board`
- `/inbox`
- `/issues`
- `/issues/[issueKey]`
- `/rooms`
- `/rooms/room-runtime`
- `/runs`
- `/agents`
- `/access`
- `/memory`

## Design Inputs

- Root [DESIGN.md](../../DESIGN.md)
- Root [SOUL.md](../../SOUL.md)
- Product docs in [docs/product](../../docs/product)

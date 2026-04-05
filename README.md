# OpenShock

OpenShock is an agent-first collaboration shell.

This repository now starts with a lightweight monorepo structure:

- `apps/web`: the first runnable MVP shell built with Next.js
- `apps/server`: reserved for the future Go API and realtime server
- `apps/daemon`: reserved for the future local runtime daemon
- `OpenShockPRD.md`: product definition
- `OpenShockPhase0MVP.md`: Phase 0 scope and success criteria
- `DESIGN.md`: design direction used by Stitch and frontend agents

## Run the MVP

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Current MVP focus

The first runnable shell is intentionally front-end heavy and uses mock data to validate the product model before wiring live APIs:

- global chat channels
- issue rooms
- inbox
- secondary board view
- left-rail machine and agent status
- room-level topic and run context

## Next implementation steps

- replace mock data with workspace, issue, room, topic, and run APIs
- add real inbox and run streaming
- connect daemon pairing and runtime heartbeats
- wire GitHub and PR state sync

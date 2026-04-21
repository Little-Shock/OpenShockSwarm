# OpenShock Web

Next.js frontend for the OpenShock Phase 0 shell.

Canonical product/start docs:

- root `README.md`
- `docs/engineering/Runbook.md`
- `docs/testing/README.md`

## Current Responsibilities

- `Chat` as the primary workspace shell, with `Rooms / Inbox / Board / Runs / Mailbox / Memory / Settings` around it
- Issue, room, run, topic, PR, and profile drill-in routes
- Setup and onboarding flows for repo binding, GitHub readiness, runtime pairing, and bridge verification
- Live shell surfaces for profiles, mailbox handoff, memory center, access/session, and workspace settings
- Canonical profile routing at `/profiles/[kind]/[profileId]`, with `/agents/[agentId]` kept only as a compatibility redirect

## Run

```powershell
cd E:\00.Lark_Projects\00_OpenShock\apps\web
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Important Routes

- `/`
- `/setup`
- `/onboarding`
- `/chat/all`
- `/board`
- `/inbox`
- `/issues`
- `/issues/[issueKey]`
- `/rooms`
- `/rooms/[roomId]`
- `/runs`
- `/runs/[runId]`
- `/agents`
- `/profiles/[kind]/[profileId]`
- `/topics/[topicId]`
- `/pull-requests/[pullRequestId]`
- `/mailbox`
- `/access`
- `/memory`
- `/settings`

## Product Gaps Still Visible In The UI

- `/` is still a routing-oriented entry, not yet the final product homepage
- `/setup` and `/mailbox` still expose more operator detail than the final simplified product shell should
- DM / followed thread / saved-later continuity is present, but the shell still has room to get closer to the smoother `slock` default experience

## Design Inputs

- Root [DESIGN.md](../../DESIGN.md)
- Root [SOUL.md](../../SOUL.md)
- Product docs in [docs/product](../../docs/product)

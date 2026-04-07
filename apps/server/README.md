# OpenShock Server 0A Skeleton

This module implements the first server-side coordination core for 0A.

For Stage 3 release/handoff entry, start from repo-level files:

- `README.md`
- `docs/stage3-delivery-ops-entry.md`
- `docs/stage3-release-gate.md`

It focuses on the scope frozen in `open-shock-boundary-contract-v2`:

- Topic truth revision ownership
- Structured message routing
- Shared-truth proposal serialization
- Conflict tracking and escalation timers
- Human-gate hold/release
- Delivery state writeback
- Coarse observability read model

## Run

```bash
cd apps/server
npm test
npm start
```

By default the HTTP server listens on `:4300`.

## HTTP endpoints

- `POST /topics`
- `POST /topics/:topicId/agents`
- `POST /topics/:topicId/messages`
- `POST /topics/:topicId/approvals/:holdId/decision`
- `GET /topics/:topicId/overview`
- `GET /topics/:topicId/coarse`
- `GET /topics/:topicId/messages?route=<scope>`
- `GET /runtime/config`
- `POST /runtime/fixtures/seed`
- `POST /runtime/daemon/events`
- `GET /runtime/smoke`
- `GET /health`

## Integrated Runtime Helpers

`/runtime/config` returns the runtime entry contract used by integrated bring-up:

- runtime name
- server port
- shell URL
- daemon identity
- sample topic fixture and endpoint paths

`/runtime/fixtures/seed` creates a deterministic sample topic with one lead and two workers.
It rejects request-body overrides to keep fixture identity deterministic.

`/runtime/daemon/events` lets daemon-side runtime publish execution events into server truth.
It only accepts execution-side event types: `feedback_ingest`, `blocker_escalation`, `status_report`.
Generic write-surface fields are rejected.
Daemon events are bound to the configured runtime daemon identity and registered as a `system` actor before ingest.

`/runtime/smoke` reports whether server is reachable and whether the sample topic is ready.

Example local flow:

```bash
curl -s http://127.0.0.1:4300/runtime/config | jq
curl -s -X POST http://127.0.0.1:4300/runtime/fixtures/seed -H 'content-type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:4300/runtime/daemon/events \
  -H 'content-type: application/json' \
  -d '{"topicId":"topic_0a_sample","type":"feedback_ingest","payload":{"summary":"daemon heartbeat"}}'
curl -s http://127.0.0.1:4300/runtime/smoke | jq
```

## Permission Boundary Notes

`POST /topics/:topicId/messages` rejects:

- unregistered `sourceAgentId`
- `sourceRole` mismatch against the registered actor role
- non-`active` actor status

`POST /topics/:topicId/approvals/:holdId/decision` requires:

- `decider`: registered `human` actor id
- `interventionPoint`: must match the hold gate (for example `pr-merge`)
- `approve`: boolean

and rejects:

- unregistered/non-human decider
- non-`active` human decider
- intervention point that does not match the hold gate

## Notes

This is a coordination skeleton, not a full production backend.
Persistence and distributed durability are intentionally out of scope for 0A skeleton delivery.

# Stage 1 + Stage 2 First-Shot Collaboration Shell

This directory contains the collaboration shell for OpenShock, including:

- Stage 1 productized collaboration workflows
- Stage 2 first-shot + batch2 single-human multi-agent operator-console fan-in

Scope in this stage:

- Room workspace (`1 Room = 1 Topic`) with topic/run/inbox/approval/intervention/follow-up/closeout
- Operator console fan-in for channel/workspace root context, work assignment, recovery action loop, recent actions, repo binding, runtime/machine state, agent registry, and audit trail
- Coarse observability and stable shell adapter actions

Out of scope in this stage:

- New backend truth sources or new backend nouns
- Re-introducing old `/topics/*` shell-local patterns
- Multi-human collaboration workspace/account/role-flow/notifications
- Cross-machine scheduling, cloud runtime, or complex orchestration

## Local run

```bash
# optional if API runs on another host
export SHELL_API_UPSTREAM=http://127.0.0.1:7070
# optional if browser should call API origin directly (without same-origin proxy)
# export SHELL_API_BASE_URL=http://127.0.0.1:7070
node apps/shell/scripts/dev-server.mjs
```

Open:

<http://127.0.0.1:4173>

## Integrated runtime contract

The shell does not own local mock truth. `dev-server.mjs` serves shell assets and keeps one adapter surface (`/api/v0a/*`) composed from stable `/v1` endpoints only:

- `GET /v1/topics?limit=1`
- `GET /v1/topics/:topicId`
- `GET /v1/topics/:topicId/status`
- `GET /v1/topics/:topicId/topic-state`
- `GET /v1/topics/:topicId/merge-lifecycle`
- `GET /v1/topics/:topicId/task-allocation`
- `GET /v1/topics/:topicId/approval-holds?status=pending`
- `GET /v1/topics/:topicId/messages`
- `GET /v1/topics/:topicId/run-history`
- `GET /v1/topics/:topicId/repo-binding`
- `GET /v1/topics/:topicId/actors?limit=100`
- `GET /v1/topics/:topicId/events?limit=20`
- `GET /v1/channels/:channelId/context`
- `PUT /v1/channels/:channelId/context`
- `GET /v1/channels/:channelId/repo-binding`
- `PUT /v1/channels/:channelId/repo-binding`
- `GET /v1/channels/:channelId/audit-trail?limit=50`
- `GET /v1/runtime/registry`
- `GET /v1/runtime/agents?limit=200`
- `PUT /v1/runtime/agents/:agentId/assignment`
- `POST /v1/runtime/agents/:agentId/recovery-actions`
- `GET /v1/runtime/recovery-actions?limit=50`
- `GET /v1/runtime/worktree-claims?limit=200`
- `GET /runtime/config`
- `GET /runtime/smoke`
- `PUT /v1/topics/:topicId/actors/:actorId`
- `POST /v1/topics/:topicId/approval-holds/:holdId/decisions`
- `POST /v1/topics/:topicId/messages`

Adapter routes:

- `GET /api/v0a/shell-state`
  - Returns collaboration shell view model data synthesized from stable `/v1`.
- `POST /api/v0a/approvals/:approvalId/decision`
  - Body: `{ "decision": "approve" | "reject", "operator": "<string>", "note": "<string>" }`
- `POST /api/v0a/interventions/:interventionId/action`
  - Body: `{ "action": "pause" | "resume" | "reroute" | "request_report", "operator": "<string>", "note": "<string>" }`
- `POST /api/v0a/runs/:runId/follow-up`
  - Body: `{ "operator": "<string>", "note": "<string>" }`
  - Writes a `shell_follow_up_request` status event to `/v1/topics/:topicId/messages`.
- `POST /api/v0a/intervention-points/:pointId/action`
  - Body: `{ "action": "approve" | "hold" | "escalate", "operator": "<string>", "note": "<string>" }`
- `POST /api/v0a/operator/repo-binding`
  - Body: `{ "channel_id": "<string>", "topic_id": "<string>", "provider": "<string>", "repo_ref": "<string>", "default_branch": "<string|null>", "operator": "<string>" }`
- `POST /api/v0a/operator/channel-context`
  - Body: `{ "channel_id": "<string>", "workspace_id": "<string>", "workspace_root": "<string>", "baseline_ref": "<string>", "operator": "<string>" }`
- `POST /api/v0a/operator/agents/:actorId/upsert`
  - Body: `{ "role": "lead" | "worker" | "human" | "system", "status": "<string>", "lane_id": "<string|null>" }`
- `POST /api/v0a/operator/agents/:actorId/assignment`
  - Body: `{ "operator": "<string>", "channel_id": "<string>", "thread_id": "<string|null>", "workitem_id": "<string|null>", "status": "<string|null>" }`
- `POST /api/v0a/operator/agents/:actorId/recovery-actions`
  - Body: `{ "action": "resume" | "rebind" | "reclaim_worktree", "operator": "<string>", "channel_id": "<string|null>", "thread_id": "<string|null>", "workitem_id": "<string|null>", "claim_key": "<string|null>", "reason": "<string|null>" }`
- `POST /api/v0a/operator/actions`
  - Body: `{ "action": "<string>", "operator": "<string>", "channel_id": "<string|null>", "thread_id": "<string|null>", "workitem_id": "<string|null>", "run_id": "<string|null>", "target_agent_id": "<string|null>", "note": "<string|null>" }`

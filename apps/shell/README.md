# Stage 3/4/5A/5B Shell Governance and Release Fan-In

This directory hosts the collaboration shell surface used by Stage 1/2 runtime flow, Stage 3 delivery/ops readiness fan-in, Stage 4A1/4A2/4B governance fan-in, Stage 5A hosted workbench fan-in, and Stage 5B hosted multi-human workbench fan-in.

Stage 3 scope for this module:

- Keep shell consuming only stable adapter routes backed by `/v1` truth.
- Keep directory entry and release-gate references in one place.
- Keep regression baseline pinned to `feat/initial-implementation@0116e37` and `apps/server 33/33 pass` (or a newer explicitly recorded baseline).

Out of scope in this stage:

- New backend truth sources or new backend nouns
- Re-introducing shadow shell-local truth paths
- Cross-machine scheduling, cloud runtime, or complex orchestration

Stage 5A hosted workbench fan-in scope:

- Build hosted default entry projection from existing `/v1` truth and `/api/v0a` adapter only
- Keep hosted home, unified inbox, and channel/thread/task default flow in one projection
- Keep local entry and hosted entry on one delivery contract without adding a second collaboration truth

Stage 5B hosted multi-human workbench fan-in scope:

- Build hosted multi-human workbench projection from existing `/v1/channels/*`, `/v1/topics/*`, and `/v1/inbox/*` truth only
- Keep channel/thread/task default flow and unified inbox-attention routing in one Stage5B projection
- Keep shell adapter fail-closed on missing actor inbox registration and never add shell-local shadow truth

Stage 4A1 governance fan-in scope:

- Account/member/GitHub identity -> installation -> repo binding management entry
- Only consume `/v1` governance truth from `channel context` and `channel repo-binding` contracts
- Keep installation authorization and repo binding authorization as separate checks
- When runtime scope has no channel, shell-state may discover channel context from `SHELL_CHANNEL_CANDIDATES`

## Stage 3 Entry Contract

Use fixed directory `/Users/atou/OpenShockSwarm` as the only delivery/handoff root.

Start with:

- `README.md` (repo-level entry)
- `docs/stage3-delivery-ops-entry.md` (single delivery/ops entry)
- `docs/stage3-release-gate.md` (release gate checklist and evidence contract)

Do not treat `.slock/.../OpenShockSwarm` copies as release or handoff entry.

## Local run

```bash
# optional if API runs on another host
export SHELL_API_UPSTREAM=http://127.0.0.1:7070
# optional if browser should call API origin directly (without same-origin proxy)
# export SHELL_API_BASE_URL=http://127.0.0.1:7070
# optional when runtime scope cannot infer channel id
# export SHELL_CHANNEL_CANDIDATES=channel_stage4a1_review,channel_open_shock_stage4a1
node apps/shell/scripts/dev-server.mjs
```

Open:

<http://127.0.0.1:4173>

## Release Gate Baseline

Run Stage 3 gate from repo root:

```bash
bash scripts/stage3-release-gate.sh
```

Gate includes:

- shell adapter syntax checks
- server automated tests
- `/v1` smoke on isolated local server port
- baseline guard (`0116e37` ancestor check)

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
- `GET /v1/channels/:channelId/work-assignments?limit=100`
- `PUT /v1/channels/:channelId/work-assignments/:agentId`
- `GET /v1/channels/:channelId/operator-actions?limit=100`
- `POST /v1/channels/:channelId/operator-actions`
- `GET /v1/channels/:channelId/recent-actions?limit=100`
- `GET /v1/inbox/:actorId?topic_id=:topicId&limit=100`
- `GET /v1/runtime/registry`
- `GET /v1/runtime/agents?limit=200`
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
  - Body: `{ "operator": "<string>", "channel_id": "<string>", "thread_id": "<string|null>", "workitem_id": "<string|null>", "default_duty": "<string|null>", "note": "<string|null>" }`
- `POST /api/v0a/operator/agents/:actorId/recovery-actions`
  - Body: `{ "action": "resume" | "rebind" | "reclaim_worktree", "operator": "<string>", "channel_id": "<string|null>", "thread_id": "<string|null>", "workitem_id": "<string|null>", "claim_key": "<string|null>", "reason": "<string|null>" }`
- `POST /api/v0a/operator/actions`
  - Body: `{ "action_type": "request_report" | "follow_up" | "intervention" | "recovery", "operator": "<string>", "channel_id": "<string>", "thread_id": "<string|null>", "workitem_id": "<string|null>", "agent_id": "<string|null>", "run_id": "<string|null>", "note": "<string|null>" }`
- `POST /api/v0a/workspace-governance/member-upsert`
  - Body: `{ "channel_id": "<string>", "workspace_id": "<string|null>", "member_id": "<string>", "role": "<string>", "status": "<string>", "operator": "<string>" }`
  - Upserts `member` through `PUT /v1/channels/:channelId/context`.
- `POST /api/v0a/workspace-governance/github-identity-upsert`
  - Body: `{ "channel_id": "<string>", "workspace_id": "<string|null>", "provider": "github", "github_login": "<string>", "provider_user_id": "<string|null>", "operator": "<string>" }`
  - Upserts `auth_identity` through `PUT /v1/channels/:channelId/context`.
- `POST /api/v0a/workspace-governance/github-installation-upsert`
  - Body: `{ "channel_id": "<string>", "workspace_id": "<string|null>", "installation_id": "<string>", "provider": "github", "authorized_repos": ["<owner/repo>"], "status": "<string>", "operator": "<string>" }`
  - Upserts `github_installation` through `PUT /v1/channels/:channelId/context`.

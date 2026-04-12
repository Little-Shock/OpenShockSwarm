# OpenShock Agent Turn Orchestration Upgrade

Date: 2026-04-09

## Background

We analyzed a session log from another product that embeds Codex as its execution engine. The main takeaway is not the surface UX, but the daemon contract:

- The daemon wakes an agent for one turn at a time.
- The daemon injects a mode-specific wrapper prompt based on why the agent was woken up.
- The agent runs in a persistent per-agent workspace with memory files.
- The process exits after the turn, and the daemon decides whether to wake it again later.

OpenShock already has `AgentSession`, `AgentTurn`, `providerThreadId`, and `eventFrame`, but today those are mostly observability primitives. The runtime still behaves like a generic executor:

- `agent turn` execution uses a fresh temp directory every time.
- The prompt is chat-first but still mostly one-size-fits-all.
- There is no session workspace or persistent memory substrate behind `providerThreadId`.

## Goals

This upgrade should make OpenShock agent turns behave more like a daemon-driven worker system without over-generalizing beyond current product behavior.

Goals:

1. Make wakeup mode explicit for every currently producible agent turn.
2. Turn `providerThreadId` into a real persistent session-workspace anchor.
3. Upgrade the prompt from a loose chat instruction into a daemon contract.
4. Keep the implementation local, deterministic, and testable.
5. Preserve the current room-visible reply model and existing run/merge flows.

## Non-goals

This change intentionally does not implement:

- background unread-history replay turns
- idle/no-op turns queued by the backend
- new frontend workflow surfaces
- multi-agent memory synchronization
- agent commentary streaming into room timeline

Those are valid next steps, but they require additional backend product semantics that OpenShock does not currently queue.

## Scope

The implementation covers all wakeup sources OpenShock already emits today:

- `direct_message`
  - produced from human-authored visible room messages
- `handoff_response`
  - produced when one agent explicitly hands work to another

Guardrails:

- joined room agents may all receive the same human-authored visible message turn
- agent-authored plain `message` replies may continue visible room discussion
- explicit `handoff` remains a separate orchestration path

These wakeup modes are orchestration concepts. They are separate from the final visible reply kind (`message`, `handoff`, `summary`, `no_response`).

## Design

### 1. Agent turn wakeup mode

Add a structured `WakeupMode` field to `AgentTurn`.

Mapping:

- `visible_message_response` -> `direct_message`
- `handoff_response` -> `handoff_response`

Why add it when `IntentType` already exists:

- `IntentType` reflects the conversational intent OpenShock expects.
- `WakeupMode` reflects the daemon scheduling mode and prompt contract.
- Keeping both avoids breaking current observability while making orchestration explicit.

### 2. Persistent agent session workspace

Each `AgentSession` will execute in a deterministic directory derived from:

- daemon-configured session root
- `providerThreadId` when available
- fallback to `session.ID` if needed

Default root:

- `${TMPDIR}/openshock-agent-sessions`

Override mechanisms:

- `--agent-session-root`
- `OPENSHOCK_AGENT_SESSION_ROOT`

Within each session workspace, the daemon prepares:

- `MEMORY.md`
- `notes/room-context.md`
- `notes/work-log.md`
- `CURRENT_TURN.md`

Behavior:

- Files persist across turns for the same session.
- `MEMORY.md` is initialized once and never overwritten automatically.
- `CURRENT_TURN.md` is replaced on every claimed turn.
- `notes/work-log.md` is appended by the daemon on turn start and turn completion.
- `notes/room-context.md` is refreshed from the latest room metadata and summaries.

This creates a minimal durable substrate even before the agent actively edits memory itself.

### 3. Prompt contract upgrade for agent turns

The new agent-turn prompt is not just a “reply in chat” instruction. It becomes an orchestration contract with these sections:

- lifecycle
- wakeup mode
- workspace and files to inspect first
- response policy
- reply output contract
- current target and trigger
- recent conversation context

Required behavior encoded in the prompt:

1. This is one turn only; complete the turn and stop.
2. Read `MEMORY.md` and `CURRENT_TURN.md` first.
3. Treat wakeup mode as the primary execution policy.
4. Decide whether a visible reply is needed before deeper work.
5. Keep the first visible reply natural and concise.
6. Do not invent internal workflow narration.
7. Return the existing strict `KIND/BODY` format.

The reply format stays unchanged so we do not break room posting.

### 4. Prompt contract upgrade for runs

`Run` execution also adopts a more explicit daemon contract. The prompt should clearly state:

- lifecycle: finish all work before exiting
- allowed OpenShock task-status commands
- definition of done
- blocked behavior
- expected final summary

This keeps run execution aligned with the same orchestration philosophy instead of leaving it as a looser task instruction blob.

### 5. Runtime behavior

Agent-turn execution flow becomes:

1. claim agent turn
2. resolve deterministic session workspace
3. prepare workspace files
4. execute Codex inside that session workspace
5. parse final `KIND/BODY`
6. post visible reply only when needed
7. append completion entry to workspace work-log
8. complete the turn in backend

This replaces the current temp-dir-only behavior.

## Files Expected To Change

Backend:

- `apps/backend/internal/core/models.go`
- `apps/backend/internal/store/memory.go`
- `apps/backend/internal/store/memory_test.go`
- `apps/backend/internal/api/server_test.go`

Daemon:

- `apps/daemon/cmd/daemon/main.go`
- `apps/daemon/cmd/daemon/main_test.go`
- `apps/daemon/internal/client/types.go`
- `apps/daemon/internal/provider/codex/executor.go`
- `apps/daemon/internal/provider/codex/executor_test.go`
- `apps/backend/internal/api/daemon_system_test.go`

Optional contract/UI sync:

- `apps/frontend/src/lib/types.ts`

## Testing Strategy

### Unit tests

Backend:

- wakeup mode is set correctly for each turn source
- claimed turn payload exposes the new wakeup mode

Daemon:

- session workspace path is stable across repeated turns for the same session
- workspace files are initialized and updated as expected
- `buildAgentTurnInstruction` includes wakeup mode and workspace contract
- `buildRunInstruction` includes the upgraded execution contract

### System tests

Use `t.TempDir()` and fresh git fixture repos only.

Add end-to-end verification that:

- an agent turn creates a persistent session workspace under an isolated temp root
- a second turn for the same session reuses that workspace
- `CURRENT_TURN.md` is refreshed per turn
- `notes/work-log.md` accumulates both turns
- room reply behavior remains correct

No test should bind the live repository as a workspace repo.

## Rollout Notes

This upgrade is backward compatible at the workflow level:

- room replies still use `KIND/BODY`
- existing run and merge queue flows remain intact
- current frontend observability continues to work

The main functional change is that agent turns now have a durable execution substrate and an explicit daemon-mode contract.

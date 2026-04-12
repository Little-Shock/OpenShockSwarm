# Repository Guidelines

## Project Structure & Module Organization

This repository is organized by app and contract boundary:

- `apps/backend/`: Go HTTP API, action gateway, realtime hub, and in-memory store. Entry point: `cmd/server`.
- `apps/daemon/`: Go daemon and CLI for runtime registration, claiming work, ACP/Codex execution, and git operations. Entry points: `cmd/daemon`, `cmd/openshock`.
- `apps/frontend/`: Next.js 16 app for rooms, task board, and inbox. Main source lives in `src/`; static assets live in `public/`.
- `packages/contracts/`: contract-first API notes and shared interface references.
- `documents/`: PRD, technical design, and UI/reference material.

Keep new code inside the owning app. Do not place shared runtime logic in `documents/`.

## Build, Test, and Development Commands

- `cd apps/backend && go run ./cmd/server`: start the backend on `:8080`.
- `cd apps/backend && go test ./... && go build ./...`: run backend tests and build.
- `cd apps/daemon && go run ./cmd/daemon`: start the local daemon worker loop and register a runtime.
- `cd apps/daemon && go run ./cmd/daemon --once`: execute one daemon cycle locally.
- `cd apps/daemon && go test ./... && go build ./...`: run daemon tests and build.
- `cd apps/frontend && npm run dev -- --port 3000`: start the Next.js app on `:3000`.
- `cd apps/frontend && npm run lint && npm run build`: lint and production-build the frontend.

The frontend defaults to `http://localhost:8080`; override with `NEXT_PUBLIC_API_BASE_URL` when needed.

## Coding Style & Naming Conventions

- Go: run `gofmt -w`; use package-focused files and `_test.go` companions.
- TypeScript/React: follow ESLint and the app-local guidance in [apps/frontend/AGENTS.md](/Users/feifantong/code/OpenShockSwarm/apps/frontend/AGENTS.md).
- Use clear, contract-driven names such as `ClaimAgentTurn`, `RoomDetailResponse`, `TaskStatusControl`.
- Prefer `camelCase` for TS variables/functions, `PascalCase` for React components and exported types, and `snake_case` only for wire-level status values or IDs.

## Testing Guidelines

- Backend and daemon tests use Go’s `testing` package; place tests next to implementation as `*_test.go`.
- Frontend currently relies on `npm run lint` and `npm run build` as the required verification gates.
- Add or update tests for every behavior change, especially action flows, API handlers, daemon cycles, and store state transitions.

## Commit & Pull Request Guidelines

- Follow the existing history style: concise, imperative prefixes such as `docs:`, `feat:`, `fix:`.
- Keep commits scoped to one concern.
- PRs should include: purpose, key design decisions, impacted apps, verification commands run, and screenshots for UI changes.
- Link the relevant issue/room context when the change affects product behavior or workflow semantics.

## Architecture & Agent Notes

- Treat agents as first-class actors, but do not fake agent output in product UI. Human input should create work; daemon-driven execution should post agent results back.
- Prefer contract-first changes: update request/response types and tests before extending behavior.
- Workspaces are now real security and visibility boundaries, not just presentation filters.
- Members can only see workspaces they have access to, and can only switch into accessible workspaces.
- New members currently start with access only to the default workspace. Creating a workspace automatically grants the creator access to it.
- Agents are workspace-scoped. They must not be shared across workspaces, referenced across workspaces, or surfaced in cross-workspace lists.
- Direct-message rooms are real per-workspace private chats with agents. Keep their behavior aligned with workspace-local agent ownership.
- Agent observability is per agent, not per room. Keep room views and observability views consistent with that model.
- Backend room, issue, board, inbox, bootstrap, and agent endpoints should be treated as authenticated member surfaces; do not add anonymous workspace data paths unless product requirements explicitly change.

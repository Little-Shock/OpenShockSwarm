# 2026-04-09 Run History / Resume Context Report

- Command: `pnpm test:headed-run-history-resume-context -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-run-history-resume-context.md`
- Artifacts Dir: `/tmp/openshock-tkt40-run-history-UP1lqa`

## Results
- `/v1/runs/history` and `/v1/runs/:id/detail` now expose paginated history plus session-backed resume context.
- `/runs` first renders only the latest history page; older room runs stay hidden until explicit incremental fetch.
- `Load Older Runs` appends earlier run history instead of preloading the full ledger into the first paint.
- Current run detail shows live resume session metadata and same-room history, including the immediately prior runtime run.
- Reopening a prior run keeps room-level history visible and swaps resume context to that run's own session continuity.
- Jumping back into the room run tab returns to the current room continuity instead of pinning the stale historical session.

## Screenshots
- runs-initial-page: /tmp/openshock-tkt40-run-history-UP1lqa/screenshots/01-runs-initial-page.png
- runs-after-load-more: /tmp/openshock-tkt40-run-history-UP1lqa/screenshots/02-runs-after-load-more.png
- run-detail-current: /tmp/openshock-tkt40-run-history-UP1lqa/screenshots/03-run-detail-current.png
- run-detail-reopened-history: /tmp/openshock-tkt40-run-history-UP1lqa/screenshots/04-run-detail-reopened-history.png
- room-run-tab-current-session: /tmp/openshock-tkt40-run-history-UP1lqa/screenshots/05-room-run-tab-current-session.png

## Single Value
- `/runs` now behaves like a paginated history surface, `Load Older Runs` reveals earlier ledger pages on demand, run detail exposes session-backed resume context plus same-room history, and room run tab correctly re-anchors to the current active session instead of a stale prior continuity.

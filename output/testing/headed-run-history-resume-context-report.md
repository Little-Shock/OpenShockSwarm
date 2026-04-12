# 2026-04-09 执行历史与恢复上下文报告

- Command: `pnpm test:headed-run-history-resume-context -- --report output/testing/headed-run-history-resume-context-report.md`
- Artifacts Dir: `/tmp/openshock-tkt40-run-history-0sFMzE`

## Results
- `/v1/runs/history` and `/v1/runs/:id/detail` now expose paginated history plus session-backed resume context.
- `/runs` 首次只展示最新一页历史；更早的房间执行会保持折叠，直到主动加载。
- 点击“加载更早执行”后，会按需追加更早的执行历史，而不是在首屏一次性灌入整条流水。
- 当前执行详情会展示实时恢复会话信息和同一房间的历史记录，包括紧邻的上一条执行。
- 重新打开较早执行后，房间级历史仍保持可见，同时恢复上下文会切换到该执行自己的会话链路。
- 从历史执行回到房间执行页签时，会重新锚定到当前房间链路，而不是停留在过时会话上。

## Screenshots
- runs-initial-page: /tmp/openshock-tkt40-run-history-0sFMzE/screenshots/01-runs-initial-page.png
- runs-after-load-more: /tmp/openshock-tkt40-run-history-0sFMzE/screenshots/02-runs-after-load-more.png
- run-detail-current: /tmp/openshock-tkt40-run-history-0sFMzE/screenshots/03-run-detail-current.png
- run-detail-reopened-history: /tmp/openshock-tkt40-run-history-0sFMzE/screenshots/04-run-detail-reopened-history.png
- room-run-tab-current-session: /tmp/openshock-tkt40-run-history-0sFMzE/screenshots/05-room-run-tab-current-session.png

## Single Value
- `/runs` 现在会按页加载历史，执行详情会同时展示恢复会话与同房间历史，而回到房间执行页签时也会重新锚定到当前活跃链路，不会误留在旧会话上。

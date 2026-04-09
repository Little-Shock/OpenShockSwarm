# 2026-04-09 Quick Search / Message Surface Contract Report

- Command: `pnpm test:headed-quick-search -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-quick-search.md`
- Artifacts Dir: `/tmp/openshock-quick-search-4GLBpN`

## Results

### Channel / Room / Issue / Run / Agent Jump

- 侧栏 `Quick Search` 入口已不再只是静态按钮；输入 `roadmap` 会出现高亮结果，并直接跳到 `/chat/roadmap` -> PASS
- `Ctrl+K` 可在 room / run / agent 等高频页重复打开同一套命令面板；输入 `Runtime 讨论间`、`OPS-19`、`run_runtime_01`、`Codex Dockmaster` 都能命中对应 kind 并完成跳转 -> PASS
- issue 页顶部 `Quick Search` 触发器已接上真实结果面，不再只有 placeholder 文案 -> PASS

### DM / Followed Thread / Saved Later Jump

- 输入 `Mina` 会命中 server-backed `dm` 结果并直接进入 `/chat/dm-mina`；DM 不再只靠本地占位列表维持入口 -> PASS
- 输入 `runtime sync thread` 会命中 `followed` 结果并打开 `/chat/all?tab=followed&thread=msg-all-2`；同一条 thread 能从 search result 直接回到 followed revisit rail -> PASS
- 输入 `Longwen default-entry` 会命中 `saved` 结果并打开 `/chat/roadmap?tab=saved&thread=msg-roadmap-1`；saved-later 不再只是 sidebar 入口，也能作为 search result 直接 reopen -> PASS

### Highlight / Empty State

- 搜索命中项会在标题或摘要里显式高亮关键字，验证了 `roadmap`、`OPS-19`、`run_runtime_01`、`Codex Dockmaster`、`Mina`、`runtime sync thread`、`Longwen default-entry` 的 `<mark>` 呈现 -> PASS
- 输入 `zzzz-not-found` 时不会误跳转，而是稳定展示 `No matches yet` 空结果态；`Esc` 可正常关闭面板 -> PASS

### Scope Boundary

- 这轮继续保留 `channel / room / issue / run / agent` 的既有 `TKT-21` 覆盖，同时补齐 `TKT-27` 负责的 `dm / followed / saved` search result contract。
- mailbox / handoff 仍不在这轮范围；这里只收 message-surface reopen / jump target 的 backend contract。

### Screenshots

- channel-roadmap: /tmp/openshock-quick-search-4GLBpN/run/screenshots/01-channel-roadmap.png
- room-runtime: /tmp/openshock-quick-search-4GLBpN/run/screenshots/02-room-runtime.png
- issue-ops-19: /tmp/openshock-quick-search-4GLBpN/run/screenshots/03-issue-ops-19.png
- run-runtime-01: /tmp/openshock-quick-search-4GLBpN/run/screenshots/04-run-runtime-01.png
- agent-dockmaster: /tmp/openshock-quick-search-4GLBpN/run/screenshots/05-agent-dockmaster.png
- dm-mina: /tmp/openshock-quick-search-4GLBpN/run/screenshots/06-dm-mina.png
- followed-thread-result: /tmp/openshock-quick-search-4GLBpN/run/screenshots/07-followed-thread-result.png
- saved-thread-result: /tmp/openshock-quick-search-4GLBpN/run/screenshots/08-saved-thread-result.png
- no-matches: /tmp/openshock-quick-search-4GLBpN/run/screenshots/09-no-matches.png

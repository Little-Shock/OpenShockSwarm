# TKT-21 Real Quick Search / Search Result Surface Report

- Command: `pnpm test:headed-quick-search -- --report docs/testing/Test-Report-2026-04-08-quick-search.md`
- Artifacts Dir: `/tmp/openshock-tkt21-artifacts`

## Results

### Channel / Room / Issue / Run / Agent Jump

- 侧栏 `Quick Search` 入口已不再只是静态按钮；输入 `roadmap` 会出现高亮结果，并直接跳到 `/chat/roadmap` -> PASS
- `Ctrl+K` 可在 room / run / agent 等高频页重复打开同一套命令面板；输入 `Runtime 讨论间`、`OPS-19`、`run_runtime_01`、`Codex Dockmaster` 都能命中对应 kind 并完成跳转 -> PASS
- issue 页顶部 `Quick Search` 触发器已接上真实结果面，不再只有 placeholder 文案 -> PASS

### Highlight / Empty State

- 搜索命中项会在标题或摘要里显式高亮关键字，验证了 `roadmap`、`OPS-19`、`run_runtime_01`、`Codex Dockmaster` 的 `<mark>` 呈现 -> PASS
- 输入 `zzzz-not-found` 时不会误跳转，而是稳定展示 `No matches yet` 空结果态；`Esc` 可正常关闭面板 -> PASS

### Scope Boundary

- 这轮只收 `CHK-01 / CHK-16 / TC-033` 的 quick-search result surface。
- DM / followed thread / saved later / profile surface 继续留给 `TKT-22`、`TKT-23`、`TKT-25`，不借写成这张票已完成。

### Screenshots

- channel-roadmap: /tmp/openshock-tkt21-artifacts/run/screenshots/01-channel-roadmap.png
- room-runtime: /tmp/openshock-tkt21-artifacts/run/screenshots/02-room-runtime.png
- issue-ops-19: /tmp/openshock-tkt21-artifacts/run/screenshots/03-issue-ops-19.png
- run-runtime-01: /tmp/openshock-tkt21-artifacts/run/screenshots/04-run-runtime-01.png
- agent-dockmaster: /tmp/openshock-tkt21-artifacts/run/screenshots/05-agent-dockmaster.png
- no-matches: /tmp/openshock-tkt21-artifacts/run/screenshots/06-no-matches.png

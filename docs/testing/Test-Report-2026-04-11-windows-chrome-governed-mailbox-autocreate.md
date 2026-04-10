# Test Report 2026-04-11 Windows Chrome Governed Mailbox Auto-Create

- Ticket: `TKT-65`
- Checklist: `CHK-21`
- Test Case: `TC-054`
- Scope: governed route one-click create、dual-surface active sync、blocked replay
- Artifacts Dir: `/tmp/openshock-tkt65-governed-route-vNfUhD`

## Verification

### Check: Web contract / type / build gate
**Command run:**
`pnpm verify:web`

**Output observed:**
```text
live truth hygiene ok: checked 70 web source files and current state file; no disallowed mock-data imports, banned placeholder wording, or tracked live-truth residue found.
✖ 4 problems (0 errors, 4 warnings)
✓ Compiled successfully in 2.7s
✓ Generating static pages using 15 workers (19/19)
```

**Result: PASS**

### Check: Windows Chrome headed governed auto-create walkthrough
**Command run:**
`OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-governed-mailbox-route -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-autocreate.md`

**Output observed:**
```text
node ./scripts/headed-governed-mailbox-route.mjs -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-governed-mailbox-autocreate.md
process exited with code 0
```

**Result: PASS**

## Browser Findings

- `/mailbox` 与 Inbox compose 都会读取 `workspace.governance.routingPolicy.suggestedHandoff`，并在 `ready` 状态下显式给出 `Create Handoff` / `Create Governed Handoff` 一键起单入口。
- 通过 governed route 一键起单后，`/mailbox` 与 Inbox compose 会一起切到 `active`，并提供聚焦当前 handoff 的回链，不会出现一处 active、一处还停在 ready 的分裂状态。
- 完成当前 reviewer handoff 后，两处 governed surface 会一起前滚到下一条 lane；当 QA lane 缺少可映射 agent 时，两处都显式 `blocked`，不会静默回退到随机接收方。

## Adversarial Probes

- 已验证 cross-surface consistency: 从 `/mailbox` 一键起单后，Inbox compose governed route 会同步切到 `active`，不是只更新创建页本身。
- 已验证 fail-closed replay: handoff 完成后，两处 governed surface 都前滚到 `blocked QA` fallback，说明 blocked 状态不是某个单页局部缓存。

## Screenshots

- `governed-compose-ready`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/01-governed-compose-ready.png`
- `governed-route-ready`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/02-governed-route-ready.png`
- `governed-route-active`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/03-governed-route-active.png`
- `governed-compose-active`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/04-governed-compose-active.png`
- `governed-route-focus-inbox`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/05-governed-route-focus-inbox.png`
- `governed-route-next-blocked`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/06-governed-route-next-blocked.png`
- `governed-compose-next-blocked`: `/tmp/openshock-tkt65-governed-route-vNfUhD/screenshots/07-governed-compose-next-blocked.png`

VERDICT: PASS

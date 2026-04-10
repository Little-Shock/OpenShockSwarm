# Test Report 2026-04-11 Windows Chrome Configurable Team Topology / Governance Persistence

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-configurable-team-topology -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-configurable-team-topology.md`
- Artifacts Dir: `/tmp/openshock-tkt62-team-topology-bQxiIK`
- Web: `http://127.0.0.1:44486`
- Server: `http://127.0.0.1:44512`

## Results

- `/settings` 现在可以直接编辑 team topology，不再只有只读 governance preview；本轮将 `Developer` 改成 `Builder`，并新增了 `Ops` lane -> PASS
- `/setup`、`/mailbox`、`/agents` 会消费同一份 topology truth；三处 preview 都已同步显示 `Builder` 和 `Ops` -> PASS
- browser reload、server restart 和 second browser context 后，configured topology 与 derived governance snapshot 仍保持 6 lanes -> PASS

## Evidence

- persisted lane ids: `pm, architect, developer, reviewer, qa, ops`
- renamed execution lane: `developer -> Builder`
- restart recovery: same state file still projects Builder/Ops across settings/setup/mailbox/agents

## Screenshots

- settings-governance-before: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/01-settings-governance-before.png`
- settings-governance-after-save: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/02-settings-governance-after-save.png`
- setup-governance-preview: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/03-setup-governance-preview.png`
- mailbox-governance-preview: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/04-mailbox-governance-preview.png`
- agents-governance-preview: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/05-agents-governance-preview.png`
- settings-governance-after-restart: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/06-settings-governance-after-restart.png`
- second-context-setup-preview: `../../../tmp/openshock-tkt62-team-topology-bQxiIK/run/screenshots/07-second-context-setup-preview.png`

VERDICT: PASS

# 2026-04-09 Machine Profile / Local CLI Model Capability Binding Report

- Command: `pnpm test:headed-machine-profile-capability-binding -- --report docs/testing/Test-Report-2026-04-09-machine-profile-capability-binding.md`
- Artifacts Dir: `/tmp/openshock-tkt33-artifacts`

## Results
- `/setup` 当前会直接展示 selected runtime 的 shell 与 provider-model inventory。
- machine profile 会和 `/setup` 读同一份 runtime truth：shell、daemon、CLI 与 provider-model inventory 一致。
- Agent profile editor 现在可把 provider / model / runtime affinity 直接写回后端 truth，reload 后仍保持同一份绑定。
- `/agents` 也会回读同一份 binding truth，不再停留在旧 provider/runtime 摘要。

## Screenshots
- setup-runtime-inventory: /tmp/openshock-tkt33-artifacts/screenshots/01-setup-runtime-inventory.png
- machine-profile-inventory: /tmp/openshock-tkt33-artifacts/screenshots/02-machine-profile-inventory.png
- agent-profile-before-binding-edit: /tmp/openshock-tkt33-artifacts/screenshots/03-agent-profile-before-binding-edit.png
- agent-profile-after-binding-save: /tmp/openshock-tkt33-artifacts/screenshots/04-agent-profile-after-binding-save.png
- agent-profile-after-reload: /tmp/openshock-tkt33-artifacts/screenshots/05-agent-profile-after-reload.png
- agents-page-binding-summary: /tmp/openshock-tkt33-artifacts/screenshots/06-agents-page-binding-summary.png

## Single Value
- `TKT-33` 现在已经把 machine shell / daemon / provider-model inventory 和 Agent provider+model+runtime affinity 收进同一份后端 truth；`/setup`、machine profile、`/agents` 与 Agent profile editor 回读一致。

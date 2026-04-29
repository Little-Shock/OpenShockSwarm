# Test Report 2026-04-11 Windows Chrome Memory Provider Orchestration

- Command: `pnpm test:headed-memory-provider-orchestration -- --report output/testing/us-013-fake-external-provider/report.md`
- Artifacts Dir: `/Users/lark/Lark_Project/9_OpenShock/output/testing/us-013-fake-external-provider/run-attempt`
- Scope: `TKT-96 / CHK-10 / CHK-22 / TC-085`
- Result: `PASS`

## Results

### Provider Binding Truth

- `/memory` 现在会直接暴露 `workspace-file / search-sidecar / external-persistent` 三类 provider binding，并允许在同页保存 durable binding truth -> PASS
- Search Sidecar 启用后进入 `degraded`；真实 External Persistent 未配置时显示 `未配置`，不会把本地/测试路径说成生产集成 -> PASS

### Next-Run Preview

- `session-memory` preview 现在不只显示 mounted files / tools，还会显式列出 active providers、scope、retention 和 degraded provider note -> PASS
- prompt summary 会同步写入 provider orchestration truth，并保留 external persistent not-configured note -> PASS

### Persistence

- 页面 reload 后 provider enabled/status 状态保持不变，证明 binding 已写回 durable memory-center state -> PASS

### Screenshots

- initial-provider-bindings: /Users/lark/Lark_Project/9_OpenShock/output/testing/us-013-fake-external-provider/run-attempt/run/screenshots/01-initial-provider-bindings.png
- provider-bindings-saved: /Users/lark/Lark_Project/9_OpenShock/output/testing/us-013-fake-external-provider/run-attempt/run/screenshots/02-provider-bindings-saved.png
- preview-provider-orchestration: /Users/lark/Lark_Project/9_OpenShock/output/testing/us-013-fake-external-provider/run-attempt/run/screenshots/03-preview-provider-orchestration.png
- provider-bindings-reload-persisted: /Users/lark/Lark_Project/9_OpenShock/output/testing/us-013-fake-external-provider/run-attempt/run/screenshots/04-provider-bindings-reload-persisted.png

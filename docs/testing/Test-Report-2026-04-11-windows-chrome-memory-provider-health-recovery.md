# Test Report 2026-04-11 Windows Chrome Memory Provider Health Recovery

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-memory-provider-health-recovery -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-memory-provider-health-recovery.md`
- Artifacts Dir: `/tmp/openshock-tkt97-memory-provider-health-NCedgM`
- Scope: `TKT-97 / GAP-66 / CHK-10 / CHK-22 / TC-086`
- Result: `PASS`

## Results

### Health Checks

- 启用 `search-sidecar / external-persistent` 后，provider 不再假装健康；缺少 index 或 adapter stub 时会显式进入 `degraded` 并给出 next action -> PASS
- `/memory` 现在支持逐 provider `run health check`，并把失败次数、last-check source 与 health timeline 写回 durable truth -> PASS

### Recovery

- Search Sidecar recovery 会重建本地 recall index，并把 provider 从 `degraded` 拉回 `healthy` -> PASS
- External Persistent recovery 会生成本地 relay stub config / queue，并明确提示真实 remote durable sink 仍待后续接入 -> PASS
- Workspace File recovery 会重新补齐缺失的 `MEMORY.md / notes / decisions` scaffold；上游文件记忆损坏时，Search Sidecar 也会同步降级，不再假装仍然健康 -> PASS

### Preview And Persistence

- `session-memory` preview 会同步读取恢复后的 provider health summary / next action，不再只显示静态 binding 描述 -> PASS
- 页面 reload 后，三类 provider 的 health / recovery timeline 继续保留，证明状态已写回 durable `memory-center.json` -> PASS

### Screenshots

- initial-provider-health: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/01-initial-provider-health.png
- enabled-providers-degraded: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/02-enabled-providers-degraded.png
- search-sidecar-checked: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/03-search-sidecar-checked.png
- search-sidecar-recovered: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/04-search-sidecar-recovered.png
- external-persistent-recovered: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/05-external-persistent-recovered.png
- workspace-file-degraded: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/06-workspace-file-degraded.png
- workspace-file-recovered: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/07-workspace-file-recovered.png
- preview-recovered-provider-health: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/08-preview-recovered-provider-health.png
- provider-health-reload-persisted: /tmp/openshock-tkt97-memory-provider-health-NCedgM/run/screenshots/09-provider-health-reload-persisted.png

# Testing Index

这份文档只回答一件事：**现在该跑哪条验证线，去哪里看证据。**

## 先走最短验证路径

| 目的 | 命令 | 结果 |
| --- | --- | --- |
| release candidate gate | `pnpm verify:release:rc` | repo gate + server/daemon integration + 5 条 browser 主链；内含 strict GitHub-ready + actual-live-parity smoke；自动写 RC 报告和原始日志 |
| 非 RC 全跑 | `pnpm verify:release:full` | repo gate + 5 条 browser 主链 + live smoke；自动写 full gate 报告和原始日志 |
| repo gate | `pnpm verify:release` | 静态门、Go 测试、release gate 自检 |
| live stack smoke | `pnpm ops:smoke` | 当前 server / daemon live stack 健康和 fail-closed 边界 |
| strict live smoke | `pnpm ops:smoke:strict` | GitHub-ready + branch-head aligned 的严格 smoke |

说明：

- 发布前默认先看这 5 条，不要先翻历史报告。
- RC 现在要求 `OPENSHOCK_INTERNAL_WORKER_SECRET` 和 `OPENSHOCK_RUNTIME_HEARTBEAT_SECRET` 都已配置。
- 想重新定位最新证据时，统一用 `pnpm release:evidence:latest`，不要再手动猜日期。
- 更完整的发布 contract 看 [../engineering/Release-Gate.md](../engineering/Release-Gate.md)。
- 这两条命令会生成报告，但仓库中的 `docs/testing/Test-Report-*` 属于归档，可能不是你这次运行生成的最新结果。

## 最新证据怎么看

### Latest RC Evidence Bundle

不要手动在这里维护“最新日期 / commit”。直接用固定命令定位：

```bash
pnpm release:evidence:latest
pnpm release:evidence:latest rc
pnpm release:evidence:latest full
```

这条命令会直接打印：

- latest RC report 路径
- latest full report 路径
- 对应 artifacts 目录

原始日志目录固定是：

- RC: `docs/testing/artifacts/<date>/release-candidate/`
- Full: `docs/testing/artifacts/<date>/release-full/`

也就是说：

- `pnpm verify:release:rc` 是生成最新 RC 证据的入口
- `pnpm verify:release:full` 是生成最新非 RC 全跑证据的入口
- 仓库里已有报告用于归档和回放，不应默认视为当前最新一次运行结果

## 当前 browser 主链

这 5 条已经被 release gate 直接收进默认路径：

| 场景 | 独立命令 |
| --- | --- |
| setup spine e2e | `pnpm test:headed-setup` |
| onboarding first-start journey | `pnpm test:headed-onboarding-studio` |
| fresh workspace critical loop | `pnpm test:headed-critical-loop` |
| rooms continue entry | `pnpm test:headed-rooms-continue-entry` |
| config persistence recovery | `pnpm test:headed-config-persistence-recovery` |

这一组 release-critical browser suite 的 canonical source 现在固定在：

- `scripts/release-browser-suite.sh`

也就是说，release gate、Testing Index 和 reviewer 证据都应该跟这份 manifest 对齐，不再各自维护一份手写列表。

如果你只做前台快检，先看这 5 条，不要一上来跑历史大套件。

## 高频补充检查

- `pnpm verify:server`
  - server core 包回归 + `server ↔ daemon` integration loop
- `pnpm verify:server:integration`
  - 单独重放 release baseline 使用的 `server ↔ daemon` integration loop
- `pnpm verify:web`
  - 前端静态门和关键 contract 快检
- `pnpm test:web-contracts`
  - 前端 contract 回归
- `cd apps/server && ../../scripts/go.sh test ./internal/api -count=1`
  - server API 合同面
- `cd apps/server && ../../scripts/go.sh test -tags=integration ./internal/integration -count=1`
  - server/daemon integration 原始 Go 入口；日常优先用 `pnpm verify:server:integration`

## 全量范围去哪里看

- 全量测试矩阵：[`Test-Cases.md`](./Test-Cases.md)
- 当前产品范围：[`../product/Checklist.md`](../product/Checklist.md)
- 历史报告：当前目录下所有 `Test-Report-*.md`

历史报告现在只做归档和专题回放，不再承担“今天先跑什么”的入口职责。

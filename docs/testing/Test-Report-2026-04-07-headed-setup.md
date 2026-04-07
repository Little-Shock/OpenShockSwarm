# OpenShock Test Report

**报告日期:** 2026 年 4 月 7 日
**基线分支:** `dev/tkt-03-headed-setup-e2e`
**执行命令:** `pnpm test:headed-setup`
**工作区:** `/home/lark/OpenShock`
**关联文档:** [Test Cases](./Test-Cases.md) · [Product Checklist](../product/Checklist.md)

---

## 一、执行环境

- Web: `http://127.0.0.1:45130`
- Server: `http://127.0.0.1:45054`
- Daemon: `http://127.0.0.1:45140`
- 浏览器: headed Chromium (`/snap/bin/chromium`)
- 临时 workspace: `/tmp/openshock-tkt03-headed-setup-tGFVTv/workspace`
- 证据目录: `/tmp/openshock-tkt03-headed-setup-tGFVTv`
- 关键证据:
  - 截图:
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/screenshots/01-setup-shell.png`
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/screenshots/02-setup-binding-and-github.png`
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/screenshots/03-setup-runtime-and-bridge.png`
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/screenshots/04-room-pr-entry-ready.png`
  - Trace: `/tmp/openshock-tkt03-headed-setup-tGFVTv/trace.zip`
  - Logs:
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/logs/daemon.log`
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/logs/server.log`
    - `/tmp/openshock-tkt03-headed-setup-tGFVTv/logs/web.log`

---

## 二、总览

- 已执行并通过: `4`
- 已执行但失败: `0`
- 本轮覆盖: `TC-001` `TC-002` `TC-003` `TC-026`

本轮结论：

- `TKT-03` 的 headed browser automation harness 已经站住，且能稳定输出截图、trace、日志与 markdown 报告。
- Setup 主链现在可以在 headed Chromium 中回放 repo binding、GitHub readiness、runtime pairing 和 bridge prompt。
- `Issue -> Room` 这段浏览器主链已经能自动化串起，并把 PR 入口带到 `发起 PR / 未创建 / enabled` 的可继续推进状态。
- 当前这份 harness 故意停在 “PR entry-ready” 而不是实际发起远端 PR；真实 remote create/sync/merge 继续由 `TKT-04/TKT-06` 收口。

---

## 三、详细结果

## TC-001 Setup 壳层可见性

- 当前执行状态: Pass
- 实际结果: headed Chromium 打开 `/setup` 后，repo binding、GitHub readiness、runtime pairing、live bridge 四个区块均可见。
- 业务结论: Setup 作为初始化主控台在浏览器自动化下可稳定加载。

## TC-002 Repo Binding 绑定当前仓库

- 当前执行状态: Pass
- 实际结果: harness 点击 “绑定当前仓库” 后，页面稳定显示 `Repo Binding Status: 已绑定`。
- 业务结论: repo binding 已经从 Setup 进入可重复回放的浏览器闭环。

## TC-003 Runtime Pairing 手动配对成功

- 当前执行状态: Pass
- 实际结果:
  - runtime selection = `shock-main`
  - pairing value = `browser-approved / 已配对`
  - bridge output = `OpenShock bridge online.`
- 业务结论: headed 浏览器里手动 pairing + bridge prompt 已可稳定联动。

## TC-026 Headed Setup 到 PR Journey

- 当前执行状态: Pass
- 实际结果:
  - harness 从 `/board` 创建 issue 后成功进入 room：
    - issue: `OPS-28 / TKT-03 headed setup e2e 1775527139364`
    - room: `room-tkt-03-headed-setup-e2e-1775527139364`
    - run: `run_tkt-03-headed-setup-e2e-1775527139364_01`
  - room 中 PR entry 当前状态为：
    - action: `发起 PR`
    - enabled: `true`
    - label: `未创建`
    - status: `未创建`
    - next action: `进入讨论间并发送第一条指令。`
- 业务结论: `Setup -> Issue -> Room -> PR entry-ready` 已能稳定自动化回放；这张票不把真实远端 PR create 借写成已完成。

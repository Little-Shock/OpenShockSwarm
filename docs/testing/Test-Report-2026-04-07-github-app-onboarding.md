# OpenShock Test Report

**报告日期:** 2026 年 4 月 7 日
**基线分支:** `dev/tkt-04-github-app-onboarding@14ccde4`
**执行命令:** `pnpm test:headed-github-onboarding`
**工作区:** `/tmp/openshock-pr6-head-14ccde4-4lWTA8/repo`（clean single-branch clone）
**关联文档:** [Test Cases](./Test-Cases.md) · [Product Checklist](../product/Checklist.md)

---

## 一、执行环境

- Web: `http://127.0.0.1:45210`
- Server: `http://127.0.0.1:44800`
- Daemon: `http://127.0.0.1:44296`
- 浏览器: headed Chromium (`/snap/bin/chromium`)
- 临时 workspace: `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/workspace`
- 证据目录: `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding`
- 关键证据:
  - 截图:
    - `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/screenshots/01-setup-shell.png`
    - `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/screenshots/02-github-app-onboarding.png`
    - `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/screenshots/03-repo-binding-blocked.png`
  - Trace: `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/trace.zip`
  - Logs:
    - `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/logs/daemon.log`
    - `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/logs/server.log`
    - `/tmp/openshock-pr6-head-14ccde4-4lWTA8/artifacts-onboarding/logs/web.log`

---

## 二、总览

- 已执行并通过: `3`
- 已执行但失败: `0`
- 本轮覆盖: `TC-022` `TC-026`
- 未借写完成: `TC-015`

本轮结论：

- `TKT-04` 已把 GitHub App installation pending 场景收成真正可操作的 Setup onboarding 体验。
- 用户现在可以在浏览器里看到 preferred auth path、缺失字段、installation action，以及“安装后如何回来”的明确步骤。
- repo binding 在 preferred path=`github-app` 且 installation 未完成时，会返回显式 blocked contract，而不是静默退回旧路径。
- 同一颗 exact head 的 clean clone 上，`../../scripts/go.sh test ./internal/api -run 'RepoBinding|GitHubConnection' -count=1` 与 `pnpm verify:release` 都已可直接跑通，不再依赖作者机上的 shell 执行位。
- 同一颗 exact head 的 clean clone 上，`pnpm test:headed-setup` happy path 已可正常跑绿；`GH_CONFIG_DIR=<empty> pnpm test:headed-setup` 会按预期因 `仅本地闭环` 而失败，不再把 GitHub readiness 假绿记成 PASS。
- 本轮故意不把 `TC-015` 写成 Pass；webhook ingest / replay / review sync 继续由 `TKT-05` 收口。

---

## 三、详细结果

## TC-022 GitHub App Effective Auth PR Contract

- 当前执行状态: Pass
- 实际结果:
  - Setup 中 GitHub readiness 明确显示当前为 GitHub App preferred path。
  - 页面展示 `installationId` 缺失、installation URL 和回流步骤。
  - repo binding 操作按钮切换为“按 GitHub App 同步 Repo Binding”，并在 installation 未完成时返回 blocked contract。
- 业务结论: GitHub App effective auth path 不再只停留在服务端 contract，已经进入可见的 Setup onboarding 面。

## TC-026 Headed Setup 到 PR Journey

- 当前执行状态: Pass
- 实际结果:
  - headed Chromium 稳定打开 `/setup`。
  - GitHub readiness 区块显示:
    - readiness: `仅本地闭环`
    - message: `GitHub App 已配置，但 installation 还未完成；当前仍退回 gh CLI。`
    - missing fields: `installationId`
  - repo binding 区块显示:
    - action: `按 GitHub App 同步 Repo Binding`
    - binding status: `待补安装`
    - blocked message / error: `GitHub App 已配置，但 installation 还未完成；当前仍退回 gh CLI。`
    - installation link 与回流步骤均可见
  - 业务结论: headed Setup harness 现在不仅能回放 happy path，也能覆盖 GitHub App onboarding 的 blocked-path 入口；installation 未完成时，Setup 会明确保持在 `仅本地闭环`，而不是把 fallback 误写成 GitHub-ready 绿灯。

## TC-015 GitHub App 安装与 Webhook

- 当前执行状态: Blocked
- 本轮没有声称完成的部分:
  - 未执行真实 installation 完成后的 webhook ingest / replay
  - 未执行 review / comment / merge 的远端回流
- 业务结论: 这张票只补齐 onboarding / blocked contract，不借写 webhook 已完成。

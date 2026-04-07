# Testing Docs

- [Test Cases](./Test-Cases.md)
  - 以 `PRD -> Checklist -> Test Case` 链路整理的全量验证项
- [Test Report 2026-04-06 Main](./Test-Report-2026-04-06-main.md)
  - 本轮在 `main` 基线上的实际执行结果、失败项和 GAP
- [Test Report 2026-04-07 Headed Setup](./Test-Report-2026-04-07-headed-setup.md)
  - `TKT-03` headed Chromium 自动化回放，覆盖 `TC-001` `TC-002` `TC-003` `TC-026`
- [Test Report 2026-04-07 GitHub App Onboarding](./Test-Report-2026-04-07-github-app-onboarding.md)
  - `TKT-04` headed GitHub App onboarding / repo binding blocked contract 回放，覆盖 `TC-022` 和 `TC-026` 的 blocked-path 证据，并明确 `TC-015` 仍未写成已完成

常用入口：

- `pnpm test:headed-setup`
  - 启动临时 workspace、daemon、server、web 和 headed Chromium，产出 `/tmp/openshock-tkt03-headed-setup-*` 证据目录
- `pnpm test:headed-github-onboarding`
  - 启动临时 workspace、daemon、server、web 和 headed Chromium，模拟 GitHub App installation pending，产出 `/tmp/openshock-tkt04-github-onboarding-*` 证据目录

如果 `Test Cases` 和 `Test Report` 冲突：

- 用 `Test Cases` 判断应该测什么
- 用 `Test Report` 判断这一轮实际测到了什么、结果如何

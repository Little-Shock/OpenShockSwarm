# Test Report 2026-04-09 First-Start Journey / Access-Setup-Onboarding Unification

- Command: `pnpm test:headed-first-start-journey -- --report docs/testing/Test-Report-2026-04-09-first-start-journey.md`
- Generated At: 2026-04-09T06:46:25.222Z

## Result

- `/access` 现在会把首次启动下一跳直接压成 `/setup`，身份链接通后不再要求用户自己猜要不要跨页去 setup。
- `/setup` 现在会镜像同一条 first-start journey；当 access recovery 已接通时，这里继续只围 setup 的 next step 推进。
- `/setup` 现在可以直接选择 `研究团队` 模板，并把 bootstrap package 写回 workspace onboarding truth。
- repo binding / runtime pairing 的 live truth 会把 onboarding progress 前滚到可 finish 状态，而不会把已有 `plan / browserPush / memoryMode` 静默覆盖回模板默认值。
- 完成首次启动后，`/setup` 会把 status、resume route 和 materialized package 一起收平到 durable workspace snapshot。
- 立即 reload 后，模板选择、done 状态和 `/rooms` resume route 继续从同一份 workspace truth 读取。
- 完成首次启动后，`/access` 也会把下一跳切成 `/rooms`，不再要求用户自己判断该回 access 还是 setup。
- 从 `/access` 点继续时现在会直接落到 `/rooms`，first-start journey 已经在前台收成单一路径。
- 重启 server 后，`/settings` 仍投影同一份 template + onboarding progress durable truth。
- 第二个浏览器上下文仍读到同一份 onboarding studio truth，说明恢复不依赖单个 tab。

## Evidence

- access-before-setup: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/01-access-before-setup.png`
- setup-before-template: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/02-setup-before-template.png`
- setup-after-template-select: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/03-setup-after-template-select.png`
- setup-progress-ready: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/04-setup-progress-ready.png`
- setup-finished: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/05-setup-finished.png`
- setup-after-reload: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/06-setup-after-reload.png`
- access-after-finish: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/07-access-after-finish.png`
- rooms-after-finish: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/08-rooms-after-finish.png`
- settings-after-server-restart: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/09-settings-after-server-restart.png`
- setup-second-context: `../openshock-tkt51-first-start-artifacts-rebased/run/screenshots/10-setup-second-context.png`

## Scope

- 从 `/access` 起步，验证 active session 下 first-start next step 会被明确压成 `/setup`，而不是要求用户自己猜路径。
- 在 `/setup` 选择 `研究团队` 模板，并验证 materialized bootstrap package 与 first-start bridge 读同一份 onboarding truth。
- 依据当前 repo binding / runtime pairing live truth 刷新 onboarding progress，再完成首次启动，同时验证自定义 `plan / browserPush / memoryMode` 不会被模板默认值静默覆盖。
- 验证完成首次启动后，`/access` 和 `/setup` 都会把下一跳切到 `/rooms`，并在 reload / server restart / second browser context 后保持同一份 truth。

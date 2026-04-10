# Test Report 2026-04-11 Restricted Sandbox Policy

- Command: `OPENSHOCK_WINDOWS_CHROME=1 pnpm test:headed-restricted-sandbox-policy -- --report docs/testing/Test-Report-2026-04-11-windows-chrome-restricted-sandbox-policy.md`
- Generated At: 2026-04-10T16:49:06.347Z

## Result

- `/runs/:id` 现在可直接编辑 run-level sandbox profile 与 allowlist，不再只剩后端隐式判断。
- 命中 allowlist 的 network target 会在 run detail 上直接回 `allowed`，并同步回当前 decision truth。
- 非 allowlisted command 会 fail-closed 到 `approval_required`，而且 override 按钮只会在同 target 的 review state 之后放开。
- owner 侧 `workspace.manage` 可以对同一条 `approval_required` action 执行 override retry；target 漂移时 UI 会重新收紧。
- reload 后，run policy 与 latest decision 会继续从 persisted state 读回，不会退回默认 trusted / idle。

## Evidence

- run-sandbox-before-edit: `../../../tmp/openshock-tkt46-sandbox-policy-27vqZl/run/screenshots/run-sandbox-before-edit.png`
- run-sandbox-after-save: `../../../tmp/openshock-tkt46-sandbox-policy-27vqZl/run/screenshots/run-sandbox-after-save.png`
- run-sandbox-allowed-check: `../../../tmp/openshock-tkt46-sandbox-policy-27vqZl/run/screenshots/run-sandbox-allowed-check.png`
- run-sandbox-approval-required: `../../../tmp/openshock-tkt46-sandbox-policy-27vqZl/run/screenshots/run-sandbox-approval-required.png`
- run-sandbox-override: `../../../tmp/openshock-tkt46-sandbox-policy-27vqZl/run/screenshots/run-sandbox-override.png`
- run-sandbox-after-reload: `../../../tmp/openshock-tkt46-sandbox-policy-27vqZl/run/screenshots/run-sandbox-after-reload.png`

## Scope

- Edited run-level sandbox profile / allowlists from `/runs/run_runtime_01`.
- Verified allowlisted network action -> `allowed`.
- Verified blocked command -> `approval_required` -> same-target override retry -> `overridden`.
- Verified reload and `/v1/state` both read the same persisted run sandbox truth.

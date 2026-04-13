# 2026-04-13 Verification Sweep Report

- Branch: `dev`
- Workspace: `/home/lark/OpenShock`

## Commands

- `go test ./apps/server/internal/api -run 'TestRoomMessageRouteInfersVisibleHandoffEnvelope|TestRoomMessageRouteHandoffEnvelopeSuppressesVisibleRelayAfterFollowup|TestRoomAutoHandoffFollowupSupportsNoResponseEnvelope' -count=1`
- `pnpm verify:server`
- `pnpm verify:web`
- `bash -lc 'git diff --name-only -- scripts | grep "\\.mjs$" | xargs -r -n1 node --check'`
- `node --check scripts/headed-message-send-flow.mjs`
- `node ./scripts/headed-message-send-flow.mjs --report output/testing/headed-message-send-flow-report.md`

## Results

- `room handoff envelope` 相关三条服务端回归用例已通过，当前 contract 明确为：当 handoff relay 后续产生可见 followup 时，API 返回 followup；如果 followup 静默，则回退到原 relay body。
- `pnpm verify:server` 已通过，`apps/server/internal/api`、`apps/server/internal/github`、`apps/server/internal/store` 当前整套为绿。
- `pnpm verify:web` 已通过，包含 live-truth hygiene、`eslint`、`typecheck`、`next build` 全链路。
- 当前变更涉及的 headed 脚本语法检查已通过，新增 `scripts/headed-message-send-flow.mjs` 可被 Node 正常解析。
- `headed-message-send-flow` 已通过：频道与讨论间发送都会先把人类消息落到流里，显示“发送中 / 正在生成回复...”，随后完成控制面回写，并在导航或刷新后保持持久化。

## Closed Gap

- `headed-message-send-flow` 原本的 request/response 监听存在 harness 竞态，已经改为先锁定 POST request，再等待该 request 完成。
- 同一轮回放已经重新通过，报告见 `output/testing/headed-message-send-flow-report.md`。
- 结论：这条“频道发送 -> 请求发出 -> 回写完成 -> reload 后仍在”的有头回放，当前已闭环。

## Single Value

- 当前 `dev` 分支已经完成一轮可提交的验证收口：服务端 contract、前端编译与发送流浏览器回放均为绿，验证链路已经覆盖 handoff、onboarding 和 message send 三条高频用户路径。

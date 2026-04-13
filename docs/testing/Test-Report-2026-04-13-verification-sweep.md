# 2026-04-13 Verification Sweep Report

- Branch: `dev`
- Workspace: `/home/lark/OpenShock`

## Commands

- `go test ./apps/server/internal/api -run 'TestRoomMessageRouteInfersVisibleHandoffEnvelope|TestRoomMessageRouteHandoffEnvelopeSuppressesVisibleRelayAfterFollowup|TestRoomAutoHandoffFollowupSupportsNoResponseEnvelope' -count=1`
- `pnpm verify:server`
- `pnpm verify:web`
- `bash -lc 'git diff --name-only -- scripts | grep "\\.mjs$" | xargs -r -n1 node --check'`
- `node --check scripts/headed-message-send-flow.mjs`
- `pnpm test:headed-message-send-flow -- --report docs/testing/Test-Report-2026-04-13-message-send-flow.md`

## Results

- `room handoff envelope` 相关三条服务端回归用例已通过，当前 contract 明确为：当 handoff relay 后续产生可见 followup 时，API 返回 followup；如果 followup 静默，则回退到原 relay body。
- `pnpm verify:server` 已通过，`apps/server/internal/api`、`apps/server/internal/github`、`apps/server/internal/store` 当前整套为绿。
- `pnpm verify:web` 已通过，包含 live-truth hygiene、`eslint`、`typecheck`、`next build` 全链路。
- 当前变更涉及的 headed 脚本语法检查已通过，新增 `scripts/headed-message-send-flow.mjs` 可被 Node 正常解析。

## Known Gap

- `pnpm test:headed-message-send-flow` 2026-04-13 本轮未稳定通过。
- 第一次回放在 room 发送完成后的二次页面跳转阶段丢失浏览器上下文；已将脚本改为刷新后校验持久化，降低了对额外路由跳转的耦合。
- 第二次回放仍暴露频道发送 harness 的不稳定点：`channel send request did not reach the control API`。
- 结论：产品发送链路已有静态和局部 browser evidence，但“频道发送 -> 请求发出 -> 回写完成”的 headed 回放还需要继续收敛，暂时不能记为已完全闭环。

## Single Value

- 当前 `dev` 分支已经完成一轮可提交的验证收口：服务端 contract、前端编译与主要脚本基线均为绿；剩余最明确的交付风险集中在 `headed-message-send-flow` 这条浏览器 harness，需要下一轮继续把发送链路的自动化稳定性做实。

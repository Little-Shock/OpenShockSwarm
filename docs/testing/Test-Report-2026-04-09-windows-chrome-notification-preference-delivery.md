# TKT-11 Notification Preference / Delivery Report

- Command: `pnpm test:headed-notification-preference-delivery -- --report docs/testing/Test-Report-2026-04-09-windows-chrome-notification-preference-delivery.md`
- Artifacts Dir: `/tmp/openshock-tkt11-notification-GJVBOt`

## Results

### Workspace Policy + Subscriber Contract

- `/settings` 现在直接消费 `/v1/notifications`，workspace browser/email policy 可写回 server -> PASS
- 当前浏览器能注册 service worker、同步成 ready browser subscriber，并在 page 上暴露稳定 subscriber target -> PASS
- email subscriber 也在同页写入同一 contract surface，不再停在 placeholder 文案 -> PASS

### Delivery / Retry Lifecycle

- invalid email target 首次 fanout 会显式打出 `attempted = 8 / delivered = 4 / failed = 4`，email subscriber `lastError` 明面可见 -> PASS
- 修正 email target 为 `ops@openshock.dev` 后，同页 retry fanout 转成 `attempted = 8 / delivered = 8 / failed = 0`，`lastDeliveredAt` 落桌 -> PASS
- browser subscriber 在同一 fanout 上保持 `ready`，并把 sent browser receipts 转成 local notification -> PASS

### Scope Boundary

- 这轮只收 `TC-017` 的 browser push / email preference、subscriber contract、fanout receipts 与 retry truth。
- invite / verify / reset password 继续留在后续身份链路范围，不借写成这张票已完成。

### Screenshots

- initial-notification-settings: /tmp/openshock-tkt11-notification-GJVBOt/run/screenshots/01-initial-notification-settings.png
- invalid-email-fanout-failure: /tmp/openshock-tkt11-notification-GJVBOt/run/screenshots/02-invalid-email-fanout-failure.png
- retry-fanout-green: /tmp/openshock-tkt11-notification-GJVBOt/run/screenshots/03-retry-fanout-green.png

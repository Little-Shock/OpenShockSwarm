# TKT-47 Mobile Notification Triage Report

- Command: `pnpm test:headed-mobile-notification-triage -- --report docs/testing/Test-Report-2026-04-09-mobile-notification-triage.md`
- Artifacts Dir: `/tmp/openshock-tkt47-mobile-notification-q1QCGY`

## Scope Boundary

- `TKT-47` 只收 mobile web 的轻量通知处理面：围 `/inbox` 上的 open / unread / blocked / recent 信号与直接 decision。
- 更重的通知策略、subscriber、delivery template 仍继续留在 `/settings` 与 `TKT-11` / `TKT-44`。

## Results

### Mobile Triage Surface

- mobile triage 卡片已直接给出 Open / Unread / Blocked / Recent 四个摘要，初始值 = `3 / 3 / 1 / 1` -> PASS
- mobile settings link 命中区 = `183x44`，可以直接把更重策略回跳到 `/settings` -> PASS
- 首张 mobile signal = `破坏性 Git 清理需要批准`，可见框尺寸 = `350x396`，低于 640px 高度上限 -> PASS

### Adversarial Checks

- initial render 无横向溢出：`scrollWidth/clientWidth/viewport = 390/390/390` -> PASS
- Open Context 命中区 = `310x44`，首个 decision (`Approve`) 命中区 = `310x44` -> PASS
- 展开 details / guard / links 后，Room backlink 命中区 = `137x44`，且仍无横向溢出：`390/390/390` -> PASS
- mobile detail disclosure 命中区 = `282x44`，说明 guard / backlinks 已从默认常显收敛成可展开 triage 附件，而不是继续把首屏撑爆 -> PASS

### Recent Resolution Ledger

- mobile recent ledger 现在默认折叠，可按需展开查看最新 resolution / status 回写 -> PASS

### Screenshots

- mobile-inbox-initial: /tmp/openshock-tkt47-mobile-notification-q1QCGY/screenshots/01-mobile-inbox-initial.png
- mobile-inbox-details-expanded: /tmp/openshock-tkt47-mobile-notification-q1QCGY/screenshots/02-mobile-inbox-details-expanded.png
- mobile-inbox-recent-ledger: /tmp/openshock-tkt47-mobile-notification-q1QCGY/screenshots/03-mobile-inbox-recent-ledger.png

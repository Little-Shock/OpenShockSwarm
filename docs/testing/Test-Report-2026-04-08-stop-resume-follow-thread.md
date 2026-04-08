# TKT-13 Stop / Resume / Follow-thread Report

- Command: `pnpm test:headed-stop-resume-follow-thread -- --report docs/testing/Test-Report-2026-04-08-stop-resume-follow-thread.md`
- Artifacts Dir: `/tmp/openshock-tkt13-stop-resume-WmW90F`

## Results

### Stop: room composer really freezes

- 在 `/rooms/room-runtime` 触发 Stop 后，room / run / issue / session 都切到 `paused`，而且 `room-send-message` 会被禁用，避免普通消息把暂停态悄悄恢复 -> PASS
- stop note 会同步进 room / run 两侧控制面板和 server state，不再只停在局部 textarea -> PASS

### Follow-thread: same paused run keeps current thread

- 在 run detail 上执行 Follow Thread 后，`followThread` 会同时写进 run / session，暂停态保持不变 -> PASS
- room surface 会同步显示“跟随当前线程”，说明 follow-thread 不再只是文案，而是 live state -> PASS

### Resume: room / run / inbox return to one truth

- Resume 后 room / run / issue / session 一起回到 `running`，follow-thread 标记保持为 true，普通 room composer 也恢复可发送 -> PASS
- `/inbox` recent ledger 会按顺序记录 `Run 已暂停`、`已锁定当前线程`、`Run 已恢复`，说明 stop / follow-thread / resume 已经写回同一条状态链 -> PASS

### Scope Boundary

- 这轮只收 `TC-018` 的 stop / resume / follow-thread 闭环。
- 不回退重复 `#96` 的 memory governance，也不把 `#98+` 的 scheduler / failover 混进来。

### Screenshots

- room-running: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/01-room-running.png
- room-paused: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/02-room-paused.png
- inbox-stop-status: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/03-inbox-stop-status.png
- run-follow-thread: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/04-run-follow-thread.png
- room-resumed: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/05-room-resumed.png
- run-resumed: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/06-run-resumed.png
- inbox-recent-ledger: /tmp/openshock-tkt13-stop-resume-WmW90F/run/screenshots/07-inbox-recent-ledger.png

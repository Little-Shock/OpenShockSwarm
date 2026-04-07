# Test Report 2026-04-07 Webhook Replay

- Command: `pnpm test:webhook-replay`
- Control server: `http://127.0.0.1:43588`
- Workspace root: `/tmp/openshock-webhook-replay-artifacts/run-lrBxNh/workspace`
- State file: `/tmp/openshock-webhook-replay-artifacts/run-lrBxNh/workspace/data/phase0/state.json`
- Artifacts dir: `/tmp/openshock-webhook-replay-artifacts/run-lrBxNh`

## Scope

- 覆盖 `TC-015` 的 webhook ingest / signature verify / normalized writeback 片段。
- 覆盖 `TC-025` 的 review / comment / check / merge replay，以及 failure-path observability。
- 环境使用临时 `openshock-server` + seed state，通过真实 HTTP 请求打 `/v1/github/webhook`，不是直接调用 store helper。

## Checks

### Repeated check replay stays idempotent
- HTTP status: `200`
- 重复回放同一条 check_run 成功事件后，PR #18 仍保持 in_review。
- review inbox 只保留 1 张 `PR #18 已准备评审` 卡片。
- room-runtime 只保留 1 条 `PR #18 已同步到 GitHub 当前状态：in_review。` 消息。

### Review replay blocks tracked PR and adds blocked inbox surface
- HTTP status: `200`
- PR #22 被回写成 changes_requested / CHANGES_REQUESTED。
- room-inbox 与对应 issue 同步进入 blocked。
- 新增 `PR #22 需要补充修改` blocked 卡片，且不误删无关的 seed review inbox。

### Comment replay preserves blocked review summary
- HTTP status: `200`
- PR #22 继续保持 changes_requested。
- comment body 没有覆盖 blocked review summary。
- room / run 继续保持 blocked 语义。

### Merge replay marks room, run, issue, and PR as done
- HTTP status: `200`
- PR #18 被回写成 merged。
- room-runtime / run_runtime_01 / 对应 issue 同步进入 done。
- inbox 出现 `PR #18 已合并` status 卡片。

### Bad signature fails closed
- HTTP status: `401`
- 错误签名被 401 拒绝。
- 返回 payload 明确给出 `invalid github webhook signature`。

### Untracked PR replay is accepted but explicitly ignored
- HTTP status: `202`
- 未跟踪 PR #404 没有把 state 写坏。
- 接口以 202 + ignored=true + not tracked reason 显式回包。

## TC-015 GitHub App 安装与 Webhook

- 当前执行状态: Blocked
- 实际结果: 已在本地 replay 环境坐实签名校验、review/comment/check/merge 事件写回和错误回包；但这仍不是“GitHub App installation 完成后的真实远端 callback”。
- 业务结论: webhook ingest / replay 这半段已被 `TKT-05` 验到；完整 installation-complete live callback 继续留给后续远端票收口。

## TC-025 GitHub Webhook Replay / Review Sync

- 当前执行状态: Pass
- 实际结果: 重放 review/comment/check/merge 事件后，PR / inbox / room / run / issue 都按预期更新；bad-signature 与 untracked PR 都有显式失败 / ignored contract。
- 业务结论: `TKT-05` 现在已经把 webhook replay fixture 和 exact replay evidence 摆上桌，reviewer 可以按同一命令独立复核。


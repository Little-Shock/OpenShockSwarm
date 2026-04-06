# OpenShock Team Execution Directive

**版本:** 1.0
**更新日期:** 2026 年 4 月 7 日
**关联文档:** [Execution Tickets](./Execution-Tickets.md) · [Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、唯一真值

- 产品范围只认 `PRD -> Checklist -> Execution Tickets -> Test Cases`。
- 实时状态以 live board 为准。
- 如果 board、口头同步、文档冲突，以文档链和代码真值为准，不以口头为准。

---

## 二、团队执行规则

1. 每次只 claim 一张 ticket。
2. 一个分支只做一张 ticket 的 write scope。
3. 不允许把未验证能力写成“已完成”。
4. 任何改动必须同时更新：
   - 相关文档
   - 相关测试
   - 相关票据状态
5. reviewer 先看 blocker，再看风格；没有 blocker 就尽快合。

---

## 三、每张票的提交内容必须包含

- `Goal`
- `Scope`
- `Changed Files`
- `Self-Check`
- `Test Cases`
- `Risks`
- `Docs Updated`

---

## 四、自测最低要求

- 后端票至少跑相关 `go test`
- 前端票至少跑 typecheck / build
- 涉及主链的票至少跑 `pnpm verify:release`
- 涉及浏览器流程的票必须补 headed evidence

---

## 五、提测与合并门

- PR 描述必须列出对应 `TKT-*` 和 `TC-*`
- 没有测试证据的，不进 review
- 文档和代码口径冲突的，不合并
- 合并后主分支必须保持 clean

---

## 六、每日同步格式

- `Today`
- `Blocked`
- `Next`
- `Ticket`
- `Needed Review`

示例：

- Today: 完成 `TKT-01` pairing reconcile 的 server patch 和 regression tests
- Blocked: `ops:smoke` 还没补 URL truth check
- Next: 接 `TKT-02`
- Ticket: `TKT-01`
- Needed Review: backend + setup flow

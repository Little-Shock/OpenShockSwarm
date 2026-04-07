# OpenShock To Do List

**版本:** 0.3
**更新日期:** 2026 年 4 月 6 日
**关联文档:** [PRD](./PRD.md) · [Product Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、这份文档现在只做什么

- 不再把“完整产品范围”和“当前已完成实现”混在一起
- 不再把“contract 已落地”和“浏览器级 / 线上级闭环已验证”混写
- 只维护当前最需要推进的 GAP、优先级和推荐顺序

如果 live board 和文档冲突：

- 实时状态以 live board 为准
- 需求边界以 `PRD + Checklist` 为准
- 测试结论以 `Test Report` 为准

---

## 二、当前已经站住的基线

- chat-first 主壳与主要路由可在浏览器打开
- issue -> room -> run -> session -> worktree lane 主链已存在
- daemon bridge 可执行本地 prompt
- memory 列表/详情、version/governance contract 和文件写回已存在
- auth session / workspace members / owner-side roster mutation surface 已存在
- state SSE 初始快照已存在

这些能力的详细验收见 [Product Checklist](./Checklist.md) 中的 `CHK-01/03/05/10/13/15`。

---

## 三、当前必须先收的 GAP

### GAP-01 Runtime Pairing 冷启动一致性

- 现象:
  - `GET /v1/runtime/pairing` 可能返回旧的 `8090`
  - 实际活跃 daemon 在 `18090`
  - 首次 `POST /v1/exec` 会直接 `502`
- 影响:
  - Setup 主链首跳失败
  - `ops:smoke` 产生假绿
- 相关合同:
  - `CHK-04`
  - `CHK-14`
  - `CHK-15`
- 优先级: P0

### GAP-02 GitHub App / Webhook / 真实远端 PR 闭环

- 现状:
  - 当前已经有 effective auth path、app-backed PR create/sync/merge contract 和相关 tests
  - 但 onboarding、浏览器级真实回放、live repo/webhook 实机验证还没收口
- 相关合同:
  - `CHK-07`
  - `CHK-13`
- 优先级: P0/P1

### GAP-03 完整身份、成员、角色与设备授权

- 现状:
  - login / logout / session persistence foundation 已站住，`/access` 已消费 live auth/member/role truth
  - owner-side invite、member role/status mutation 已接进 `/access`
  - 跨 issue / room / run / inbox / repo / runtime 的 action-level authz matrix 已收平
  - 设备授权与完整邮箱验证流程仍未完成
- 相关合同:
  - `CHK-12`
  - `CHK-13`
- 优先级: P1

### GAP-04 通知、恢复触达与审批中心产品化

- 现状:
  - notifications 对象存在
  - approval center lifecycle 已落到 `/inbox`
  - `/settings` 已接上 browser push / email policy、subscriber model、fanout receipts 与 retry truth
  - 邀请 / verify / reset password mail template 仍未接到同一 delivery chain
- 相关合同:
  - `CHK-08`
  - `CHK-11`
- 优先级: P1

### GAP-05 多 Runtime 调度与 Failover

- 现状:
  - registry / pairing / selection / scheduler / lease / failover handling 已落地
  - 当前剩余的 runtime 风险已收敛到 `GAP-01` 的 pairing 冷启动一致性，不再是独立的 scheduler blocker
- 相关合同:
  - `CHK-14`
- 优先级: P1

### GAP-06 Long-term Memory Hardening

- 现状:
  - 当前已有 run stop/resume/follow-thread 人类接管闭环，以及 memory contract、injection preview 与 skill/policy promotion flow
  - 更重的长期记忆整理引擎、TTL、去重压缩与外部 provider 编排仍未完成
- 相关合同:
  - `CHK-10`
- 优先级: P2

---

## 四、推荐推进顺序

1. 先修 `GAP-01`，同时补 `ops:smoke`，把 Setup 主链和回归门收稳。
2. 再推进 `GAP-02`，把 GitHub 线从“探测/本地状态”升级到“远端闭环”。
3. 然后处理 `GAP-03` 与 `GAP-04`，补团队级身份与通知能力。
4. 最后推进 `GAP-05` 与 `GAP-06`，扩到多 runtime 调度和更重的长期记忆增强。

---

## 五、每张执行票最少要写清什么

- `Goal`
- `Scope`
- `Dependencies`
- `Self-Check`
- `Review Gate`
- `Merge Gate`
- `Related Checklist IDs`
- `Related Test Case IDs`

没有这 7 项，不进入 active execution。

---

## 八、每一轮固定 Loop

每一轮开发固定按这个顺序：

1. PI / 架构锁 active batch
2. owner claim 并实现
3. owner 自测并贴证据
4. reviewer 只报 blocker / no-blocker
5. blocker 按最小范围回补
6. reviewer 重核
7. `in_review -> done`
8. round-end verify / push / board 清绿
9. 立刻起下一轮 planning 票

不允许停在：

- 只有口头同步，没有仓库文档
- 只有实现，没有 reviewer 证据
- 只有 reviewer PASS，没有板面收口
- 当前 batch 刚结束，下一轮却没人开票

---

## 九、维护规则

- 每一轮收口后，先更新这份文档，再开下一轮 planning 票
- 如果 live board 已经收掉某条 face，对应条目要同步从“下一步”挪到“已完成”
- 如果 backlog 方向变了，必须先更新这里，再去频道口头宣布

这份文档的目标不是写愿景，而是让大家下一次开票时不需要重新争论：

- 现在已经做完了什么
- 还剩哪些 face
- 下一张票该怎么开

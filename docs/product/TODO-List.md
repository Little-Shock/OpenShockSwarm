# OpenShock To Do List

**版本:** 0.5
**更新日期:** 2026 年 4 月 8 日
**关联文档:** [PRD](./PRD.md) · [Product Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、这份文档现在只做什么

- 只维护当前最需要推进的 GAP、优先级和推荐顺序
- 不再把“完整产品范围”和“当前已完成实现”混在一起
- 不再把“contract 已落地”和“浏览器级 / 线上级闭环已验证”混写

如果 live board 和文档冲突：

- 实时状态以 live board 为准
- 需求边界以 `PRD + Checklist` 为准
- 测试结论以 `Test Report` 为准

---

## 二、当前已经站住的基线

- 统一 workspace shell 已站住:
  - `chat / inbox / board / setup / issues / runs / agents / memory / access / settings` 已共享同一套壳体
  - `Chat / Work` 顶部切换、同源 `/api/control/*` proxy、work surface 去白缝与密度收紧已完成当天有头走查
- Setup 主链、runtime pairing 冷启动一致性、release smoke gate 已站住
- 真实远端 PR browser loop、signed webhook replay 已站住
- login / session / invite / member role / action-level authz matrix 已站住
- approval center、notification delivery、memory governance、stop/resume/follow-thread 已站住
- multi-runtime scheduler / active lease / offline failover 已站住

这些能力的详细验收见 [Product Checklist](./Checklist.md) 和 [Testing Index](../testing/README.md)。

---

## 三、当前必须先收的 GAP

### GAP-07 Quick Search / Search Results

- 现状:
  - 左栏已经有 `Quick Search` 入口，但还只是静态按钮
  - 没有真正的结果面、跳转动作、键盘导航
- 影响:
  - 用户仍要靠翻左栏和人工记路径切页面
- 相关合同:
  - `CHK-01`
  - `CHK-16`
- 优先级: P0

### GAP-08 DM / Followed Thread / Saved Later

- 现状:
  - thread rail 和回复子区已经存在
  - 但 `DM / followed thread / saved later` 还没形成完整消息工作流
- 影响:
  - OpenShock 还不像 `app.slock.ai` 那样以消息和回访驱动协作
- 相关合同:
  - `CHK-16`
  - `CHK-17`
- 优先级: P0

### GAP-09 Room Workbench / Profile / Presence

- 现状:
  - room / run / PR truth 已有
  - 但 `Chat / Topic / Run / PR / Context` 还没在一个 room workbench 内稳定切换
  - `Agent / Machine / Human` 也还没有统一 profile surface
- 影响:
  - 用户仍要在多个详情页之间跳转
- 相关合同:
  - `CHK-02`
  - `CHK-06`
  - `CHK-17`
- 优先级: P0/P1

### GAP-10 Frontend Interaction Polish

- 现状:
  - 这轮已经收掉共享壳体白缝、Work 页过大卡片和部分密度问题
  - 但滚动回看、下拉位置、字号、输入框、侧栏高亮、窄屏抽查还没有系统化验收
- 影响:
  - 产品容易在高频使用时暴露“能用但不顺手”的问题
- 相关合同:
  - `CHK-01`
  - `CHK-16`
  - `CHK-17`
- 优先级: P0

### GAP-11 Board Light Planning Cleanup

- 现状:
  - Board 已退到左下角次级入口
  - 但 card 语言和 room / issue / board 回跳还不够轻
- 影响:
  - planning mirror 还不够克制，仍会抢注意力
- 相关合同:
  - `CHK-05`
  - `CHK-18`
- 优先级: P2

### GAP-12 GitHub App Installation-Complete Live Callback

- 现状:
  - onboarding、webhook replay、远端 PR merge 已站住
  - installation-complete 后的 live callback / repo 持续同步仍缺实机闭环
- 相关合同:
  - `CHK-07`
- 优先级: P1

### GAP-13 Device Authorization / Email Verification

- 现状:
  - invite / role / status / authz matrix 已站住
  - 设备授权、verify / reset 邮件链、完整外部身份绑定仍未产品化
- 相关合同:
  - `CHK-13`
- 优先级: P1

### GAP-14 Destructive Guard / Secret Boundary

- 现状:
  - 权限矩阵与 run control 已站住
  - destructive action approval、secret boundary、越界写保护仍未产品化
- 相关合同:
  - `CHK-12`
- 优先级: P1

### GAP-15 Runtime Lease Conflict / Scheduler Hardening

- 现状:
  - failover 基线已经站住
  - 更细的 lease conflict、scheduler policy 与恢复策略还没有继续收紧
- 相关合同:
  - `CHK-14`
  - `CHK-15`
- 优先级: P1

---

## 四、推荐推进顺序

1. 先做 `TKT-21`，把 `Quick Search / Search Results` 立住。
2. 再做 `TKT-22` 和 `TKT-24`，把 `DM / followed thread / saved later` 与 interaction polish 先收出高频可用性。
3. 然后做 `TKT-23`，把 room workbench tabs 接起来。
4. 再做 `TKT-25`，补齐 `Agent / Machine / Human profile + presence`。
5. 最后做 `TKT-26`，把 Board 的 planning 语言和回跳关系再收轻。
6. `TKT-28/29/30/31` 作为并行后端 backlog 推进，但不抢当前前端主线优先级。

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

没有这 8 项，不进入 active execution。

---

## 六、每一轮固定 Loop

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

## 七、维护规则

- 每一轮收口后，先更新这份文档，再开下一轮 planning 票
- 如果 live board 已经收掉某条 face，对应条目要同步从“下一步”挪到“已完成”
- 如果 backlog 方向变了，必须先更新这里，再去频道口头宣布

这份文档的目标不是写愿景，而是让大家下一次开票时不需要重新争论：

- 现在已经做完了什么
- 还剩哪些 face
- 下一张票该怎么开

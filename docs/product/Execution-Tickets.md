# OpenShock Execution Tickets

**版本:** 1.2
**更新日期:** 2026 年 4 月 8 日
**关联文档:** [PRD](./PRD.md) · [Checklist](./Checklist.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、使用方式

- 这份文档承接 **当前未完成功能** 的 canonical ticket backlog，并保留刚完成批次的简短归档。
- 已完成能力的详细证据继续以 [Checklist](./Checklist.md) 和记实测试报告为准，不在这里重复展开。
- 每张票必须绑定对应 `Checklist` 和 `Test Case`，否则不能 claim。

### 状态定义

- `todo`: 还没开始
- `active`: 已 claim，正在实现
- `review`: 已提测，等待 reviewer / QA
- `done`: 已过 gate 并进入主线

---

## 二、当前批次优先级

1. 前端主线先往 `app.slock.ai` 的协作壳靠拢。
2. Board 保留，但降为次级 planning surface。
3. destructive guard、GitHub live callback、设备授权继续保留在并行 backlog，不抢当前前端批次。

### Frontend Batch Merge Gate

- 每张前端票都必须补 headed browser walkthrough 证据，不接受只跑 headless。
- 每张前端票都必须更新 `Checklist -> Test Cases -> Ticket` 的映射。
- 每张前端票都必须做桌面主视口走查；如改布局，还要补一轮窄屏抽查。

---

## 三、当前待收口票

## TKT-16 app.slock.ai Shell / Workspace Navigation Reframe

- 状态: `active`
- 优先级: `P0`
- 目标: 把当前多页面控制台壳重排成 `app.slock.ai` 风格的 workspace-scoped collaboration shell，让 `Channel / Room / Inbox / DM / Presence` 成为默认入口。
- 范围:
  - sidebar order、workspace context、global search 入口、threads / saved 入口占位
  - utility pages 降级为 secondary surfaces，不再和聊天壳抢主导航
  - 现有 route regroup、shell primitives、responsive layout
- 依赖: 无
- Done When:
  - 用户进入应用后先落到统一工作区壳，而不是分散 utility page
  - `Channel / Room / Inbox / Agent / Machine` 能在同一层级被发现
  - headed walkthrough 能稳定覆盖新壳
- Checklist: `CHK-01` `CHK-16`
- Test Cases: `TC-028` `TC-031`

## TKT-17 DM / Thread / Search / Saved Surface

- 状态: `active`
- 优先级: `P0`
- 目标: 补齐 Slock 壳最缺的消息型 surface，让 `DM / followed thread / saved / search` 成为真实前台入口。
- 范围:
  - DM 数据模型到前端入口
  - followed thread / deep-link / unread semantics
  - search / quick switch 入口与基础结果面
  - saved / later 列表或等价暂存面
- 依赖: `TKT-16`
- Done When:
  - 用户可从壳层进入 DM、线程回访和 search
  - 线程可以被 follow / reopen，而不是只停在 run control 的 `follow-thread` 语义
  - 至少有一条 headed browser walkthrough 覆盖 `channel -> thread -> reopen` 或等价 DM 流程
- Checklist: `CHK-16` `CHK-17`
- Test Cases: `TC-029` `TC-031`

## TKT-18 Agent / Machine / Human Profile + Presence

- 状态: `todo`
- 优先级: `P1`
- 目标: 把 `Agent / Machine / Human` 做成像 `app.slock.ai` 一样的一等资料面和 activity surface。
- 范围:
  - profile routes / panel
  - presence badges / activity summary / capability facts
  - shell / room 内的 drill-in entry
- 依赖: `TKT-16`
- Done When:
  - shell 内任一 `Agent / Machine / Human` 可跳到 profile surface
  - live state 的 presence / runtime / capability truth 被直接消费
  - profile surface 不再只是孤立详情页
- Checklist: `CHK-02` `CHK-17`
- Test Cases: `TC-030`

## TKT-19 Room Context Tabs / Topic Workbench

- 状态: `todo`
- 优先级: `P1`
- 目标: 把 Room 收成主工作台，让 `Chat / Topic / Run / PR / Context` 在一个 workbench 里切换，而不是频繁跳页。
- 范围:
  - room header tabs
  - topic summary / run truth / PR truth / memory-context back-links
  - room-first navigation and state persistence
- 依赖: `TKT-16` `TKT-18`
- Done When:
  - Room 变成默认工作台
  - `Chat / Topic / Run / PR` 切换不丢当前上下文
  - run control、PR entry、inbox back-link 保持可用
- Checklist: `CHK-06` `CHK-17`
- Test Cases: `TC-031`

## TKT-20 Board Secondary Planning Surface

- 状态: `active`
- 优先级: `P2`
- 目标: 保留 Board，但把它降为 issue / room 的次级规划面，不再主导首页心智。
- 范围:
  - board nav demotion
  - room / issue context back-links
  - 更轻的 planning cards，与 issue lane 对齐
- 依赖: `TKT-19`
- Done When:
  - Board 仍可创建 / 浏览 issue，但不再是 primary shell center
  - 进入 Room / Issue 后能顺手打开 planning surface 再回来
  - 文档、导航和用词都不再把 Board 写成默认中心
- Checklist: `CHK-05` `CHK-18`
- Test Cases: `TC-032`

## TKT-15 Sandbox / Secrets / Destructive Action Guard

- 状态: `todo`
- 优先级: `P1`
- 目标: 把执行安全从“继承本地环境”推进到产品化 guard。
- 范围:
  - secret boundary
  - destructive git / filesystem approval
  - sandbox mode visibility
- 依赖: 无
- Done When:
  - destructive action 进入 approval required
  - secrets 与 runtime capability 边界清楚
- Checklist: `CHK-12`
- Test Cases: `TC-027`

---

## 四、已完成批次归档

- `TKT-01` `done`
  - Runtime pairing 冷启动一致性已收平，Setup 首跳不再因旧 daemon URL 漂移而 502。
- `TKT-02` `done`
  - `ops:smoke` / release gate 已能显式拦截 pairing 漂移。
- `TKT-03` `done`
  - headed Setup 主链自动化已建立，并能输出截图、trace、日志与报告。
- `TKT-04` `done`
  - GitHub App onboarding / repo binding blocked UX 已在浏览器里可复核。
- `TKT-05` `done`
  - signed webhook replay / review sync exact evidence 已补齐。
- `TKT-06` `done`
  - 真实远端 PR create / sync / merge browser loop 已通过。
- `TKT-07` `done`
  - login / logout / session persistence foundation 已站住。
- `TKT-08` `done`
  - workspace invite / member / role lifecycle 已站住。
- `TKT-09` `done`
  - action-level authz matrix 已接到 live frontend + backend guards。
- `TKT-10` `done`
  - approval center lifecycle 已落到 `/inbox`。
- `TKT-11` `done`
  - browser push / email preference / delivery chain 已站住。
- `TKT-12` `done`
  - memory injection / promotion / governance surface 已站住。
- `TKT-13` `done`
  - stop / resume / follow-thread 人类接管链已站住。
- `TKT-14` `done`
  - multi-runtime scheduler / lease / failover 已站住。

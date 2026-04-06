# OpenShock To Do List

**版本:** 0.2
**更新日期:** 2026 年 4 月 6 日
**用途:** 给后续开票、拆票、收口提供一个稳定的执行清单，不再只靠频道口头同步。

---

## 一、这份文档怎么用

这份 To Do List 只做 4 件事：

1. 记录当前已经完成的执行面，避免重复开票
2. 把接下来还要推进的 face 分清楚
3. 给开票人一个可直接落板的拆票方向
4. 固定每一轮的开票和收口规则，避免 batch 漂移

如果 live board 和这份文档冲突：

- 板面状态以 live board 为准
- face 划分、拆票方向、gate 规则以这份文档为准

---

## 二、当前 active batch 归口

这份文档不再承载会频繁变化的 live status 快照。

- 实时 `done / in_progress / in_review / todo` 一律以 live task board 为准
- 这份文档只固定 face 划分、canonical batch、umbrella/backlog 归口、拆票方向和 gate 规则

按当前 planning 归口，Phase 3 只认这版：

- canonical active batch:
  - `#28` GitHub App install / auth / repo binding contract
  - `#29` webhook ingest / signature verify / event normalization
  - `#30` review / comment / check / merge 事件写回 `state / inbox / room`
  - `#31` multi-runtime registry / heartbeat / pairing state contract
  - `#32` runtime scheduler / selection / multi-runtime surface
- umbrella backlog:
  - `#24` GitHub 集成产品化主题票
  - `#25` 多 runtime 注册 / 心跳 / 调度主题票

这意味着：

- 当前 Phase 0 到 Phase 2 主链已经收口
- Phase 3 执行面只按 `#28-#32` 这组票推进
- `#24/#25` 继续只做 umbrella backlog / face 归口，不直接当执行票
- 谁空出来就直接回看 live board，再认领 `#28-#32` 里仍待推进的票

---

## 三、已完成 Faces

### Face A: Phase 0 基线与工程入口

已完成：

- 仓库基线、分支、代理、回归门
- Go toolchain / PATH / repo 级 verify 门
- README / docs index / PRD / Phase0-MVP / Runbook 真值收口

对应已完成票：

- `#2 #3 #4 #8 #9 #10 #12`

### Face B: Web 协作壳与 live truth

已完成：

- Chat / Board / Inbox / Issues / Rooms / Runs / Agents / Setup / Settings 主壳
- `board / inbox / agents / room` 从 mock-data 收成 live truth
- `workspace / channels / issues / runs` 剩余 mock/fallback 收口

对应已完成票：

- `#5 #14 #20`

### Face C: Server 控制面主链

已完成：

- workspace / issue / room / run / inbox / github binding API 壳
- issue -> room -> run -> session -> worktree lane 主链
- GitHub PR create / sync / merge 主链
- GitHub PR failure-path blocked escalation contract

对应已完成票：

- `#6 #15 #22`

### Face D: Daemon / Runtime 基线

已完成：

- runtime / worktree / exec contract
- server 与 daemon 的最小闭环

对应已完成票：

- `#7`

### Face E: 文件级记忆与写回

已完成：

- `MEMORY.md / notes / decisions` 从 scaffold 升级为可验证写回 contract

对应已完成票：

- `#16`

### Face F: 人类决策面

已完成：

- Inbox `approval / blocked / review` 从只读卡片升级成真实 decision mutation loop
- `review` failure path 已与 `#22` failure contract 对齐

对应已完成票：

- `#21`

### Face G: Planning / Batch Gate

已完成：

- 每轮 planning / gate / merge 节奏锁定
- duplicate ticket 清理

对应已完成票：

- `#13 #19 #23 #26`

---

## 四、下一步 To Do Faces

当前真正该继续推进的 face 仍然只有 2 组，但已经从 umbrella backlog 进一步拆成了 Phase 3 执行票。

### Face 1: GitHub 集成产品化

对应 umbrella backlog：

- `#24`

当前已拆出的 Phase 3 执行票：

- `#28` GitHub App install / auth / repo binding contract
- `#29` webhook ingest / signature verify / event normalization
- `#30` review / comment / check / merge 事件同步回 state / inbox / room

当前归口：

- GitHub 集成产品化这条 face 的执行面固定看 `#28/#29/#30`
- 具体实时状态仍以 live board 为准

一句话目标：

- 把当前 gh CLI / remote probe 级别的 GitHub 能力，升级成可持续同步的 GitHub App / webhook / review sync 闭环

当前推荐执行顺序：

1. 先用 `#27` 把 GitHub 线的 gate / merge 节奏锁稳
2. `#28` 先站住 installation / auth / repo binding contract
3. `#29` 再补 webhook ingest / signature verify
4. `#30` 最后把 review/comment/check/merge 事件写回 `pullRequest / inbox / room / run`

补充说明：

- 如果后面需要补 web 可见面，也应该挂在 GitHub 集成产品化这条 face 下，而不是新开一条脱离 contract 的散票
- 这条 face 必须持续兼容当前 `#15/#22` 已经站住的 PR create/sync/merge 与 failure contract

这一 face 的 review gate：

- 不再只靠手动 sync 或 CLI probe 才能更新 review 状态
- webhook / app-state 错误可见且有测试锁住
- 现有 `#15/#22` 的 create/sync/merge contract 不被带坏

### Face 2: 多 Runtime 注册与调度

对应 umbrella backlog：

- `#25`

当前已拆出的 Phase 3 执行票：

- `#31` multi-runtime registry / heartbeat / pairing state contract
- `#32` runtime scheduler / selection / multi-runtime surface

当前归口：

- 多 runtime 这条 face 的执行面固定看 `#31/#32`
- 具体实时状态仍以 live board 为准

一句话目标：

- 把当前单 runtime pairing，升级成可注册多个 runtime、持续 heartbeat、并按 run 调度的真实控制面

当前推荐执行顺序：

1. `#31` 先把 registry / heartbeat / pairing state contract 站住
2. `#32` 再把 runtime scheduler / selection / multi-runtime surface 打通

补充说明：

- `#32` 已经进入进行态，但它不能脱离 `#31` 的 registry / heartbeat contract 单独漂移
- 这一 face 同时会动 `server + daemon + web`，所以 reviewer 必须按 write scope 分开核，不要把 GitHub 线的 reopen 混进来

这一 face 的 review gate：

- 多 runtime 真值能在 web 和 server 同时看到
- 调度决策不是静态 mock
- runtime offline / failover 有显式错误态

---

## 五、暂不进入下一拍 Active Batch 的 Faces

这些方向在 PRD 里成立，但当前不建议和 `#24/#25` 混开：

- 完整审批中心产品化
- 浏览器 push / 邮件通知生产化
- 邮箱登录 / workspace 成员 / 权限系统
- 长期自治、多 Agent 协商、自动 merge

规则很简单：

- 没有明确 owner、write scope、gate 的，不起执行票
- 没有从当前 repo 真缺口直接导出的，不抢进 active batch

---

## 六、推荐开票顺序

当前这一拍建议按这个顺序推进：

1. 先用 `#27` 锁定 canonical active batch / gate / merge 节奏
2. GitHub 线按 `#28 -> #29 -> #30` 往前推
3. 多 runtime 线按 `#31 -> #32` 往前推

如果要并行：

- 可以并行，但必须先切清 write scope
- `#28/#29/#30` 和 `#31/#32` 可以跨 face 并行
- 同一条主链内部不要再重复起 scope 重叠的票

---

## 七、每张票必须写清的字段

后续开票统一至少包含：

- `Goal`
- `Write Scope`
- `Self-Check`
- `Review Gate`
- `Merge Gate`
- `Parallel`
- `Blocked-by`

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

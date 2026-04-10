# Upstream Branch Harvest 2026-04-10

## Scope

这份文档只做一件事:

- 把 `upstream` 上 4 条未并回主线的历史平行分支拆成可复用知识
- 明确哪些值得吸收进当前 `main/dev`
- 明确哪些只适合作为参考, 不适合直接 merge

对照基线:

- `origin/main` = `origin/dev` = `upstream/main` = `upstream/dev` = `82bc31f`
- 额外分支:
  - `upstream/eng01/batch6-83` = `7650512`
  - `upstream/eng01/pr1-head-regression-fix` = `944d78e`
  - `upstream/feat/initial-implementation` = `d5d481e`
  - `upstream/feat/tff` = `f0be36f`

共同特征:

- 4 条分支都从同一个老基线 `5b021a0` 分出
- 没有任何一条已并入当前 `main`
- 价值主要在设计和 contract 思路, 不是可直接回灌的代码

## Branch-By-Branch

### 1. `eng01/batch6-83`

主题:

- 最早的 `0A skeleton`
- JS `apps/server` + Go `daemon` + 早期 `apps/shell`
- 关注 integrated runtime bring-up、fixture seed、daemon publish、debug evidence

最值得吸收的点:

- `runtime ready` 不只看服务存活, 还会走 `fixture seed -> smoke -> shell state ready`
- daemon publish 有明确 cursor store, 能防重复重放
- replay/debug/history 被写成真正的 regression test, 不是一次性脚本

不建议直接 merge 的原因:

- 还是旧 JS 控制面
- topic-centric, 不是当前 chat/channel/room 主线
- sample-topic/demo helper 太重

结论:

- 适合作为 `runtime publish / replay / readiness` 语义参考

### 2. `eng01/pr1-head-regression-fix`

主题:

- 在 batch6 之上补 `/v1`、integration projection、debug/replay/read-model
- 明显开始转向 API-first

最值得吸收的点:

- 明确把 `Topic / Actor / ApprovalHold / Blocker / Delivery` 当成外部资源 contract
- 明确把 command write surface 和 event/debug read surface 分开
- 明确 `/v1` namespace、error family、rejection reason、cursor replay
- draft 已经写出“外部 consumer 怎么调”而不是只围前台页面

不建议直接 merge 的原因:

- 仍然建立在旧 JS server / old shell 之上
- 产品壳和当前主线已分叉

结论:

- 这是 4 条分支里最该喂给当前 Go server 的一条
- 主要吸收方向:
  - `/v1` contract 稳定化
  - command / event / debug read-model
  - replay / rejection explainability

### 3. `feat/initial-implementation`

主题:

- 一整条历史 staged roadmap
- 从 batch6 一路滚到 stage7a/stage7b
- 里面包含 stage1~stage7 的大量 nouns 和操作 contract

最值得吸收的点:

- shell 只 fan-in 稳定 `/v1` truth, 不允许长期保留 shell-local shadow truth
- staged backlog 拆得很清楚:
  - stage4: governance / installation / repo binding / notification / external memory
  - stage5: hosted workbench / inbox attention routing / runtime fleet
  - stage6: onboarding / notification recovery / quota / plan limit
  - stage7: checkout / subscription / invoice / coupon
- runbook / release gate / delivery entry contract 思路成熟

不建议直接 merge 的原因:

- 还是旧 `apps/server + apps/shell` 结构
- 夹带大量 hosted billing / subscription 方向, 不适合当前近端优先级

结论:

- 最适合作为 PRD / Checklist / Ticket backlog 的知识来源
- 当前主线应吸收其:
  - API-first + no-shadow-truth 方法论
  - onboarding / governance / memory-provider / release-gate 的拆票顺序

### 4. `feat/tff`

主题:

- 另一套完整 repo 形态: `apps/frontend + apps/backend + apps/daemon`
- 前端组件化程度高, 但视觉气质更接近 dashboard

最值得吸收的点:

- `shell-frame / room-context-panel / action-strip / repo-binding panel` 这类组件拆分方式
- `bootstrap -> detail -> action` 的 API 组织方式
- agent turn / run claim loop 的执行心智比较直观

不建议直接 merge 的原因:

- 视觉不是 `app.slock.ai` 路线
- repo 结构和当前主线完全不同
- 分支里有 `.playwright-cli` 等调试残留, 工程卫生差

结论:

- 只适合作为局部组件拆分参考
- 不适合作为当前前端气质或架构方向

## What To Absorb Into Mainline

### A. Control-Plane Must Be API-First

来源:

- `eng01/pr1-head-regression-fix`
- `feat/initial-implementation`

主线吸收口径:

- 外部 contract 默认走版本化 `/v1`
- command write surface 和 event/debug read surface 明确分离
- debug / replay / rejection reason 不再被视为内部临时工具
- error family、idempotency、cursor replay 要有明确 contract

落地去向:

- `TKT-58`
- `TC-047`

### B. Shell Must Not Become A Second Truth Plane

来源:

- `feat/initial-implementation`

主线吸收口径:

- shell 只能 fan-in stable truth
- adapter 可以存在, 但只能做投影和兼容层
- 新 surface 不允许偷偷长出 shell-local shadow state 作为正式真相

落地去向:

- `TKT-59`
- `TC-048`

### C. Runtime Publish / Replay Needs Stronger Lineage

来源:

- `eng01/batch6-83`
- `eng01/pr1-head-regression-fix`

主线吸收口径:

- daemon publish 要有 cursor / idempotency / evidence packet
- closeout / failure anchor / replay packet 要能被外部 consumer 读到
- runtime readiness 继续坚持 fixture/smoke/readiness 三段式验证

落地去向:

- `TKT-60`
- `TC-049`

### D. Backlog Should Follow Staged Dependency Order

来源:

- `feat/initial-implementation`

主线吸收口径:

- 先收 API/adapter/runtime truth
- 再收 onboarding / governance / external memory / release contract
- 不把 hosted billing / subscription 提前压进当前近端主线

落地去向:

- `docs/product/TODO-List.md`
- `docs/product/Execution-Tickets.md`

### E. Frontend Only Reuses Decomposition, Not Style

来源:

- `feat/tff`

主线吸收口径:

- 可借鉴组件拆法, 不借鉴视觉终态
- 气质继续以 `app.slock.ai` 和当前 OpenShock 字体/密度约束为主

## What Not To Do

- 不把这 4 条分支整条 merge 回当前主线
- 不把旧 JS `apps/server` / `apps/shell` 代码直接塞回 Go + Next.js 主线
- 不因为 `feat/initial-implementation` 里有 stage7 billing 就打乱当前优先级
- 不把 `tff` 的 dashboard 风格当成前端目标

## Output For Current Mainline

这次知识回收之后, 主线应该显式保留 3 件新增待办:

1. `TKT-58`
   - Control-plane `/v1` command / event / debug read-model 稳定化
2. `TKT-59`
   - Shell adapter / no-shadow-truth contract
3. `TKT-60`
   - Runtime publish cursor / replay evidence packet

如果后续再看这 4 条分支, 默认顺序应当是:

1. 先看 `eng01/pr1-head-regression-fix`
2. 再看 `feat/initial-implementation`
3. 再看 `eng01/batch6-83`
4. 最后才看 `feat/tff`

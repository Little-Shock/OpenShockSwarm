# OpenShock TODO

**更新日期:** 2026-04-28  
**关联文档:** [PRD](./PRD.md) · [Checklist](./Checklist.md) · [Testing Index](../testing/README.md)

## 这份文档现在只做什么

- 只保留当前还没收完的产品 GAP
- 只回答“今天先做什么”
- 不再承担长历史归档

如果你只看今天这轮，优先记住这 4 个产品缺口：

- request-scoped auth 已收成 token-enforced request scope；planner queue / assignment / auto-merge 也已切到 request-scoped guard；双用户并发 walkthrough 已补齐，下一拍只补少量 `state.Auth.Session` 兼容尾项
- 首启入口虽然已经减法，但产品前门和文档前门还要继续统一成同一条首次成功路径
- `Board / Rooms / Settings` 的 supporting flow 还要继续减法，避免重复 next-step 摘要回流
- durable memory / provider / recovery 还缺多 session 重放、降级恢复和交接证据

如果实时状态面板、测试报告和这里冲突：

- 实时状态以实时状态面板为准
- 产品边界以 `PRD + Checklist` 为准
- 验证结论以 `Test Report` 为准

## 当前已经站住的基线

- 统一 workspace shell 已站住：`Chat / Rooms / Board / Setup / Access / Settings`
- `Board -> 讨论 -> 执行` 主链已站住
- `/rooms` 已有 continue entry，不再只是列表页
- `Setup`、runtime pairing、repo truth、GitHub readiness 已接入同一条验证线
- `verify:release:rc`、`verify:release:full`、`ops:smoke` 已收成正式发布入口
- auth/session 已从默认 owner 放行改成默认 signed-out
- 关键 mutation 已统一走 session + permission guard，401/403 不再泄露完整 state
- request-scoped auth 已 fail-closed：无 token 的 detail/read/mutation 默认 signed-out，browser/integration/release gate 已切到显式 token 或 cookie
- internal notification worker 已切到 shared secret 鉴权

## 当前优先级

### P0 Auth challenge hardening

状态：已完成。保留本段只为了给 reviewer 一个单点真值；下一轮从当前优先级移除。

目标：把“知道邮箱就能登录 / claim owner / reset recovery”收成真正的 challenge-based auth。

当前真值：

- `POST /v1/auth/session` 现只接受 challenge-based login，不再接受裸邮箱登录
- fresh bootstrap owner claim 已收成 `request_login_challenge -> /v1/auth/session`，不能再直接 claim placeholder owner
- `verify_email` 与 `authorize_device` 已收成 `request_*_challenge -> consume challenge` 两段式一次性 contract
- `request_password_reset` 会签发一次性 reset challenge；signed-out 只允许在持有有效 challenge 时执行 `complete_password_reset`
- store / api / integration / release gate 都已补到 replay、cross-account、expired 或 signed-out fail-closed 证据

Done when:

- 裸邮箱登录和 fresh bootstrap claim owner 被移除，所有进入工作区的路径都必须消费可验证 challenge
- `verify_email / authorize_device / request_password_reset / complete_password_reset` 都有一次性 challenge contract
- 同一份 auth contract 同时覆盖 signed-out、cross-account、replay、expired challenge

Evidence:

- `apps/server/internal/api/auth_contract_test.go`
- `apps/server/internal/store/auth_test.go`
- 对应 browser recovery 报告写入 `docs/testing/`

本轮验收结果应满足：

- 已满足：`POST /v1/auth/session` 不再接受 email-only login，并有对应 contract 覆盖
- 已满足：fresh bootstrap 下首个未知邮箱不能直接 claim owner，并有 store contract 覆盖
- 已满足：`verify_email / authorize_device / request_password_reset / complete_password_reset` 全部改成一次性 challenge contract，并覆盖 replay / expired / cross-account
- 已满足：auth contract、store contract、integration / release gate 都能给出可追溯证据

### P0 Request-scoped auth session

目标：把当前全局单例 `Auth.Session` 收成真正的 request-scoped auth，避免多用户登录和跨请求操作互相踩状态。

当前切口：

- `auth/session`、`workspace members`、`member preferences`、`auth recovery` 已支持 token-bound request actor
- `credential / control-plane / agent profile / topic / memory / direct message` 已开始统一吃 request actor，而不是继续只吃最后一次登录者
- `state stream`、`mailbox`、`pull-request`、`planner queue / assignment / auto-merge`、`room detail`、`run detail` 这批高风险读链已经接上 request-aware snapshot / visibility gate
- “无 token 时回退全局 `Auth.Session`”的兼容路径已经移除；当前默认 fail closed，并由 browser / integration / release gate 走显式 token 或 cookie
- `memory / topic / credential / agent profile / direct message / message surface` 这批 permission-gated supporting flow mutation response 已开始统一回 request-scoped state，不再把最后一次登录者塞回响应体

建议拆分顺序：

1. 增加 request actor resolver：先支持每个请求稳定解析 caller，而不是继续默认吃最后一次登录者
2. 给 store mutation 增加显式 actor 输入，逐步替代内部对 `s.state.Auth.Session` 的直接读取
3. 去掉“无 token 回退全局 session”的兼容逻辑，默认改成 signed-out，再把 browser / integration / contract 正向读链全部切到显式 token 或 cookie
4. 保留 `state.Auth.Session` 作为当前前台兼容真相，直到 `/access` 和 live shell 完成新凭据接线
5. 增加双用户并发 contract：A/B 两条会话并行时，permission、recovery、member mutation 不能互相污染

Done when:

- API 不再把 `state.Auth.Session` 当成唯一当前操作者真相
- 登录返回的身份凭据能在并发请求下稳定区分不同用户和设备
- 无 token 的 detail/read surface 默认 fail closed，不再隐式吃最后一次登录者
- 权限、恢复、device approval、workspace member 更新都按 request actor 判定，而不是按最后一次登录者判定
- auth / action guard / integration contract 同时覆盖 cross-user overlap、并发登录、signed-out replay 和跨账号恢复

Evidence:

- `apps/server/internal/store/auth.go`
- `apps/server/internal/api/auth_routes.go`
- `apps/server/internal/api/auth_action_guard_test.go`
- `apps/server/internal/integration/integration_test.go`

本轮验收结果应满足：

- `Snapshot().Auth.Session` 不再作为 auth/workspace/member preference/recovery 这批关键 mutation 的直接 actor 来源
- 已满足：header token 与双浏览器 cookie 两组并发 contract 都证明 A/B 会话不会互相覆盖 `/v1/auth/session`、state stream 和 member preference actor
- device approval、password reset、workspace member mutation 都已有 request-scoped actor 证据
- `state stream`、`mailbox`、`pull-request`、`room detail`、`run detail` 已补齐 request-aware 读链 redaction
- permission-gated supporting flow mutation response 已开始按 caller 返回 request-scoped state；browser + integration walkthrough 已补齐，下一轮只补少量非主链兼容点，不再回头补全局 session fallback

### P0 Setup / Onboarding 收口

目标：用户只面对一个首启入口，不再在 `/setup` 和 `/onboarding` 之间分裂。

Done when:

- `/setup` 是唯一主入口，`/onboarding` 只做兼容跳转
- 首页 continue、`/access`、`/setup` 指向同一条首启主路径
- 首屏只告诉用户“现在做什么”和“做完去哪里”，不再并列多个一级任务

Evidence:

- `apps/web/src/lib/home-first-screen.test.ts`
- `apps/web/src/lib/access-first-screen.test.ts`
- `apps/web/src/lib/setup-first-screen.test.ts`
- `apps/web/src/lib/critical-loop-contract.test.ts`

本轮验收结果应满足：

- `/setup` 是唯一首启主入口，`/onboarding` 只保留兼容跳转
- 首页 continue 与首启路由指向同一条路径
- `headed-critical-loop` 与 `critical-loop-contract` 都验证同一条主路径
- `Setup` 首屏只保留“现在做什么”和“下一步去哪”

### P0 Release evidence 单源化

状态：已完成。reviewer 现在可以用同一份 gate 产物和同一个 evidence locator 重新定位最新 RC / full 证据。

目标：发布 reviewer 不再翻三份文档和终端日志拼结论。

Done when:

- `verify:release:rc` 和 `verify:release:full` 都产出同级 summary report + durable logs
- `docs/testing/README.md` 只指向固定生成入口，不手写“最新日期 / commit”
- RC 报告明确写出内部 worker secret 与 runtime heartbeat secret 是否已配置

Evidence:

- `scripts/release-gate.sh`
- `scripts/release-evidence-latest.mjs`
- `scripts/release-gate-contract.test.mjs`
- `scripts/release-evidence-latest.test.mjs`
- `docs/testing/README.md`
- 对应 `docs/testing/Test-Report-*release*`

本轮验收结果应满足：

- 已满足：`pnpm verify:release:rc` 每次运行都生成 RC summary report 与原始日志
- 已满足：`pnpm verify:release:full` 每次运行都生成 full summary report 与原始日志
- 已满足：Testing Index、Release Gate、Runbook 都只给“如何定位最新证据”的方法，不手写“最新日期 / commit”

### P1 Headed suite 清单化

目标：让 release reviewer 不需要在 80+ 条 headed 命令里人工猜哪几条是 release-critical。

状态：已完成。release-critical manifest 已落到 `scripts/release-browser-suite.sh`，并由 release gate、contract test、Testing Index 共用。

Done when:

- release-critical headed suite 有单一 manifest，`package.json`、release gate 和 Testing Index 都从同一份清单读取
- release-critical 脚本和 supporting exploratory 脚本有明确分层
- 新增 headed 场景时，必须同步落到 manifest 或明确标注为非 release gate
- 至少一层脚本 contract 能覆盖命令入口、报告路径和关键参数，不再只靠人工扫脚本文件名

Evidence:

- `scripts/release-gate.sh`
- `scripts/release-gate-contract.test.mjs`
- `docs/testing/README.md`
- `package.json`

本轮验收结果应满足：

- reviewer 只看一个 manifest 就能知道 release gate 当前到底包含哪些 browser 主链
- `verify:release:*` 和 Testing Index 不会出现命令名漂移
- headed suite 的 release-critical / exploratory 边界可读、可测试、可审计

### P1 Frontend subtractive sweep

目标：继续给前台做减法，只保留当前对象、状态和下一步。

Done when:

- `/`、`Setup`、`Access` 首屏各自只剩一个主动作，其他模块默认收进次级层
- `Board / Rooms / Settings` 不再重复同一份 next-step 摘要，supporting flow 只保留必要入口
- 帮助文案、空态、解释语气都能直接回答“你现在能做什么”

Evidence:

- `apps/web/src/lib/home-first-screen.test.ts`
- `apps/web/src/lib/setup-first-screen.test.ts`
- `apps/web/src/lib/access-first-screen.test.ts`
- `apps/web/src/lib/rooms-first-screen.test.ts`
- `apps/web/src/lib/settings-first-screen.test.ts`

本轮验收结果应满足：

- `/`、`Setup`、`Access` 首屏默认只保留一个主动作，其他模块进次级层
- `DM / Machine / Topic / Thread` 都有可直接进入的入口
- `Board` 规划文案与 issue / room 的继续入口文案统一
- `Board / Rooms / Settings` 的 supporting flow 打开后可直接给出下一步
- 空态、帮助文案、解释语气都落成一句话可执行提示

### P1 Durable memory / provider / recovery

目标：把“可见”继续推进到“可恢复、可压缩、可交接”。

Done when:

- 至少有一组多 session / 多 agent recovery contract 可以稳定重放
- provider degraded fallback、compaction、retention 都有明确 fail-closed 或恢复路径
- 交接后能从同一份 memory truth 恢复当前工作，而不是只看到静态历史

Evidence:

- memory provider / recovery contract tests
- 对应 headed / release 验证报告
- `Checklist` 里相关 memory 项从部分完成推进到已验证

本轮验收结果应满足：

- 已满足：已交付一组可重放的多 session / 多 agent recovery 验证矩阵，证明不同房间与 agent 的 preview owner、room note、provider health 在 handoff + reload 后不会串线
- external provider degraded fallback 有明确触发条件与恢复路径
- memory compaction、retention、后台整理都有可执行验证项

## 本轮刚收口

- 默认 auth baseline 改成 signed-out
- mutation authz 响应改成 fail-closed，不再把完整 state 当 side-channel 返回
- `/v1/notifications/fanout` 改成内部 worker secret 鉴权
- `verify:release:rc` 现在强制 `OPENSHOCK_INTERNAL_WORKER_SECRET`
- `request_password_reset` 现仅允许 active session 发起；signed-out 只允许持 challenge 完成恢复
- `request_login_challenge -> /v1/auth/session` 现在是唯一登录入口，fresh bootstrap owner claim 也已收成同一条 challenge 主链
- `verify_email`、`authorize_device` 现在都要求先请求一次性 challenge，再消费 challenge 完成恢复动作
- release-critical headed suite 已单源化到 `scripts/release-browser-suite.sh`
- `verify:release:rc` 现在也强制 `OPENSHOCK_RUNTIME_HEARTBEAT_SECRET`
- `verify:release:full` 新增 summary report 和 durable logs
- 首页 continue target 已覆盖 inbox / DM / channel / room / journey
- `setup/access` 入口壳已减成更轻的单列首屏
- `setup` 模板管理区已去掉重复的“刷新进度 / 完成首次启动”动作，展开层只保留模板细节与进度说明
- memory provider recover 现在已补“recover -> reload -> healthy truth 持续存在”的 API contract，search sidecar index 与 external relay config 都会被显式复核
- planner queue / assignment / auto-merge 现在要求 request-scoped auth；signed-out 默认 401，不再泄露执行态和 PR state
- memory mode 与 provider health 现在会逐个标记 degraded provider；recover 后若 index / relay 再次损坏，也会在 check / reload 时自动跌回真实 degraded truth
- `topic / memory / credential / agent profile / direct message / message surface` 这批 permission-gated supporting flow mutation response 现在会按当前请求返回 scoped `state.Auth.Session`，并有并发 contract 覆盖 member / owner 不串会话
- memory center 现在已补多 session / 多 agent recovery matrix contract：不同讨论间和不同 agent 的 preview owner、room note、provider health 经 handoff + reload 后独立保持

## 每张执行票最少要写清什么

- `Goal`
- `Scope`
- `Dependencies`
- `Self-Check`
- `Review Gate`
- `Merge Gate`
- `Related Checklist IDs`
- `Related Test Case IDs`

没有这 8 项，不进入 active execution。

## 固定执行顺序

1. 锁定 active batch
2. 实现最小闭环
3. 自测并贴证据
4. reviewer 只报 blocker / no-blocker
5. 回补 blocker
6. 重核
7. `in_review -> done`
8. round-end verify

## 归档说明

- 更早的收口历史、长说明和专题追溯，不再继续堆在这份文档里
- 需要追溯时，回看 `git log`、`Test-Report-*` 和 `Checklist`

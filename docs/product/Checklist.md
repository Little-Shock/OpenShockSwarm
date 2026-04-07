# OpenShock Product Checklist

**版本:** 1.0
**更新日期:** 2026 年 4 月 6 日
**关联文档:** [PRD](./PRD.md) · [Phase 0 MVP](./Phase0-MVP.md) · [Execution Tickets](./Execution-Tickets.md) · [Test Cases](../testing/Test-Cases.md)

---

## 一、使用方式

- `PRD` 定义完整产品应该是什么
- `Checklist` 把 PRD 拆成可跟踪的能力合同与 GAP
- `Test Cases` 把 Checklist 拆成可执行验证
- `Test Report` 记录本轮真实执行结果，不替代长期合同

### 状态定义

- `已完成`: 当前仓库已经有真实实现，且已有基础验证证据
- `部分完成`: 已有主链或界面，但能力不完整、存在已知缺口，或只站住本地基线
- `未完成`: PRD 已定义，但当前仓库还没有站住

---

## 二、当前总览

- 已完成主链:
  - chat-first 壳的主要路由
  - issue -> room -> run -> session -> worktree lane 基线
  - daemon bridge 同步执行
  - 文件级记忆 scaffold 与 API 读取
  - auth/session/member 基础读取面
  - state SSE 初始快照
- 部分完成主链:
  - Setup 初始化链路
  - Agent 一等公民模型
  - Run/PR/Inbox 真相收口
  - Blocked / approval 决策面
  - runtime 注册与 pairing
  - 执行隔离与权限控制
- 主要 GAP:
  - runtime pairing 冷启动一致性缺口
  - GitHub App / webhook / 真实远端 PR 同步
  - 邮箱登录 / 完整成员角色权限
  - 生产级通知与恢复触达
  - 多 runtime 调度器与 failover
  - stop / resume / follow-thread / skill promotion

---

## 三、合同项

### CHK-01 协作壳与信息架构

- PRD 来源: 三、五、六、八
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] `Chat / Board / Inbox / Issues / Rooms / Runs / Agents / Setup / Settings` 已有真实页面
  - [x] OpenShock 已经是 chat-first 壳，而不是单页看板
  - [x] 主要页面可在浏览器走查中打开
- 当前 GAP:
  - [ ] `DM / Machine / Topic` 仍未形成完整的一等入口
  - [ ] Slock 式 presence、暂停/恢复、follow thread 还未产品化
- 对应 Test Cases: `TC-001` `TC-007` `TC-018`

### CHK-02 Agent 一等公民模型

- PRD 来源: 五.1、七、十八.3
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] Agent 列表页和详情页存在
  - [x] Agent 与 run、runtime、workspace 关系可见
- 当前 GAP:
  - [ ] skill 绑定、memory profile、provider/runtime 偏好还未完整产品化
  - [ ] Agent 身份档案和历史沉淀能力不完整
- 对应 Test Cases: `TC-008` `TC-014`

### CHK-03 真相分层与核心对象模型

- PRD 来源: 五.4、七、九、十四
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] `Issue / Room / Run / Session / Inbox / Pull Request / Memory` 均已有对象或 API
  - [x] `Run` 作为执行真相在 detail 页面可见
  - [x] SSE 已能返回初始 `snapshot`
- 当前 GAP:
  - [ ] Issue/Room/Run/PR/Inbox 的跨对象一致性仍需更多回归锁定
  - [ ] 实时事件目前只站住 Phase 0 基线，缺少更完整的事件 contract
- 对应 Test Cases: `TC-009` `TC-011` `TC-012`

### CHK-04 工作流 A: 工作区初始化

- PRD 来源: 十.工作流 A
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] Setup 页展示 repo binding、GitHub readiness、runtime pairing、live bridge
  - [x] Setup 页可展示 effective auth path、GitHub App install state 与 installation URL
  - [x] 手动配对 runtime 后可以成功执行 bridge prompt
- 当前 GAP:
  - [ ] 冷启动时 pairing URL 与当前活跃 daemon 可能漂移，导致桥接失败
  - [ ] repo binding / GitHub readiness 缺少一轮新的浏览器自动化回放证据
- 对应 Test Cases: `TC-001` `TC-002` `TC-003` `TC-004`

### CHK-05 工作流 B: 创建 Issue 并派发给 Agent

- PRD 来源: 十.工作流 B
- 优先级: P0
- 当前状态: 已完成
- 已落地:
  - [x] 创建 issue 可联动生成 room / run / session
  - [x] daemon 会尝试为 lane 创建 worktree
  - [x] room 和 run 页面可承接后续协作
- 当前 GAP:
  - [ ] 多 Agent 自动派发仍未建立
  - [ ] 更完整的 browser 自动化串行创建证据仍需补充
- 对应 Test Cases: `TC-005` `TC-006`

### CHK-06 工作流 C: Topic 执行与 Run 真相

- PRD 来源: 十.工作流 C
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] run detail 能展示 runtime、branch/worktree、执行日志等信息
  - [x] bridge 执行链已能跑通同步 prompt
- 当前 GAP:
  - [ ] Topic 仍主要隐含在 room/run 中，未形成明确产品对象
  - [ ] stop / resume / follow-thread / token-quota 可观测性尚未完成
- 对应 Test Cases: `TC-006` `TC-007` `TC-018`

### CHK-07 工作流 D: PR 与 Review 闭环

- PRD 来源: 十.工作流 D
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] pull request 对象、详情和状态写回接口已存在
  - [x] room / inbox 可承接 review 语义的本地状态
  - [x] server 已支持按 effective auth path 在 `gh CLI / GitHub App` 间切换 PR create / sync / merge
  - [x] GitHub App-backed create / sync / merge 与 review-decision failure path 已有 contract tests
  - [x] signed webhook replay harness 已可通过真实 HTTP 请求回放 review / comment / check / merge，并验证 failure-path observability
  - [x] headed browser harness 已在安全 sandbox base branch 上完成真实远端 PR create / sync / merge 闭环，并验证 no-auth failure path 的 UI / inbox / room blocked 可见性
- 当前 GAP:
  - [ ] GitHub App installation-complete 回跳后的 live webhook / repo 持续同步仍缺少本轮实机验证
- 对应 Test Cases: `TC-010` `TC-015` `TC-016` `TC-022` `TC-025` `TC-026`

### CHK-08 工作流 E: Blocked 与人工纠偏

- PRD 来源: 十.工作流 E
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] Inbox 已能展示 blocked / approval / review 类卡片
  - [x] 未登录与 viewer 权限已验证 401/403 保护
- 当前 GAP:
  - [ ] 本轮没有完整回放 Inbox 决策 mutation
  - [ ] review change-request / merge 仍需避免远端副作用并补充安全测试
- 对应 Test Cases: `TC-010` `TC-012`

### CHK-09 工作流 F: 紧急停止与恢复

- PRD 来源: 十.工作流 F
- 优先级: P1
- 当前状态: 未完成
- 已落地:
  - [ ] 暂无可验收的完整 stop / resume / recover 产品闭环
- 当前 GAP:
  - [ ] 缺少 stop / resume 控制面、UI 入口、状态事件和恢复语义
- 对应 Test Cases: `TC-018`

### CHK-10 工作流 G: 记忆回收、注入与提升

- PRD 来源: 十.工作流 G、十三.4
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] `MEMORY.md`、`notes/`、`decisions/` 与 `.openshock/agents` 已进入写回路径
  - [x] memory 列表与详情接口可读
  - [x] memory artifact 已有 version / governance / detail contract，并有 store/api tests
- 当前 GAP:
  - [ ] 记忆注入策略、整理策略、skill/policy 提升流程未完成
  - [ ] 长期记忆引擎仍停留在设计层
- 对应 Test Cases: `TC-013` `TC-019`

### CHK-11 工作流 H: 邀请、通知与恢复触达

- PRD 来源: 十.工作流 H、十三.5
- 优先级: P1
- 当前状态: 未完成
- 已落地:
  - [x] notifications 基础对象和接口已经出现
- 当前 GAP:
  - [ ] 邀请、邮箱验证、密码重置、Browser Push、邮件通知都未成产品闭环
  - [ ] 高优先级升级和恢复触达机制缺少真实发送链
- 对应 Test Cases: `TC-017`

### CHK-12 工作流 I: 执行隔离与权限控制

- PRD 来源: 十.工作流 I、十三.5
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] worktree 是当前默认隔离单元
  - [x] 本地 CLI 通过 daemon bridge 执行
  - [x] issue 创建类操作具备基本 401/403 权限防护
- 当前 GAP:
  - [ ] destructive action approval、secrets 分层、越界写保护还未系统化产品化
  - [ ] 沙盒能力目前仍主要继承本地环境
- 对应 Test Cases: `TC-012` `TC-020`

### CHK-13 身份、成员、角色与仓库授权

- PRD 来源: 十三.5、十八.8
- 优先级: P1
- 当前状态: 部分完成
- 已落地:
  - [x] auth session 与 workspace members API 可读取
  - [x] `/access` 已消费 live auth session / members / roles truth，并提供 email login / logout 入口
  - [x] auth session persistence 已有 store test 与 browser reload evidence
- 当前 GAP:
  - [ ] invite、成员管理、角色变更和 action-level authz 仍未站住
  - [ ] 设备授权与完整邮箱验证流程仍未产品化
  - [ ] GitHub 仍主要是 readiness probe，不是完整授权模型
- 对应 Test Cases: `TC-014` `TC-016`

### CHK-14 Runtime 注册、心跳与调度

- PRD 来源: 九.3、十三.5
- 优先级: P0/P1
- 当前状态: 部分完成
- 已落地:
  - [x] runtime registry、selection、pairing 接口存在
  - [x] daemon heartbeat 已接入 server 状态
- 当前 GAP:
  - [ ] pairing 冷启动一致性存在缺口
  - [ ] 多 runtime 调度、failover、lease/conflict guard 尚未完成
- 对应 Test Cases: `TC-003` `TC-004` `TC-020`

### CHK-15 成功指标、验收门与观测

- PRD 来源: 十四、十五、十七
- 优先级: P0
- 当前状态: 部分完成
- 已落地:
  - [x] `pnpm verify:release` 与 `pnpm ops:smoke` 提供基础回归门
  - [x] 浏览器走查、API 检查、SSE 验证已经有一轮实际结果
  - [x] 2026 年 4 月 7 日针对 GitHub App effective auth path 和 memory contract 的 go tests / release verify 已通过
- 当前 GAP:
  - [ ] `ops:smoke` 对 runtime pairing 存在 false-green
  - [ ] 产品指标、体验指标、设计指标尚未形成持续观测
- 对应 Test Cases: `TC-011` `TC-021`

---

## 四、近期收口顺序

1. 先修 `CHK-04/CHK-14` 的 runtime pairing 冷启动一致性。
2. 再把 `CHK-15` 的 smoke gate 补到能识别 pairing 漂移。
3. 然后按 `CHK-07/CHK-13/CHK-11` 推进 GitHub 授权、成员权限、通知链。
4. 最后再做 `CHK-09/CHK-10` 这类 stop/resume、skill promotion、长期记忆增强。

---

## 五、拆票映射

- `CHK-04` `CHK-14` `CHK-15` -> `TKT-01` `TKT-02` `TKT-03`
- `CHK-07` -> `TKT-04` `TKT-05` `TKT-06`
- `CHK-13` `CHK-12` -> `TKT-07` `TKT-08` `TKT-09`
- `CHK-08` `CHK-11` -> `TKT-10` `TKT-11`
- `CHK-10` -> `TKT-12`
- `CHK-09` -> `TKT-13`
- `CHK-14` -> `TKT-14`
- `CHK-12` -> `TKT-15`

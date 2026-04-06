# OpenShock Test Report

**报告日期:** 2026 年 4 月 6 日
**基线分支:** `main`
**基线提交:** `a61ce45`
**工作区:** `/tmp/openshock-main-audit`
**关联文档:** [Test Cases](./Test-Cases.md) · [Product Checklist](../product/Checklist.md)

---

## 一、执行环境

- Web: `http://127.0.0.1:13000`
- Server: `http://127.0.0.1:18080`
- Daemon: `http://127.0.0.1:18090`
- 浏览器: headed Chromium on `DISPLAY=:0`
- 证据:
  - 浏览器走查截图目录: `/tmp/openshock-main-audit-shots`
  - 启动会话:
    - daemon session `18542`
    - server session `35690`
    - web session `70839`

---

## 二、总览

- 已执行并通过: `10`
- 已执行但失败: `2`
- 未执行或被能力 GAP 阻塞: 见 [Test Cases](./Test-Cases.md) 中 `Not Run / Blocked` 项

本轮结论：

- Phase 0 主链已经可跑通，包括主要路由、Issue lane、Run detail、SSE、基础 authz guard、memory 读取面。
- 当前最严重的线上级缺口不是“页面打不开”，而是 `runtime pairing` 的冷启动一致性。
- `ops:smoke` 当前对这个缺口给出假绿，需要修 gate。

---

## 三、详细结果

## TC-001 Setup 壳层可见性

- 业务目标: 验证 Setup 是否已经成为初始化主控台。
- 当前执行状态: Pass
- 前置条件: web、server、daemon 已启动。
- 测试步骤:
  1. 打开 `/setup`。
  2. 观察 repo、GitHub、runtime、bridge 四个区块。
- 预期结果: 四条主链集中出现在 Setup。
- 实际结果: 页面可打开，四个初始化区块均可见。
- 业务结论: Setup 已具备主控台定位。

## TC-003 Runtime Pairing 手动配对成功

- 业务目标: 验证手动修正 pairing 后是否能继续执行桥接。
- 当前执行状态: Pass
- 前置条件: daemon 在 `http://127.0.0.1:18090` 在线。
- 测试步骤:
  1. 调用 `POST /v1/runtime/pairing`，写入 `http://127.0.0.1:18090`。
  2. 再调用 `POST /v1/exec`。
- 预期结果: pairing 更新成功，bridge 恢复可用。
- 实际结果: pairing 修正后，`POST /v1/exec` 返回 `"OpenShock bridge online."`
- 业务结论: 手动修正路径有效。

## TC-004 Runtime Pairing 冷启动一致性

- 业务目标: 验证冷启动时 pairing 是否与真实 daemon 一致。
- 当前执行状态: Fail
- 前置条件: server/daemon 以 `18080/18090` 启动，工作区已有 pairing 历史。
- 测试步骤:
  1. 读取 `GET /v1/runtime/pairing`。
  2. 直接调用 `POST /v1/exec`。
- 预期结果: pairing URL 指向 `18090`，bridge 首次成功。
- 实际结果: pairing 返回 `http://127.0.0.1:8090`；`POST /v1/exec` 首次返回 `502`，报错为连接 `127.0.0.1:8090` 失败。
- 业务结论: Setup 冷启动主链不合格，必须修复。

## TC-005 创建 Issue 生成执行 lane

- 业务目标: 验证 issue 创建后是否自动进入执行链。
- 当前执行状态: Pass
- 前置条件: server、daemon 在线。
- 测试步骤:
  1. 触发 issue 创建。
  2. 检查 room、run、session、worktree lane。
- 预期结果: issue 自动生成后续对象并创建 lane。
- 实际结果: 主链已可生成 issue -> room -> run -> session，并触发 lane ensure。
- 业务结论: Phase 0 执行主链成立。

## TC-006 Room / Run 详情可见性

- 业务目标: 验证执行真相是否可读。
- 当前执行状态: Pass
- 前置条件: 存在至少一条运行记录。
- 测试步骤:
  1. 打开 `/rooms/room-runtime` 与 `/runs/run_runtime_01`。
  2. 检查 run 详情字段。
- 预期结果: runtime、worktree、timeline、日志等信息可见。
- 实际结果: room 与 run detail 路由均可打开，执行上下文字段可见。
- 业务结论: Run 真相前台可见。

## TC-007 全路由浏览器走查

- 业务目标: 验证主要壳层路由的可用性。
- 当前执行状态: Pass
- 前置条件: web 已启动。
- 测试步骤:
  1. 依次访问首页、Setup、Chat、Board、Inbox、Issues、Rooms、Runs、Agents、Access、Memory、Settings。
  2. 抽查 issue、room、run、agent 详情页。
- 预期结果: 主要路由均可渲染。
- 实际结果: 已成功走查 `/`、`/setup`、`/chat/all`、`/board`、`/inbox`、`/issues`、`/issues/OPS-12`、`/rooms`、`/rooms/room-runtime`、`/rooms/room-runtime/runs/run_runtime_01`、`/runs`、`/runs/run_runtime_01`、`/agents`、`/agents/agent-codex-dockmaster`、`/access`、`/memory`、`/settings`。
- 业务结论: chat-first 壳主路由可用。

## TC-008 Agent 列表与详情

- 业务目标: 验证 Agent 是否已进入可视化产品模型。
- 当前执行状态: Pass
- 前置条件: 预置 agent 数据存在。
- 测试步骤:
  1. 打开 `/agents`。
  2. 打开 `/agents/agent-codex-dockmaster`。
- 预期结果: Agent 及其上下文信息可见。
- 实际结果: 列表页与详情页均可正常展示。
- 业务结论: Agent 视图已经成立。

## TC-009 SSE 初始快照

- 业务目标: 验证最小实时 contract。
- 当前执行状态: Pass
- 前置条件: server 在线。
- 测试步骤:
  1. 请求 `GET /v1/state/stream`。
- 预期结果: 返回 `event: snapshot`。
- 实际结果: 已收到首个 `snapshot` 事件。
- 业务结论: 最小实时链存在。

## TC-011 未登录/低权限写入保护

- 业务目标: 验证关键写接口的 authz guard。
- 当前执行状态: Pass
- 前置条件: 准备未登录和 viewer 身份。
- 测试步骤:
  1. 以未登录身份 `POST /v1/issues`。
  2. 以 viewer 身份重复调用。
  3. 检查 issue 数量。
- 预期结果: 返回 `401/403`，且数据不变。
- 实际结果: 两种身份分别得到 `401` 与 `403`，issue 数量未变化。
- 业务结论: 基础权限保护有效。

## TC-012 Access / Session / Members 基础读取

- 业务目标: 验证身份与成员基线数据面。
- 当前执行状态: Pass
- 前置条件: server 在线。
- 测试步骤:
  1. 访问 `/access`。
  2. 请求 `/v1/auth/session` 与 `/v1/workspace/members`。
- 预期结果: 页面与 API 都能返回基线数据。
- 实际结果: 页面与相关接口均可访问。
- 业务结论: 读取面成立，但并不代表完整身份系统已完成。

## TC-013 Memory 列表与详情

- 业务目标: 验证文件级记忆可读。
- 当前执行状态: Pass
- 前置条件: 工作区存在记忆数据。
- 测试步骤:
  1. 访问 `/memory`。
  2. 请求 `/v1/memory` 与 `/v1/memory/:id`。
- 预期结果: 可以读取 memory 列表和详情。
- 实际结果: 页面与 API 均返回可读数据。
- 业务结论: 文件级记忆读取面成立。

## TC-021 Release Gate 对 pairing 漂移的拦截

- 业务目标: 验证 smoke gate 是否能拦住 Setup 主链失败。
- 当前执行状态: Fail
- 前置条件: 真实 daemon 不在默认 `8090`。
- 测试步骤:
  1. 运行 `pnpm ops:smoke`。
  2. 对比其结果与真实 pairing / bridge 行为。
- 预期结果: smoke 应因 pairing 漂移失败。
- 实际结果: `pnpm ops:smoke` 通过，但只检查 `pairingStatus` 字段存在，未校验 daemon URL 真值。
- 业务结论: 当前 release gate 存在假绿，不能单独作为 Setup 主链放行依据。

---

## 四、未在本轮执行的重点项

- `TC-002` Repo Binding 重新绑定当前仓库
- `TC-010` Inbox 安全 decision mutation 回放
- `TC-014` 到 `TC-020` 对应的 GitHub App、远端 PR、通知、身份系统、多 runtime 调度、stop/resume、skill promotion

这些项要么本轮未重放，要么当前仓库尚无完整闭环，已经在 [Product Checklist](../product/Checklist.md) 中标记为 GAP。

---

## 五、当前最重要的 GAP

1. `runtime pairing` 冷启动一致性必须先修，否则 Setup 主链首跳就可能失败。
2. `ops:smoke` 需要从“字段存在”升级为“pairing URL 与真实 bridge 一致”。
3. 文档口径必须继续坚持:
   - GitHub App / webhook / 真实远端 PR sync 还不能写成已完成
   - 完整成员权限 / 邮件通知 / 多 runtime scheduler 也不能提前宣称完成

# Research

OpenShock 的对标研究、可复用模式和本地参考痕迹统一放在这里。

这部分文档不是链接收藏夹，而是后续产品和实现必须反复回看的参考总索引。

## Current Stack

- [Reference Stack](./Reference-Stack.md)
- [Local Slock Notes](./Slock-Local-Notes.md)
- [Upstream Branch Harvest 2026-04-10](./Upstream-Branch-Harvest-2026-04-10.md)

## External References

- `Multica`
  - GitHub: [multica-ai/multica](https://github.com/multica-ai/multica)
  - 中文 README: [README.zh-CN](https://github.com/multica-ai/multica/blob/main/README.zh-CN.md)
  - 本地 clone: `E:\00.Lark_Projects\00_OpenShock\__external_multica`
- `Slock`
  - App: [app.slock.ai](https://app.slock.ai/)
  - 当前公开前端 bundle / CSS 会随部署滚动，按首页引用的 `assets/index-*.js` 与 `assets/index-*.css` 抽样分析
- `Lody`
  - [Docs](https://lody.ai/docs.html)
  - [Workflow](https://lody.ai/docs/workflow.html)
  - [WorkTrees](https://lody.ai/docs/worktrees.html)
  - [Usage and Quota](https://lody.ai/docs/usage-and-quota.html)

## Local-Only References

这些材料不直接提交原始副本进仓库，但允许作为产品和实现参考：

- `slock` 会话日志
  - `\\wsl.localhost\Ubuntu-24.04\home\lark\.codex\sessions\2026\04\04`
- `slock` agent 工作目录
  - `\\wsl.localhost\Ubuntu-24.04\home\lark\.slock\agents`

## How To Use

- 做前端时，先看 `Slock` 的壳，再看 Stitch 设计稿，最后再看这里整理出来的落地规则。
- 做后端控制面时，优先参考 `Multica` 的实体、daemon、runtime、inbox、session continuity。
- 做执行隔离时，优先参考 `Lody` 的 topic/worktree/branch/PR 对齐方式。
- 做记忆和 agent 规则时，优先参考本地 `slock` 的 `MEMORY.md + notes/*` 结构。
- 做 API/read-model、shell adapter truth boundary、runtime replay hardening 时，先看 `Upstream Branch Harvest 2026-04-10` 里的内部平行分支知识回收。

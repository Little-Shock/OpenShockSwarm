# 2026-04-09 CJK Font Recovery Report

- Command: `pnpm test:headed-cjk-font-recovery -- --report docs/testing/Test-Report-2026-04-09-cjk-font-recovery.md`
- Artifacts Dir: `/tmp/openshock-tkt63-artifacts-7`

## Result

- PASS: body, mono label, and display heading all include the bundled `Noto Sans SC` runtime family.
- Adversarial probe: fail immediately if any Chinese surface falls back to a system-only chain without the bundled CJK family.

## Evidence

- Runtime `--font-cjk-sans`: `"Noto Sans SC", PingFang SC, Hiragino Sans GB, Microsoft YaHei, WenQuanYi Micro Hei, sans-serif`
- Loaded CJK font faces: `76 / 404`
- Body family: `Inter, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`
- Mono family (`工作区在线状态`): `"IBM Plex Mono", "Sarasa Mono SC", "Microsoft YaHei UI", "Noto Sans Mono CJK SC", monospace, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif, "JetBrains Mono", "Sarasa Mono SC", "Microsoft YaHei UI", monospace`
- Display family (`Setup 现在直接镜像同一条首次启动路径`): `"Space Grotesk", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`

## Screenshots

- setup-cjk: `../openshock-tkt63-artifacts-7/screenshots/01-setup-cjk.png`

VERDICT: PASS

# 进程快照

> 格式：倒序，最新在最上；新条目插到本说明块紧下方。每条 ≤5 行：日期 ｜ 批次 ｜ 主题，加 2–3 条要点（完成/文件/设计变更/下一步）。
> 会话结束协议追加，跨会话续接的唯一进度源。条数 >25 时，第 26 条及更早的整段剪切至 `process-archive.md` 顶部。

## 2026-11-26 ｜ 初始化 ｜ 版本控制落地（git init）
- 建仓：`git init -b main`（无远端）；新增 `.gitignore`（忽略 `node_modules/`、`*.log`、`package-lock.json`、本机残留）与 `.gitattributes`（统一 LF，避免 Windows 检出噪声）
- 同步：`docs/agent/project.md`（分支/红线）、`docs/CODING.md`（§2 命令表 + §3 分支与提交 + 红线3）改为「已建仓，提交仍需确认」
- 提交：首个提交 `chore: 初始化仓库与项目文档基线`（16 文件，基线可回滚）→ 下一步开工计划 01 任务 A

## 2026-11-26 ｜ 初始化 ｜ 项目开发结构落地
- 生成：`AGENTS.md` 指针、`docs/agent/project.md`、`docs/CODING.md`、`docs/memory/`、`docs/reference/{product-brief,architecture,overview,v1-deepseek-spec,ai-webapps-feasibility,ai-webapps-review}.md`、`docs/plans/{README,00,01}`
- 事实：纯 JS 无构建 client bundle；命令见 `docs/CODING.md`；无 git；红线=不改 DSH 本体 / 不写明文凭据
- 设计：V1 只做 DeepSeek；主面板 webview + `shell.overlay` 单例宿主（永不 reparent）；登录态用 localStorage/cookie 快照（每 lease 回填一次、失败标 stale）
- 下一步：按 `docs/plans/01-M0-DeepSeek面板.md` 生成 bundle 并跑 M0 六项验收

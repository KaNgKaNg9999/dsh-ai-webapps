# 进程快照

> 格式：倒序，最新在最上；新条目插到本说明块紧下方。每条 ≤5 行：日期 ｜ 批次 ｜ 主题，加 2–3 条要点（完成/文件/设计变更/下一步）。
> 会话结束协议追加，跨会话续接的唯一进度源。条数 >25 时，第 26 条及更早的整段剪切至 `process-archive.md` 顶部。

## 2026-11-26 ｜ 计划01 ｜ M0-B 完成（真机打通）
- 回填：spec §2.A/§4/R1/R14 + architecture 记录桥契约、overlay 内联 pointer-events、`dom-ready` 只发一次目标导航
- 实现：`client.js` 742 行——`shell.overlay` 宿主、占位几何跟随、acquire→attach→loadURL、`[aiwa][guest]` console 转发、崩溃重建（3 次上限）、`[inert]` 隐藏、卸载释放 lease
- 真机：`acquire→attach(about:blank#lease)→dom-ready→loadURL→302 /sign_in→ready`，无闪烁；修复 `protocolVersion` 层级（在 `dshDesktop` 上）与 `dom-ready` 重入自中断循环
- 取证方式：临时诊断写 localStorage + 读 LevelDB（含 UTF-16 值）；诊断已移除；V 部分回填（1/2 通过）；下一步 D 登录快照

## 2026-11-26 ｜ 收尾 ｜ M0-A/C 完成，暂停在 B 前
- 验证：用户确认左栏 DeepSeek 行可见（C 真机通过）；主面板工具栏、插件页图标、页面 console 的 `[aiwa]` 日志未逐项核对
- 状态：A/C 完成；F 安装 applied（`include:ai-webapps` active）；B/D/E/V 未做；计划 01 仍 🟡；最近提交 `cf437f9`
- 下次开工顺序：B（`shell.overlay` 单例 + 占位几何跟随 + acquire/attach/loadURL + `render-process-gone` 重建 + `[inert]` blur/隐藏 + 卸载清理），随后 D 快照、E 设置页、V 六项验收

## 2026-11-26 ｜ 计划01 ｜ M0-C 左栏入口与主面板
- 新增：`client.js` 246 行——`sidebar.panellist`（`ai-webapps:deepseek`，order 50，`label: () => t('panel')`）、`main` keyed 面板（工具栏四项 + 占位区 + 桥状态行）、`ctx.locale.register` zh/en、启动 `selectPanel(null)` 兜底（T13）
- 取舍：`[inert]` blur/隐藏移到 B（C 阶段没有 guest）；刷新/系统浏览器动作留 `controller.onRefresh/onOpenExternal` 钩子给 B 覆盖
- 校验：`node --check` 通过；未提交；**未真机验**（需刷新页面后看左栏 DeepSeek 行与主面板占位区）

## 2026-11-26 ｜ 计划01 ｜ M0-A bundle 骨架
- 新增：`package.json`（`dsh.bundle.patch` + `dsh.client{platform:web,immediately,inject:[locale,ui-layout,ui-sidebar]}` + exports/files）、`cordis.patch.yml`（insert `ai-webapps`）、`index.js`（Host 空壳）、`client.js`（仅 `[aiwa]` 桥探测）、`locale/{zh,en}.json`、`icon.svg`（#4D6BFE 圆角底 + 白鲸）
- 校验：`node --check client.js/index.js` 通过；package/locale JSON 与 icon SVG 可解析；exports 与 files 路径全部存在；未安装、未提交
- 契约核对：`sidebar.panellist`（root list，owner {size,active,only}）、`main` keyed slot + `ctx.layout.selectPanel(null)`、`shell.overlay` 覆盖整帧、`settings.section` 由 dsh-client-ui-settings 声明
- 下一步：刷新 DSH 页面确认 `[aiwa] bridge=present protocol=1` 与插件页行/图标；随后开工 C（左栏行 + 主面板工具栏）

## 2026-11-26 ｜ 初始化 ｜ 版本控制落地（git init）
- 建仓：`git init -b main`（无远端）；新增 `.gitignore`（忽略 `node_modules/`、`*.log`、`package-lock.json`、本机残留）与 `.gitattributes`（统一 LF，避免 Windows 检出噪声）
- 同步：`docs/agent/project.md`（分支/红线）、`docs/CODING.md`（§2 命令表 + §3 分支与提交 + 红线3）改为「已建仓，提交仍需确认」
- 提交：首个提交 `chore: 初始化仓库与项目文档基线`（16 文件，基线可回滚）→ 下一步开工计划 01 任务 A

## 2026-11-26 ｜ 初始化 ｜ 项目开发结构落地
- 生成：`AGENTS.md` 指针、`docs/agent/project.md`、`docs/CODING.md`、`docs/memory/`、`docs/reference/{product-brief,architecture,overview,v1-deepseek-spec,ai-webapps-feasibility,ai-webapps-review}.md`、`docs/plans/{README,00,01}`
- 事实：纯 JS 无构建 client bundle；命令见 `docs/CODING.md`；无 git；红线=不改 DSH 本体 / 不写明文凭据
- 设计：V1 只做 DeepSeek；主面板 webview + `shell.overlay` 单例宿主（永不 reparent）；登录态用 localStorage/cookie 快照（每 lease 回填一次、失败标 stale）
- 下一步：按 `docs/plans/01-M0-DeepSeek面板.md` 生成 bundle 并跑 M0 六项验收

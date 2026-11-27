> 本文件是项目级 Agent 身份与协议的唯一事实源；宿主 skill 只是入口。

# dsh-ai-webapps — 开发身份与流程

## 身份

- 是什么：DSH Desktop 插件——把网页版 AI 聊天（V1 只做 DeepSeek）内嵌到主面板，切面板不重载，登录一次后同机重启保持登录。
- 不是什么：不是通用浏览器；不是 API/模型接入替代方案；不改 DSH 应用本体；V1 不做多站与登录态跨机迁移。
- 技术栈：纯 JS（无构建）DSH client bundle；React 由宿主 `window.__ModuleLoader__` 提供；无第三方依赖；依赖 DSH `0.2.2-rc.5` 的 Slot 契约与 `globalThis.dshDesktop.browser` 桥（`protocolVersion: 1`）。
- 关键目录：`client.js`（Client 半区全部实现）｜`index.js`（Host 空壳）｜`cordis.patch.yml`（bundle 行）｜`locale/`｜`docs/`。
- 命令：`install_bundle`（本地目录，或 `git+https://github.com/KaNgKaNg9999/dsh-ai-webapps.git#<40 位 commit>`，见 README）/ 无 / `node --test`（41 条断言，零依赖）／ M0/M1 真机验收 ／ 真机自动化取证（`node tools/cdp-eval.mjs list|eval|listen|net|watch|crash`，**需带 `--remote-debugging-port=9222` 启动 DSH**，见 `docs/CODING.md` §2.1）/ 无 / `node --check client.js`
- 分支/发布：主分支 `main`；远端 `github.com/KaNgKaNg9999/dsh-ai-webapps`（2026-11-27 建立）；`v1.0.0`（tag 指向 `722fbe5`）已发布；交付=GitHub pin 完整 commit 直装，本地目录仅开发用，V1 不发 npm（D2 决策）。
- 文档语言：中文。
- 红线：不改 DSH 应用本体；不写入明文凭据。

## 文档地图

- 产品简报：`docs/reference/product-brief.md`
- 架构：`docs/reference/architecture.md`
- 设计索引：`docs/reference/overview.md`
- V1 设计事实源：`docs/reference/v1-deepseek-spec.md`
- 编码规范：`docs/CODING.md`
- 功能计划：`docs/plans/`
- 项目记忆：`docs/memory/process.md`（存档 `docs/memory/process-archive.md`）

## 一、会话启动（Resume）

新会话开始，按顺序读，不要等用户提醒：

1. `docs/memory/process.md` — 只读头部（读取时带 `limit: 40`）；历史走 offset / grep / archive
2. `docs/plans/` — 找有未勾选任务的计划
3. 按任务读 `docs/reference/` 对应文档（V1 实现前先读 `v1-deepseek-spec.md`）

汇报格式（固定）：

```
📍 项目位置：<当前批次/任务>
📍 上次快照：<process.md 最新一条一句话>
📍 当前计划：<进行中计划与下一个 [ ]>
👉 下一步建议：<具体动作>
```

## 二、开发中（Working）

- **计划先行**：与用户沟通好后，先写 `docs/plans/NN-主题.md`（目标/清单/验收），确认后再动代码
- **真机自动化验收前，先请用户重启**：需要「宿主渲染进程执行 JS / 读宿主 console」时，打包版 DSH 的开发者工具打不开，只能靠调试端口。**先告诉用户**执行下面这条命令重启 DSH，等用户重开会话再继续；**不要自己重启**（agent 就在该进程里，重启会中断会话）。屏幕点击/截图用 `dsh-pilot`，宿主 JS 用 `node tools/cdp-eval.mjs`，细则见 `docs/CODING.md` §2.1。
  ```powershell
  & "D:\software\DeepSeek Harness\DeepSeek Harness.exe" --remote-debugging-port=9222
  ```
- **就绪才开计划**：目标/范围/验收不齐时，先落发现计划（类型：发现），不写实施计划
- **设计先行**：新模块先建 `docs/reference/<主题>.md` 骨架，再开发；偏离设计先改 reference
- **小步可验证**：每步有可检验的结果；计划外变更如实记录
- **命令与红线**：以 `docs/CODING.md` 为准

## 三、收尾（Handoff）

1. 勾选 `docs/plans/` 完成项；完成的计划标 ✅ 与日期
2. `docs/memory/process.md` 说明块下追加快照（≤5 行，倒序最新在上）；统计 `^## 20` 条数，超过 25 条 → 第 26 条及更早整段剪切到 `docs/memory/process-archive.md` 顶部
3. 设计结论沉淀到 `docs/reference/`；规则/命令变化同步 `docs/CODING.md` 和 `AGENTS.md` 标记块
4. 提醒用户「记忆已更新，是否 commit？」（不自动执行）

## 四、红线

1. **不改 DSH 应用本体**：不修改 `app.asar`、DSH 安装目录、profile 的 `package.json` / `cordis.patch.yml`（安装与行开关交给插件管理器 `install_bundle` / 插件页面）。只用公开 Slot 契约与 `globalThis.dshDesktop.browser` 桥；桥不可用或协议版本不符时降级提示，不绕过。
2. **不写入明文凭据**：用户 token / cookie 只存在于本机运行时快照（`dsh-ai-webapps.snapshot.v1`，位于 DSH 页面 localStorage），不进仓库、不进日志、不进文档、不进测试夹具；排障只打印键名与状态，不打印值。
3. git 写操作（commit / push / tag）先询问；仓库 2026-11-26 初始化（`main`），2026-11-27 建立 GitHub 远端 `origin` 并发布 `v1.0.0`，提交格式见 `docs/CODING.md` §3。

## 五、批次索引

见 `docs/plans/README.md`。

<!-- project-init:begin -->
## 本工作区：dsh-ai-webapps

你是本工作区的开发 Agent（dsh-ai-webapps）。开发、修改或续接前，先读 `docs/agent/project.md`，按其中的 Resume / Working / Handoff 协议执行。若当前宿主支持项目级 skill，可加载 `dsh-ai-webapps-dev`；入口由宿主提供，内容以 `docs/agent/project.md` 为准。

- 定位：DSH Desktop 插件——把网页版 AI 聊天（V1 只做 DeepSeek）内嵌到主面板，切面板不重载，登录一次后同机重启保持登录
- 技术栈：纯 JS（无构建）DSH client bundle；React 由宿主 `window.__ModuleLoader__` 提供；依赖公开 Slot 契约与 `dshDesktop.browser` 桥
- 文档：设计 `docs/reference/` ｜ 规范 `docs/CODING.md` ｜ 计划 `docs/plans/` ｜ 记忆 `docs/memory/`
- 红线：不改 DSH 应用本体（`app.asar`/安装目录/profile 文件）；不写入明文凭据（token 不进仓库/日志/文档）
<!-- project-init:end -->

# dsh-ai-webapps — DeepSeek 网页面板

在 DSH 桌面端里直接和网页版 DeepSeek 聊天（单站）：不用再来回切浏览器，满宽主面板，切到会话再切回来不重载，同一台机器登录一次后重启自动恢复。排障不用开发者工具（设置页有「诊断」卡）。

## 安装

- **本地目录**：插件管理器 **Add plugin** 选本目录，或 `plugin_manager` 的 `install_bundle` 指向绝对路径。
- **GitHub 仓库**（无需发 npm）：
  - 插件页 **Add plugin** 填 `git+https://github.com/<owner>/dsh-ai-webapps.git#<40 位 commit>`
  - 或 `plugin_manager install_bundle` 传同一 spec
  - 固定完整 commit 才支持插件页的 git 更新；装 branch/tag 只能卸载重装
- 前置：DSH 桌面端 0.2.2-rc.5（本版验证版本）；pnpm 由桌面端提供，GitHub 安装另需本机 `git`。

## 使用

1. 左栏 **DeepSeek** 行 → 主面板；首次在面板内登录。
2. 工具栏：刷新 / 在系统浏览器打开 / 复制链接 / 清除登录。
3. **设置 → DeepSeek 网页**：面板位置、站点地址、登录快照、桌面桥、诊断、已知限制。
4. 排障：**设置 → DeepSeek 网页 → 诊断**，看最近 100 条日志（已脱敏）并可复制。

## 限制

- 仅 DSH 桌面端；每台机器各自登录一次（站点有设备校验）。
- 下载、麦克风/摄像头、通知、剪贴板读取不可用；站点弹窗改在系统浏览器打开。
- 快照以明文存于本机 DSH 页面 localStorage，可在设置页清除。
- 依赖 DSH 内部接口（桌面桥 `protocolVersion: 1`、Slot 契约），DSH 升级后可能需跟随适配。
- **只做 DeepSeek 单站**（2026-11-27 决定）：多站内嵌与「非 DeepSeek 站跨重启免登录」已试做并放弃——千问 / Gemini 的登录票据在 HttpOnly cookie，插件内不可读写；记录见 [`docs/plans/05-多站点尝试与放弃.md`](docs/plans/05-多站点尝试与放弃.md)。

## 开发

- 纯 JS 无构建；profile 开 HMR 时改 `client.js` 会自动重载 Client 半区。
- 门禁：`node --check client.js`、`node --check index.js`、`node --test`。
- 真机取证需要 `--remote-debugging-port=9222` 启动 DSH，工具见 `tools/cdp-eval.mjs`（`list/eval/listen/net/watch/crash`）。
- 文档：`docs/plugin/DETAIL.md`（插件详情页）、`docs/reference/`（设计与事实源）、`docs/plans/`（批次计划）。

## 版本

见 [CHANGELOG.md](CHANGELOG.md)。卸载：插件页移除即可，残留仅 localStorage 两个键（站点表与登录快照），可在设置页清除。

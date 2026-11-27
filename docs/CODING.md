# CODING — dsh-ai-webapps 编码基线

> 命令与规范的单一事实源；项目 skill 与 README 只引用本文件。

## 1. 红线

1. **不改 DSH 应用本体**：不修改 `app.asar`、DSH 安装目录、profile 的 `package.json` / `cordis.patch.yml`。只通过插件管理器安装/卸载，只用公开 Slot 契约与 `globalThis.dshDesktop.browser` 桥（`protocolVersion: 1`）。
2. **不写入明文凭据**：token / cookie 只存运行时快照；日志与文档只允许打印键名、状态与时间。
3. git 写操作先询问（仓库已建，`commit` / `push` / `tag` 均需用户确认）。

## 2. 命令

| 用途 | 命令 |
|---|---|
| 安装 | 通过 DSH 插件管理器 `install_bundle` 安装本目录（或 Plugins → Add plugin 选本地目录） |
| 开发 | 无（纯 JS，无构建；改 `client.js` 后需重启 DSH 或刷新页面生效） |
| 测试 | M0 六项手工验收（见 `docs/plans/01-M0-DeepSeek面板.md`）；真机自动化取证见 §2.1（**需带 `--remote-debugging-port=9222` 启动**）；后续可加 `node --test` |
| 构建 | 无（package 不含构建步骤） |
| 静态检查 | `node --check client.js` 与 `node --check index.js` |
| 真机取证 | `node tools/cdp-eval.mjs list｜eval "<表达式>"｜listen <秒> ["<触发>"]` —— 通过 CDP 在宿主渲染进程执行 JS、抓 console。前置条件与规则见 §2.1 |
| 版本控制 | `git status` / `git log --oneline`（提交前先确认，见 §3） |

### 2.1 真机自动化取证（需要宿主 JS 或 console 时）

打包版 DSH 的「应用 → 开发者工具」**可点但不会打开任何窗口**（`Ctrl+Shift+I` 同样无反应），宿主渲染进程没有别的观测入口。凡是要在**宿主渲染进程执行 JS** 或**读宿主 console** 的验收，都必须带调试端口启动 DSH。

前置：托盘彻底退出 DSH，然后用下面的命令启动（路径按本机实际安装位置）。

```powershell
& "D:\software\DeepSeek Harness\DeepSeek Harness.exe" --remote-debugging-port=9222
```

确认连上：

```powershell
node tools/cdp-eval.mjs list    # 应列出 type=page、url=dsh-app://app/
node tools/cdp-eval.mjs eval "1+1"
```

**规则（重要）**

1. ⚠️ **不要自己重启 DSH**：agent 本身跑在 DSH 进程里，重启会中断用户会话。必须先**告诉用户这条命令**，由用户执行；用户重启后重新打开会话再继续。
2. 调试端口只对本次启动有效，不带参数正常启动即关闭。无后续取证需求时，建议下次正常启动。
3. 调试端口等于让本机任意进程可以驱动渲染进程，**属临时手段**，只用于验收取证，不要常开在长期实例上。
4. 分工：**屏幕点击/截图**用 `dsh-pilot`；**宿主 JS 与 console** 用 `tools/cdp-eval.mjs`。两者常配合使用（例如用 CDP 触发、用截图看结果）。

## 3. 分支与提交

- 分支：`main`（2026-11-26 `git init`）
- 远端：无（不自动 push，需要时单独确认）
- 发布：本地目录安装；后续可发布 npm 包（需先补 `files` 校验）
- 提交：`<type>: <summary>`（type ∈ feat/fix/docs/refactor/chore），一次提交一个可验收变更

## 4. 代码风格与结构

- `client.js` 用宿主的模块加载格式：`window.__ModuleLoader__.load({ id: '<包名>', factory(require) { … } })`；`id` 必须等于包名 `dsh-ai-webapps`。
- 只 `require('react')`；**禁止** `require` 任何 `@deepseek-ai/*` Client 包（宿主内部实现会变），布局与样式自行实现。
- 不复制宿主 CSS Module 类名；颜色/间距用主题 token（`--dsw-alias-*`），容器与控件跟随宿主主题。
- 所有注册（slot / listener / timer / lease / DOM 容器）必须成对释放，统一放在 `ctx.effect` 或 `apply` 内的清理函数里；插件重载不得留下孤儿 guest。
- 文本走 `ctx.locale`（先 `zh` + `en` 两份字典），不把中文硬编码进组件；面板 id 用 `ai-webapps:<siteId>`，存储键用 `dsh-ai-webapps.<name>.v1`。
- 日志统一前缀 `[aiwa]`；只打键名/状态/错误码，不打 token、cookie 值。
- 单文件优先：V1 全部实现放在 `client.js` 内（约 900–1600 行，当前 ~1480），模块化拆分等出现第二个站点再做。

## 5. 测试与门禁

- 提交/交付前：`node --check client.js`、`node --check index.js`；`npm pkg`/JSON 可解析（`node -e "JSON.parse(...)"`）。
- M0 六项验收必须真机跑通并记录在 `docs/plans/01`；未跑通不标完成。
- 不修改 profile 文件；安装失败先重启 DSH 再重试。

## 6. 秘密与数据

- 令牌/密码/连接串不落盘、不进日志、不进测试快照。
- 运行时快照（`dsh-ai-webapps.snapshot.v1`）是用户数据的唯一落点，只在本机 localStorage；设置页提供清除入口。

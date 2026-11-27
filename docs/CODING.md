# CODING — dsh-ai-webapps 编码基线

> 命令与规范的单一事实源；项目 skill 与 README 只引用本文件。

## 1. 红线

1. **不改 DSH 应用本体**：不修改 `app.asar`、DSH 安装目录、profile 的 `package.json` / `cordis.patch.yml`。只通过插件管理器安装/卸载，只用公开 Slot 契约与 `globalThis.dshDesktop.browser` 桥（`protocolVersion: 1`）。
2. **不写入明文凭据**：token / cookie 只存运行时快照；日志与文档只允许打印键名、状态与时间。
3. git 写操作先询问（仓库已建，`commit` / `push` / `tag` 均需用户确认）。

## 2. 命令

| 用途 | 命令 |
|---|---|
| 安装 | 开发期：`install_bundle` 指向本目录（或 Add plugin 选本地目录）；交付：`git+https://github.com/KaNgKaNg9999/dsh-ai-webapps.git#<40 位 commit>`（见 README） |
| 开发 | 无构建；profile 开 HMR 时改 `client.js` 会自动重载 Client 半区（插件实例重建、guest 重新加载，2026-11-27 实测）；改 Host 半区/清单或 HMR 未生效时重启 DSH 或刷新页面 |
| 测试 | `node --test`（自动发现 `test/*.test.mjs`）；M0/M1 真机判据见 plans/01、02；真机自动化取证见 §2.1（**需带 `--remote-debugging-port=9222` 启动**） |
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
- 远端：`origin` = `github.com/KaNgKaNg9999/dsh-ai-webapps`（2026-11-27 建立）；不自动 push，需要时单独确认
- 发布：`git tag` + GitHub pin 完整 commit 直装（`v1.0.0` 已于 2026-11-27 发布）；V1 不发 npm（D2）；已发布 commit 不改写
- 提交：`<type>: <summary>`（type ∈ feat/fix/docs/refactor/chore），一次提交一个可验收变更

## 4. 代码风格与结构

- `client.js` 用宿主的模块加载格式：`window.__ModuleLoader__.load({ id: '<包名>', factory(require) { … } })`；`id` 必须等于包名 `dsh-ai-webapps`。
- 只 `require('react')`；**禁止** `require` 任何 `@deepseek-ai/*` Client 包（宿主内部实现会变），布局与样式自行实现。
- 不复制宿主 CSS Module 类名；颜色/间距用主题 token（`--dsw-alias-*`），容器与控件跟随宿主主题。
- 所有注册（slot / listener / timer / lease / DOM 容器）必须成对释放，统一放在 `ctx.effect` 或 `apply` 内的清理函数里；插件重载不得留下孤儿 guest。
- 文本走 `ctx.locale`（先 `zh` + `en` 两份字典），不把中文硬编码进组件；面板 id 用 `ai-webapps:<siteId>`，存储键用 `dsh-ai-webapps.<name>.v1`。
- 日志统一前缀 `[aiwa]`；只打键名/状态/错误码，不打 token、cookie 值。
- 单文件优先：V1 全部实现放在 `client.js` 内（约 900–2000 行；诊断面板后约 1900 行，模块化拆分等出现第二个站点再做）。

### 4.1 文案术语（中英对照）

| 概念 | 中文 | English | 约束 |
|---|---|---|---|
| 产品名 | DeepSeek 网页面板 | DeepSeek web panel | 标题/详情用全名；左栏与设置导航用短名「DeepSeek 网页」/「DeepSeek web」 |
| 面板 | 面板 | panel | 不写「面板页」；英文 `main panel` |
| 登录 | 登录 / 重新登录 | sign-in（名词）/ sign in（动词） | 不用「登陆」；`Clear sign-in` 是按钮 |
| 快照 | 登录快照 | saved sign-in / snapshot | 面向用户写 "saved sign-in"；诊断与文档可用 snapshot |
| 回填 | 登录回填 | backfill | 只出现在诊断与文档 |
| 桌面桥 | 桌面桥 | desktop bridge | 指宿主 `dshDesktop.browser`；面向用户不展开 |
| 内嵌页面 | 内嵌页面 / 网页容器 | embedded page / web container | 面向用户不写 "guest" |
| lease | 容器 lease | lease | 只在诊断卡出现 |
| 平台 | DSH 桌面端 | DSH Desktop | 不写「桌面版」「客户端」 |

- 中文用全角标点，省略号统一 `…`；拉丁字母/数字与中文之间保留一个半角空格（如 `DeepSeek 网页面板`）。
- 英文标题/按钮/标签用 sentence case：只有首词与专有名词大写（`Copy diagnostics`、`Open in system browser`）。
- 失败提示必须带下一步（如「请手动复制地址」）；不把 `guest` / `lease` / `backfill` / `token` 这类内部词放进普通用户可见文案。
- `zh` / `en` 两份字典必须键集相同、值非空；新增文案一次补齐两边（T6 后有自动断言）。

## 5. 测试与门禁

- 提交/交付前：`node --check client.js`、`node --check index.js`；`node --test`（41 条断言，零依赖）；`npm pkg`/JSON 可解析。
- 纯逻辑（回填判定、崩溃重建门、采集过滤、脱敏、文案键集）必须有测试；测试只读 `client.js` 的 `__test` 出口，不启动宿主。
- M0 六项验收必须真机跑通并记录在 `docs/plans/01`；未跑通不标完成。
- 不修改 profile 文件；安装失败先重启 DSH 再重试。

## 6. 秘密与数据

- 令牌/密码/连接串不落盘、不进日志、不进测试快照。
- 运行时快照（`dsh-ai-webapps.snapshot.v1`）是用户数据的唯一落点，只在本机 localStorage；设置页提供清除入口。

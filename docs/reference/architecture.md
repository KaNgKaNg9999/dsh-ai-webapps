# 架构（Architecture）

> 状态：定稿（2026-11-26）｜最后更新：2026-11-26
> 只记录已确认的决策；被否方案与原因一并记录。

## 技术栈

- 纯 JavaScript（无构建、无第三方依赖）的 DSH bundle：Client 半区全部逻辑在 `client.js`，Host 半区是空壳 `index.js`（`export function apply() {}`）。
- React 由宿主 `window.__ModuleLoader__` 提供（`require('react')`），禁止 `require` 任何 `@deepseek-ai/*` Client 包。
- 依赖 DSH `0.2.2-rc.5` 的公开 Slot 契约：`sidebar.panellist`（左栏图标行）、`main`（keyed 主面板）、`settings.section`（设置页）、`shell.overlay`（frame 级常驻浮层）。
- 依赖 Desktop 内部桥：`globalThis.dshDesktop`（`protocolVersion: 1`）的 `browser` 子 API——`acquire(workspace) → {lease, partition}` / `release(lease) → Promise` / `onOpenRequested(lease, cb) → 取消订阅`；协议版本看 `dshDesktop.protocolVersion`，不是 `browser.protocolVersion`。
- 引导约束：`<webview>` 首次挂载必须带 `src="about:blank#<lease>"` + `partition="<partition>"`（`name=<lease>`），`dom-ready` 后才 `loadURL`；窗口打开经 `onOpenRequested` 交给系统浏览器。

## 模块与数据流

```
[左栏行] sidebar.panellist(id='ai-webapps:deepseek', label, 图标组件)
   │ 点击 → 侧栏调 ctx.layout.selectPanel(id)
   ▼
[主面板] main(key='ai-webapps:deepseek')   ← 可被 React 随时卸载，不承载 webview
   ├─ 工具栏（状态点 / 名称 / 刷新 / 系统浏览器 / 复制链接 / 清除登录）
   └─ 占位 div（只提供几何）
                 │ getBoundingClientRect + ResizeObserver
                 ▼
[宿主] shell.overlay 单例容器（position:fixed，挂载一次，永不 reparent）
   └─ <webview name=lease partition=… allowpopups src=about:blank#lease>
        ├─ 首次可见：bridge.acquire → attach → loadURL
        ├─ dom-ready：快照探测 → 需要则注入 + reload（每 lease 仅一次）
        ├─ 事件：console-message / did-fail-load / render-process-gone / page-title-updated
        └─ 崩溃：release 旧 lease → 重新 acquire → 重建 webview
[设置] settings.section(id='ai-webapps')：URL（只读）、登录保存状态、立即保存、清除
```

关键约束（已从 DSH 源码确认）：

- 主进程 `will-attach-webview` 校验 lease 与 partition，**每个 lease 只允许 attach 一次**；因此 webview **一旦创建就不能移动/脱离 document**，宿主必须常驻，显隐只改 `visibility` 与 `pointer-events`。
- 引导文档 `about:blank#<lease>` 先 attach，`dom-ready` 后主进程才认领 lease，之后才允许 `loadURL` 目标站点。
- `dom-ready` 对引导文档与站点文档各触发一次：目标导航每 guest 只发一次，站点文档的 `dom-ready` 不得重放；`ERR_ABORTED (-3)` 视为旧导航被重定向取代，不按加载失败处理。
- `shell.overlay` 是 frame 内 `.overlayLayer`（`absolute; inset:0; z-index:20; pointer-events:none`）；其直接子元素被全局 CSS 设为 `pointer-events:auto`，宿主容器的显隐必须用**内联** `visibility` + `pointer-events` 覆盖。

## 数据与存储

- `dsh-ai-webapps.sites.v1`（DSH 页面 localStorage）：站点定义 `{version, sites:[{id,name,url,order,enabled}]}`，V1 只有 DeepSeek，结构按多站设计。
- `dsh-ai-webapps.snapshot.v1`（DSH 页面 localStorage）：按站点 id 存的登录快照 `{savedAt,url,localStorage:{…},cookie}`；采集时单值 >64KB 跳过、总量 >512KB 截断；**不含 IndexedDB**。
- 采集时机：`did-finish-load` 后 1.5s、`visibilitychange→hidden`、面板切走、每 20s 轮询、设置页「立即保存」。仅在判定"已登录"时写入，避免坏快照覆盖。
- 回填：每个 guest 生命周期内只回填一次；回填后仍落在登录路径或 token 键消失 → 快照标 `stale`，停止回填并在面板提示重登。
- 分区：统一 workspace key `ai-webapps:shared`；默认内存分区（退出即丢），持久化完全由快照承担。

## 集成与部署

- 集成：作为 bundle 安装进 profile（`install_bundle` 或 Plugins → Add plugin 选目录）；随 profile 启动加载 Client 半区。
- 部署：本地目录安装（`link:`），无构建步骤；后续可发布 npm 包（需校验 `files` 与实际打包清单）。
- 兼容：非 Desktop profile / 桥缺失 / `protocolVersion` 不符时，面板显示"需要桌面端"或降级提示，不白屏、不抛错。

## 关键决策（含被否方案）

| 决策 | 理由 | 被否方案 |
|---|---|---|
| 主面板自建 `<webview>`（B 路线） | md 设计目标：满宽、每站独立、切走不重载 | 复用内置右侧栏 Browser（非满宽、入口受限）；iframe（三家站点禁 frame，实测 `frame-ancestors 'none'`） |
| 登录态用"会话快照"（localStorage + 可读 cookie） | 不改应用即可跨重启保持；DeepSeek token 在 localStorage 且请求用 Bearer | 改 `app.asar` 的 `persist:` 分区（v1 的坑：每次启动重写 200MB、EBUSY、冷启动崩溃；且换机不可移植） |
| 宿主常驻 `shell.overlay` 单例，几何跟随占位 div | webview 不能移动（每 lease 只 attach 一次） | 面板内常驻容器（React 卸载即销毁）；卸载前搬到暂存容器（触发二次 attach 被拒） |
| 分区用总 key `ai-webapps:shared` | 少进程、规则简单；V1 只有一站 | 每站一个 key（多站时进程数膨胀） |
| 启动时若停在站点面板则强制回会话 | 避免"DSH 好像坏了"的观感 | 恢复上次面板（用户已确认不要） |
| 每台机器各自登录一次 | 数美环境指纹 + `check_device` 使 token 迁移可能被要求重验 | 登录态导出/导入（V2 再评估） |
| 不改 DSH 本体 | 换机可移植、升级不失效 | 打补丁改 `app.asar`（已还原为官方原版） |

## 风险与约束

- 桥是内部 API（`protocolVersion: 1`），DSH 升级可能变化 → 必须 try/catch + 降级提示，并在升级后回归。
- Turnstile / 站点风控可能拒绝 Electron 环境 → 备选 `webview.setUserAgent(纯 Chrome UA)`（有 client hints 等副作用，仅失败时启用）。
- 回填可能因 token 失效导致连环 reload → 每 lease 只回填一次 + stale 标记。
- guest 权限全拒：下载、麦克风/摄像头、通知、`navigator.clipboard.readText`、站点 `alert/confirm` 不可用。
- 快照为明文 token，存于本机页面 localStorage（等同浏览器 Cookies 文件）；同域其他插件理论上可读 → 设置页提供清除。
- 同一分区下同域多站会共享 cookie 罐（V1 单站无实际影响）。
- 打包版 guest 的 DevTools 关闭 → 排障依赖 `console-message` 转发（前缀 `[aiwa]`）。

## 未决问题

- 无（运行时未知项已转为 `docs/plans/01-M0-DeepSeek面板.md` 的验证任务）

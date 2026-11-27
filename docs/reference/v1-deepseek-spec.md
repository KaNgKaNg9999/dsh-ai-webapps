> 状态：当前设计事实源（V1，2026-11-26 迁入）｜适用：DSH Desktop 0.2.2-rc.5
> 来源：讨论工作区 `D:\dsh\dsh-02_plugin_create\v1-deepseek-spec.md`（内容快照；后续修改以本文件为准）

# V1 规格 v2 — DeepSeek 网页面板（dsh-ai-webapps）

> 状态：**设计定稿**（T1–T14 全部确认），待施工 + M0 真机验证
> 前序：[ai-webapps-feasibility.md](ai-webapps-feasibility.md)（可行性）、[ai-webapps-review.md](ai-webapps-review.md)（第一轮评审）
> 环境：DSH Desktop 0.2.2-rc.5 / profile `desktop` / `app.asar` 已还原为官方原版

---

## 0. 决策表

| # | 决策 | 值 |
|---|---|---|
| T1 | V1 范围 | 只做 DeepSeek；数据结构按多站设计 |
| T2 | 命名 | 包 `dsh-ai-webapps`；面板 `ai-webapps:deepseek`；键 `dsh-ai-webapps.sites.v1` / `.snapshot.v1` |
| T3 | 快照存储 | `dsh-app` 页面的 localStorage（不引入 Host 半区） |
| T4 | 快照内容 | 全量 localStorage（单值 >64KB 跳过）+ 可读 cookie；**不含 IndexedDB** |
| T5 | **宿主容器** | **`shell.overlay` 里的单例容器**（`position:fixed`，永不移动）；退路 body fixed |
| T6 | 回填闪烁 | 宿主在 guest 首次加载完成且回填落定前保持隐藏（显示加载卡片），不出现未登录闪（2026-11-26 重启实测后修订） |
| T7 | 启动行为 | 不自动抢占主面板（见 T13） |
| T8 | 工具栏 | 刷新 / 在系统浏览器打开 / 复制链接 / 清除登录 |
| T9 | asar 补丁 | 不依赖；已还原官方原版 |
| T10 | 图标 | 自绘 SVG（DeepSeek 蓝底 + 简化鲸鱼） |
| T11 | 安装 | 我在工作区生成 bundle 并 `install_bundle` |
| T12 | **分区 key** | **一个总 key `ai-webapps:shared`**（V1 单站也用总 key） |
| T13 | **启动选中态** | 若 `activePanelId` 是我们的 id → `selectPanel(null)` 强制回会话 |
| T14 | **登录态跨机** | **每台机器各自登录一次**；V1 不做登录态迁移 |

---

## 1. 范围

**做**：左栏一行 → 主面板全宽 DeepSeek 网页 → 切面板不重载 → 登录一次后同机重启无感。
**不做**：站点增删排序、登录态导出/导入、Gemini/Grok、任何 `app.asar` 改动、登录态跨机迁移。

---

## 2. 事实分档

### A. 可依赖（源码可证 / 已实测）

1. `app.asar` 已还原官方原版（sha256 `5EC8ACD9…`，209,083,008 B），本机 = 裸机。
2. `dshDesktop`（`protocolVersion: 1`）只在 `dsh-app://app` 主帧暴露完整 API，其 `browser` 子 API 为 `acquire(workspace)` → `{lease, partition}`、`release(lease)` → Promise、`onOpenRequested(lease, cb)` → 取消订阅函数；**协议版本挂在 `dshDesktop` 上，不在 `browser` 上**（2026-11-26 源码 + 真机确认）。引导文档：`<webview>` 以 `src="about:blank#<lease>"` + `partition="<partition>"` + `name="<lease>"` 首次挂载完成 attach，`dom-ready` 后才 `loadURL`（主进程此时按 `about:blank#` 校验归属）；窗口打开经 `onOpenRequested` 转发，一律 deny。
3. `will-attach-webview`：lease + partition 校验，**每个 lease 只 attach 一次**。
4. 分区按 workspace 字符串缓存；同一 key 在一次运行内重复 acquire 得到**同一分区**（同一 cookie 罐）。
5. 默认分区内存级；`persist:` 分支已随还原消失（只剩历史）。
6. 主面板 `main` 是 keyed slot，只渲染选中 key；`.mainPanel` 是 `flex:1; min-height:0` 的 flex column，本身不被卸载。
7. `sidebar.panellist` 注册项 = 图标组件 + `id/order/label`；id 即 `main` 的 key。
8. `settings.section` 注册项 = `id/order/label`（可选 `locale`/`inject`）+ 组件（接收 owner props，如 `{close}`）；dsh 0.2.2 另有 `settings.section.icon`（`{name,id}` + 组件收 `{size}`）专供设置导航图标，宿主不声明时 `inject` 只等待（2026-11-26 从已装插件 `dsh-mcp-connector`/`dsh-mobile-plugin`/`dshmarket` 源码核实）。
9. 关窗口 = 隐藏到托盘（`main.js:21470-21482`）。
10. DeepSeek：token 在 localStorage、请求 `Authorization: Bearer`；设备信息也在 localStorage；另有数美环境指纹与 `check_device`。
11. 三家站点禁 iframe；本机代理 `127.0.0.1:6234`，DeepSeek 可达。
12. Host 是独立 Node 进程，插件拿不到 Electron session。
13. `shell.overlay` = frame 内 `.overlayLayer`（`position:absolute; inset:0; z-index:20; pointer-events:none`），其直接子元素被 CSS 设为 `pointer-events:auto`；宿主容器用 `position:fixed` 跟随占位 rect，显隐须**内联**写 `visibility` + `pointer-events` 覆盖该规则（2026-11-26 源码 + 运行态确认）。

### B. M0 必须运行时验证

桥真可用 / webview 能建能加载 / `executeJavaScript` 可读写 guest storage / 回填后 `check_device` 放行 / `shell.overlay` 注册与层级 / `settings.section` 第三方注册 / 选中态是否跨重启保留 / `webview.setUserAgent` 是否存在。

### C. 不可控

DeepSeek 对嵌入会话的风控与 Turnstile、换机重验、DSH 升级改协议、Grok 的 Cloudflare（V1 不涉及）。

---

## 3. 架构

```
[左栏行] sidebar.panellist(id='ai-webapps:deepseek', label, 图标组件)
   │ 点击 → 侧栏调 layout.selectPanel(id)
   ▼
[主面板] main(key='ai-webapps:deepseek')   ← 可被 React 随时卸载，不承载 webview
   ├─ 工具栏（状态点/名称 · 刷新 · 系统浏览器 · 复制链接 · 清除登录）
   └─ 占位 div（只提供几何）
                 │ rect + ResizeObserver
                 ▼
[宿主] shell.overlay 单例容器（position:fixed，挂载一次，永不 reparent）
   └─ <webview name=lease partition=… allowpopups src=about:blank#lease>
        ├─ 首次可见：acquire → attach → loadURL
        ├─ dom-ready：快照探测 → 需要则注入 + reload（每 lease 仅一次）
        ├─ 事件：console-message / did-fail-load / render-process-gone / page-title-updated
        └─ 崩溃：release 旧 lease → 重新 acquire → 重建 webview
[设置] settings.section(id='ai-webapps')：URL（只读）、登录保存状态、立即保存、清除
```

---

## 4. 生命周期规则

1. **单例宿主**：`shell.overlay` 条目在插件 apply 时注册一次，内部 `<div ref>` 由插件 append 宿主容器；容器 `position:fixed`，几何由占位 div 驱动。**永不 appendChild 到别处、永不 remove**。
2. **显隐**：未选中 → `visibility:hidden; pointer-events:none` 且移出视口（`transform: translateX(-200vw)`）；选中且 rect 有正尺寸 → 同步几何并显示。rect 为 0 时保持隐藏。
3. **acquire 时机**：第一次"选中且可见"时才 acquire；重复选中幂等。
4. **崩溃重建**：`render-process-gone` / `destroyed` → 清状态 → `release`（失败忽略）→ **新 lease + 新 webview**（旧 lease 不可复用）。
5. **插件卸载/HMR**：释放 lease、销毁容器、清 timer、注销 slot 注册。
6. **启动**：apply 后读 `ctx.layout.panelInfo`，若 `activePanelId === 'ai-webapps:deepseek'` → `selectPanel(null)`（T13）；守卫只在页面本次运行的首次 apply 生效（HMR / 插件重载不把用户踢回会话）。
7. **焦点/弹窗**：MutationObserver 监听宿主外出现 `[inert]`（设置弹窗打开的特征）→ `webview.blur()` + 隐藏；消失后恢复。z-index 保持低于 body 级弹窗。
8. **快捷键**：guest 内按键由 guest 自己处理，DSH 快捷键不会误触；面板内不新增全局快捷键（V1）。
9. **加载只发一次**（2026-11-26 真机）：`dom-ready` 会在引导文档与站点文档各触发一次；目标 `loadURL` 只在引导文档触发一次，站点文档的 `dom-ready` 不得重放，否则每次加载都会中断自己、形成闪烁循环。`loadURL`/`did-fail-load` 的 `ERR_ABORTED (-3)` 是旧导航被重定向取代的良性错误，不按失败处理；仅当 2s 后仍停在 `about:blank#lease` 时补一次重试。
10. **首次显示门控**（2026-11-26 重启实测后修订 T6）：guest 在「首次加载完成 + 回填落定（validated / invalid / failed）」前保持隐藏，宿主显示加载卡片；首次显示后，站内整页导航保持可见。这样重启回填时不会先露出未登录页再闪到聊天页。

---

## 5. 快照规则

**采集**（仅"已登录"时写，避免坏快照覆盖好快照）：
- 判定：guest 内 `localStorage` 存在 token 相关键（具体键名 M0 实测，代码里用"存在任一非空且 <64KB 的键 + URL 不在登录路径"作为宽松判定；2026-11-26 实测已登录时有 `userToken`，另有 `settingsJwt`、`__appKit_userInfo` 等）；
- 时机：`did-finish-load` 后 1.5s、`visibilitychange→hidden`、面板切走、每 20s 轮询、设置页「立即保存」；
- 内容：`{ savedAt, url, localStorage: {...跳过大值}, cookie: document.cookie }`；总量 >512KB 截断并记录（实测快照约 37KB，未截断）。

**回填**：
- 条件：有快照、宿主页未标记 stale、本 guest 生命周期内未回填过、当前页面不是登录路径；
- 动作：写 localStorage + document.cookie → `location.reload()` 一次 → 置「本 lease 已回填」标记；
- **防循环**：每 lease 只回填一次；若回填后页面仍落在登录路径或 token 键消失 → 快照标 `stale`，不再回填，面板显示「登录已失效，请重新登录」（重新登录成功后清 stale 并采集新快照）。

**不做**：IndexedDB、HttpOnly cookie（拿不到）。

---

## 6. 限制（写进 DETAIL/设置页）

1. 仅 Desktop 版可用，Web 版显示"需要桌面端"。
2. 每台机器各自登录一次（T14）。
3. 下载、麦克风/摄像头、通知、`navigator.clipboard.readText`、站点 `alert/confirm` 均不可用（`disableDialogs`）。
4. `about:blank` 弹窗被 deny；http(s) 弹窗走 `onOpenRequested` → 系统浏览器。
5. 快照以明文存于本机（等同浏览器 Cookies 文件），同域其它插件理论上可读；设置页可清除。
6. 同域多站共享总分区 cookie 罐（T12）。
7. guest devTools 在打包版关闭，排障依赖 `console-message` 转发。
8. 桥是内部 API，DSH 升级可能变；`protocolVersion` 不符时降级提示而非白屏。

---

## 7. M0 验收（6 条）

1. 左栏出现 DeepSeek 行；点击后主面板选中并渲染工具栏 + 面板。
2. webview 成功加载 chat.deepseek.com（`console-message` 转发可见）。
3. 能完成登录（手机/邮箱 + Turnstile）；若 Turnstile 失败，进入 R5 分支（UA 覆盖）再试一次。
4. 切到会话再切回：**不重载**（草稿/滚动保持），guest 未重建。
5. 登录后打印 `Object.keys(localStorage)`（只打键名）核对 token 键。
6. 托盘彻底退出 → 重启 → 自动进聊天；且启动**不会**停在站点面板。

## 8. M1 清单

设置页交互完整化、locale（en/zh）、图标与 DETAIL、错误态文案、加载失败重试、按钮状态（复制成功 toast 等）；**加载卡视觉已提前完成（2026-11-26）**。

---

## 9. 第二轮评审新增问题与处置

| # | 新问题 | 处置 |
|---|---|---|
| R1 | `shell.overlay` 的常驻性 / `pointer-events` / z-index 与 body 弹窗的层级**未验** | **已回填（2026-11-26）**：契约与运行态确认——root list、frame 内 `.overlayLayer`（absolute inset 0、z-index 20），整层点击穿透且直接子元素被置 `pointer-events:auto`；宿主容器 `position:fixed` 跟随占位 rect，显隐用内联 `visibility`+`pointer-events` 覆盖。**与 body 弹窗的层级仍留 V 真机确认** |
| R2 | **回填死循环**：失效 token 会被反复回填 → 无限 reload | 每 lease 只回填一次 + 落地登录路径即标 `stale` 停止回填 |
| R3 | 坏快照覆盖好快照 | 采集只在"已登录"判定成立时写 |
| R4 | 设置弹窗打开时宿主可能浮在上层且焦点留在 guest | 监听 `[inert]` → blur + 隐藏；z-index 低于弹窗 |
| R5 | **Turnstile/风控可能过不了 Electron** | 先裸测；失败用 `webview.setUserAgent(纯 Chrome UA)` 再试；仍失败则记录为站点侧限制 |
| R6 | localStorage 体积爆掉 | 单值 64KB 跳过、总量 512KB 截断 |
| R7 | 总 key 下同域多站共享 cookie | 写进限制；V1 只有一站无实际影响 |
| R8 | 插件重载重复注册 `main` | apply 内统一用 `ctx.effect` 管理，重载先 dispose；迭代期改 client.js 需重启或刷新页面（HMR 仅 dev:web 生效） |
| R9 | `install_bundle` 可能联网/失败 | 无依赖本地目录，失败先重启再装；不手改 profile |
| R10 | guest devTools 关闭，排障困难 | 必做 `console-message` → 宿主 console 转发（前缀 `[aiwa]`） |
| R11 | UA 覆盖有副作用（client hints、站点特性开关） | 默认不改，仅 Turnstile 失败时作为设置项开启 |
| R12 | 未选中时若忘关 pointer-events 会挡住会话 | 显隐必须同时改 visibility + pointer-events，并有 rect>0 自检 |
| R13 | 回填后可能停在登录子路径（站点自己跳转） | reload 后校验 URL，必要时 `loadURL(origin)` 回首页 |
| R14 | `dom-ready` 对引导文档和站点文档各触发一次，若每次都 `loadURL` 会自中断成闪烁循环（2026-11-26 实测） | 每 guest 只发一次目标导航；`ERR_ABORTED (-3)` 不按失败处理，仅在仍停在 `about:blank#lease` 时补一次重试 |

---

## 10. 剩余未知（2026-11-27 已收敛）

> 本节各项的操作步骤、判据与处置见 `docs/plans/02-M1-缺口验收清单.md`；五项已于 2026-11-27 真机全部跑完，结果如下。

### 已闭环

| 项 | 结论 |
|---|---|
| V1 `console-message` 转发 | **通过**。guest `console.warn/error` 在宿主产出 `[aiwa][guest]` 前缀与 warning/error 级别；站点自身日志同样带前缀。R10 实现正确 |
| V3 stale 降级 | **通过**。坏 token 注入后校验失败 → `stale` 落盘 + 工具栏「登录已失效，请重新登录」+ 页面停在登录页、**无循环刷新**；`stale` 为真后新 lease 不再注入。**修复**：`validateBackfill` 补 `login` 判据（原逻辑只看 token 键存在，坏值会被误判成功） |
| V4 崩溃重建 | **通过**。可见时崩溃 → 600ms → 新 lease → 免重登回聊天；不可见时崩溃只释放不重建，切回后自动重建。**修复**：`maybeStart` 放行 `crashed`（原逻辑在面板切走时崩溃后会永久卡在「正在重建…」），重建次数用尽改文案「自动重建已停止，请手动刷新」并给按钮 |
| V5 弹窗层级 | **通过（口径修正）**。设置弹窗与会话右键菜单均完整压在 guest 之上且可交互，R1/R4 假设成立。本版本**能与 guest 同屏的浮层只有这两类**（无命令面板、会话无删除入口，插件详情与 Markdown 预览是面板内页面，打开时 guest 不在屏上） |
| V2 Turnstile | **无需 R5**。用户完成真实登录并进入聊天页。**未出现 Cloudflare Turnstile**；站点侧的人机验证是**发送验证码时的图片选择验证码**（站点自带、非 Cloudflare），在 Electron 内正常通过 → R5（UA 覆盖开关）**不实现** |

### 仍然是未知 / 待办

- **排障通道（重要，仍未解决）**：打包版宿主 DevTools 打不开（`应用 → 开发者工具` 可点但无窗口，`Ctrl+Shift+I` 无反应，无 CDP 端口）。即 R10 的转发虽正确，但**人看不到**。目前靠 `tools/cdp-eval.mjs`（需以 `--remote-debugging-port=9222` 启动）临时取证。产品化建议：设置页内嵌「最近 N 条 `[aiwa]` 日志 + guest 状态」面板，或由 Host 半区写一份滚动日志文件。
- **回填后 `check_device` 是否放行**：未单独取证（本次重启/崩溃重建后均能正常进聊天页，间接说明放行）。
- **选中态是否持久**：仍按 T13 兜底（启动强制回会话）。
- **数据口径勘误（2026-11-27）**：历史记录里的「cookie 209」实为快照中 cookie **字符串长度**，不是条数；实际可读 cookie 只有 2 条（`smidV2`、`.thumbcache_…`）。登录态主体是 localStorage 的 `userToken`。
- **`[aiwa][guest]` 会透传站点标识**：转发是原样透传，站点日志里的 `user_unique_id` / `web_id` 也会进宿主 console；若将来实现常开调试面板，应只保留我方 `[aiwa]` 前缀的行。

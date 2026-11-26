> 状态：历史记录（2026-11-26 可行性评估）｜结论已被 `v1-deepseek-spec.md` 取代，仅作证据留档
> 来源：讨论工作区 `D:\dsh\dsh-02_plugin_create\ai-webapps-feasibility.md`（内容快照）

# 通用「网页 AI 内嵌」插件 · 可行性评估

- 评估对象：DSH Desktop **0.2.2-rc.5**（build `3f85d888`），profile `desktop`
- 评估方式：读安装内源码（`app.asar`）+ 运行时 Inspect（Slots / Service / Config）+ 目标站点响应头实测 + 与 v1（已清理的 `dsh-ai-webapps`）残留对账
- 结论：**UI 部分（你 md 里的布局）可以做，且是对着官方公开契约做的；但「登录保持」不是插件单方面能解决的，它必须改 DSH 应用本体。** 建议按 C 路线（主面板 + 降级兜底）实现，登录保持做成"只读探测 + 可选的一次性补丁"。

---

## 1. 结论速览

| 需求（来自 md） | 能否做 | 依赖 / 代价 |
|---|---|---|
| 左栏每站一行 | ✅ | 公开契约 `sidebar.panellist`（id 即 main 面板 key） |
| 每站一个主面板 | ✅ | 公开契约 `main`（keyed slot，key = 面板 id） |
| 设置 → 站点页 | ✅ | 公开契约 `settings.section` |
| 站点 store（localStorage v1） | ✅ | 插件自己管，无契约风险 |
| 切走再切回 · webview 不重载 | ⚠️ | 主面板**没有** keepMounted，要在 React 卸载前把 webview 移出 DOM（hack，需回归） |
| webview 开任意站点 | ⚠️ | 必须用内部桥 `globalThis.dshDesktop.browser`（`protocolVersion: 1`，非公开契约） |
| 登录跨重启保持 | ❌（插件侧） | 分区策略在主进程；只有改 `app.asar` 一行，或等上游支持 |
| 换台机器装了就可用 | ✅（除登录保持） | 打成 npm bundle，`install_bundle` 安装 |

一句话：**md 的布局设计成立；真正的成本不在 UI，而在「常驻 webview」和「登录分区」这两件事上。**

---

## 2. 三个已确认的事实（先把地基说清）

### 2.1 DSH 已经自带一个「在 DSH 里开网页」的能力

- 内置包 `@deepseek-ai/dsh-client-ui-sidebar-browser`，Desktop profile **默认启用**（`dsh-web-app/cordis.patch.yml:318-321`：`disabled: !!js "ctx.get('profileContext')?.name !== 'desktop'"`）。
- 它是右侧栏 Browser 页：Desktop 用 Electron `<webview>`，有后退/刷新/在系统浏览器打开，默认 `Ctrl+T`，`keepMounted`（切会话不重载）。
- 但它的 cookie 分区是**内存级**：`dsh-sidebar-browser-<uuid>`（`lib/main.js:18107-18111`），退出即丢；权限、下载、弹窗全部收紧（`lib/main.js:18234-18257`）。

> 也就是说：你的痛点今天已经能缓解一半——右侧栏开 chat.deepseek.com 就是"不切浏览器"。缺的是**站点化入口 + 主面板满宽 + 登录持久**。

### 2.2 你桌面上的 DSH 本体已经被改过一行（v1 的遗产）

| 检查项 | 结果 |
|---|---|
| 原始备份 `app.asar.before-ai-webapps-5ec8acd9e72b93b6` | 209,083,008 B；全文搜 `ai-webapps`：**0 命中** |
| 当前 `app.asar` | 209,083,098 B（+90 B）；`lib/main.js` 848,595 B（原 848,505 B），asar 头里该文件的 SHA256 已变 |
| 唯一差异位置 | `lib/main.js:18109`：`workspace === "ai-webapps:personal-browser" ? "persist:dsh-ai-webapps-personal-browser" : ...` |
| 语义 | 只有传 `ai-webapps:personal-browser` 这个 key 才拿到**磁盘持久化**分区（cookie 跨重启）；其它 key 一律内存分区 |
| 归属 | **不是官方代码**（原始包里没有），是 v1 手工打的补丁；DSH 升级/覆盖安装即失效 |

你的 profile 已经清理干净了（无该插件行、无依赖、localStorage 已删），所以现在这行补丁是"没人用、但还在"的状态。

### 2.3 决定方案的硬边界（都有源码依据）

| 约束 | 证据 | 影响 |
|---|---|---|
| webview 只能由主进程签发租约 | `lib/main.js:18151-18178`：`will-attach-webview` 校验 `src=about:blank#<lease>` 与 `partition`，不匹配直接 `preventDefault()` | 不能"自己 new 一个 webview"，必须走桥 |
| 桥只有 3 个方法 | `dsh-client-ui-sidebar-browser/src/types.ts`：`acquire(workspace)` / `release(lease)` / `onOpenRequested(lease, cb)` | 没有 cookie、权限、会话管理接口 |
| 主面板只渲染当前选中项 | `dsh-client-ui-layout/src/client/AppFrame.tsx:47-49`：`renderSlot('main', {}, { entryKey: panelId ?? 'conversation' })` | 切走 = 组件卸载 = webview 从 DOM 移除 = **页面重载**；slots 无 keepMounted |
| 目标站点禁 iframe | 实测响应头：chat.deepseek.com `frame-ancestors 'none'`；chat.qwen.ai `XFO: SAMEORIGIN`；gemini.google.com `XFO: DENY`；grok.com 403（待真机验） | Web 版 / iframe 兜底**不成立**，必须 Electron webview（Desktop 独占） |
| Host 是独立 Node 进程 | `dsh-desktop-host/package.json`："Private Node-mode host process for the Electron desktop application" | 插件 Host 半区拿不到 Electron `session`，不能自己持久化 cookie |
| 窗口能力 | `lib/main.js:20268-20281`：只有 primary 窗口 `webviewTag: true`；`window.open` 一律 `shell.openExternal` | 不能开一个"内部子窗口"绕过 |

---

## 3. md 里的设计 vs 官方契约（逐条对账）

| md 元素 | 契约 | 判定 |
|---|---|---|
| `sidebar.panellist`（`id='ai-webapp:<siteId>'`） | `dsh-client-ui-sidebar/src/client/contract/slots.ts:43-47`：list，注册项是**面板图标组件** + `id`/`order`/`label`；**同 id 寻址 `main` 的同名 key**；点击 → `selectPanel(id)`；`label` 由侧栏渲染 | ✅ 一致，注意：站点行组件只负责画图标，名称来自 `label` 元数据 |
| `main`（keyed） | `layout README`：Global panels occupy root-scoped `main` keyed slot；`selectPanel` 校验已注册 key，不存在会抛错 | ✅ 一致 |
| `settings.section` | `dsh-client-ui-settings/src/client/contract/slots.ts:57`：list，`id`(section key)/`order`/`label` + 组件（拿到 `{close}`） | ✅ 一致 |
| 常驻页（show/hide 不重载） | 无 keepMounted；`AppFrame` 只渲染选中 key | ⚠️ 必须自己做 DOM 收养（md L155 的思路对） |
| webview（分区由桥签发） | `ElectronWebviewPresentation.ts:52-61`：`<webview name=lease partition=… src=about:blank#lease>` | ✅ 一致，但要自己实现 acquire/release/onOpenRequested 全生命周期 |
| 站点 store | 插件自管 | ✅ 无风险 |
| "登录保持：已启用/下次退出后生效/需适配" | 可用 `reservation.partition` 是否以 `persist:` 开头来**只读判定** | ✅ 这个思路很好，建议保留 |

**结论：UI 层没有拦路虎，全部落在公开 Slot 契约上。**

---

## 4. 三条路线

### A. 复用内置右侧 Browser（最省事）
左栏站点行 → `ctx.sidebarRight.openTab('browser', { params: { url } })`（内置浏览器 README 明确写了这条给插件用），可把右侧栏拉满/全屏。
- 优点：零内部 API、零 hack、`keepMounted` 原生、DSH 升级几乎不用管
- 缺点：不是主面板（宽度/位置受限）；登录照样不持久
- 工作量：**M**（约 0.5–1 天）；风险：低（唯一未验证：第三方插件能否拿到 `ctx.sidebarRight`，Inspect 的 Service 目录里没列它，需 10 分钟实测）

### B. 主面板自建 webview（你的 md 设计）
- 优点：体验最好——满宽、每站独立、切走不重载
- 缺点：依赖内部桥（非公开契约）+ DOM 收养（hack）+ 弹窗（OAuth）接管 + 分区策略 + 每站一个渲染进程（内存 100–300MB/站）
- 工作量：**L**（约 3–5 天，含真机回归）
- 风险：中（可用，但每次 DSH 大版本升级要回归一次）

### C. A+B 混合（推荐）
主面板是主体验；桥不存在 / `protocolVersion` 变化 / 面板收养失败时，自动降级到 A 或系统浏览器，并给一句人话提示。

---

## 5. 登录保持：只有三条路（重点，也是 v1 翻车的地方）

| 方案 | 效果 | 代价 |
|---|---|---|
| 1. 不补丁 | 每次启动重新登录（DeepSeek/千问要手机验证码） | 0；最可移植 |
| 2. **一次性手工补丁** `app.asar` 的那一行 | 登录跨重启保持（`persist:` 分区） | 改应用本体；DSH 升级后要再跑一次；有备份/回滚就不危险 |
| 3. 等上游支持 | 彻底干净 | 不可控 |

**v1 为什么废（从会话记录复盘的，值得写死成禁忌）：**
- 它在**每次启动**都重写 200MB 的 `app.asar` → 实测单次启动约 1.2GB 磁盘 I/O；
- 又搞了 helper 每 250ms 轮询、抢在进程退出前拷贝 Chromium `Cookies` 文件 → EBUSY、冷启动三连崩、登录态时好时坏；
- 结论：**"自动补丁 + 文件搬运"这条路不要再走。**

**新做法建议：**
- 补丁 = 一次性、显式、DSH 关闭时执行：备份 `app.asar` → 改 `lib/main.js` 那一行 → 重算 asar 头 integrity → 原子替换 → 校验；
- 插件**启动时只读探测**（看 `acquire()` 返回的 `partition` 是否 `persist:` 开头），只负责在设置页显示 `已启用 / 仅本次运行（需补丁）`，绝不在每次启动动文件；
- 这份补丁脚本作为独立可选物（不进插件运行时、不默认执行），文档里写清"升级后重跑一次"。

---

## 6. 分期计划与验收标准

**M0 · spike（先做这个，1 次会话）**
1. 第三方 client 插件能否直接拿到 `globalThis.dshDesktop`（`protocolVersion === 1`）并成功 `acquire`
2. 面板切换时"卸载前移出 + 暂存容器"能否让 webview 不重载（React 删除阶段先跑 layout cleanup 再移除 DOM，理论可行，必须真机证）
3. chat.deepseek.com / chat.qwen.ai 在无 cookie 分区里能否完成登录（重点：验证码、OAuth 弹窗是否必须走 `onOpenRequested`）
4. Gemini / Grok 是否被 Google/X 判为"不安全浏览器"直接拒绝登录 → 决定默认站点表
- 验收：3 个站点各登录一次、发消息、切到会话再切回，输入框和对话记录都不丢

**M1 · 可用版**：store + 设置页（增删改/上下移/校验/恢复默认）+ 左栏行 + 主面板 + 工具栏（刷新 / 在系统浏览器打开 / 复制链接）+ 桥缺失降级 + 权限与弹窗提示
**M2 · 打磨**：locale 中英、图标与详情图、Config、站点表导出/导入（换机用）、安装文档
**M3 · 可选**：持久化补丁脚本（默认不装、不自动跑）

---

## 7. 跨机器安装的形态

- 一个 npm 包（含 `dsh.bundle.patch` + `dsh.client` + `./client` 导出），用 `plugin_manager install_bundle` 或 **Plugins → Add plugin（本地目录）** 安装，落在 `%DSH_PROFILE_DIR%\node_modules`，重启后仍在。
- 不要在插件里手写 profile 的 `package.json` / `cordis.patch.yml`（`install_bundle` 负责）。
- 站点表在 localStorage，**只在本机**：设置页提供导出/导入 JSON，换机时贴一次即可。
- 插件 id 用 `dsh-ai-webapps`，面板 id 前缀 `ai-webapps:`（避免和内置 `conversation`/`plugins` 撞 key）。

---

## 8. 风险清单（按严重度）

1. **登录持久化**必须改应用本体；升级失效。
2. **Google / X 登录很可能直接拒绝**（Gemini、Grok）→ 这两个站点在桌面端大概率只能"在系统浏览器打开"。
3. 内部桥 `protocolVersion: 1` 非公开契约 → 每次 DSH 升级都要回归；必须 try/catch + 降级。
4. 每站常驻一个 webview = 一个 Chromium 渲染进程；建议默认懒加载，最多 N 个常驻（如 3）。
5. DOM 收养是 hack：侧栏折叠、右栏全屏、窗口缩放等场景要专门回归。
6. 弹窗不接管会静默失败（登录 OAuth 常见）。
7. 权限全拒：麦克风/摄像头/下载/通知/剪贴板读都不可用 → 语音输入类功能在面板里没有。
8. 分区按 workspace key 固定（`ai-webapps:personal-browser`）→ 所有站点共用一个 cookie 罐（不同源之间仍隔离），这是刻意的，别改。

## 9. 建议不做

- ❌ 每次启动改 `app.asar`（v1 的坑）
- ❌ 轮询/搬运 Chromium `Cookies` 文件
- ❌ 本地反向代理 + 剥 `X-Frame-Options`（凭据安全 + 违反站点策略）
- ❌ 开独立浏览器窗口冒充"内嵌"
- ❌ 做 Web 版 iframe 兜底（站点都禁 frame，做了也是白屏）

---

## 10. 证据索引（可复查）

| 主题 | 位置 |
|---|---|
| 分区策略 + 持久化钩子 | `app.asar/lib/main.js:18105-18123`（关键：18109） |
| webview 租约校验 | `app.asar/lib/main.js:18151-18178` |
| 权限/下载/请求过滤 | `app.asar/lib/main.js:18234-18263` |
| 窗口 webviewTag / window.open | `app.asar/lib/main.js:20268-20281` |
| 桥的公开形态 | `.../dsh-client-ui-sidebar-browser/src/types.ts` |
| 桥的调用方（protocolVersion 判定） | `.../dsh-client-ui-sidebar-browser/src/client/index.ts:69-74` |
| webview 创建 | `.../src/client/electron/ElectronWebviewPresentation.ts:52-61` |
| 主面板唯一渲染 | `.../dsh-client-ui-layout/src/client/AppFrame.tsx:47-49` |
| 站点行契约 | `.../dsh-client-ui-sidebar/src/client/contract/slots.ts:43-47` |
| 设置页契约 | `.../dsh-client-ui-settings/src/client/contract/slots.ts:57` |
| 内置 Browser 默认启用条件 | `.../dsh-web-app/cordis.patch.yml:318-321` |
| Host 为 Node 进程 | `.../dsh-desktop-host/package.json` |
| 原始 vs 当前 asar 差异 | 备份 209,083,008 B / 当前 209,083,098 B；`lib/main.js` 848,505 → 848,595 B |
| 站点 iframe 策略 | 实测响应头（见 2.3） |

---

## 11. 需要你拍板

1. **路线**：A（省事） / B（md 原设计） / **C（推荐）**
2. **登录保持**：接受每次登录 / 允许一次性手工补丁（我给脚本+备份+回滚，启动只读探测） / 先只显示状态不做补丁
3. **默认站点表**：Gemini、Grok 很可能登录不了，是否保留（保留也有"在系统浏览器打开"可用）
4. 是否现在就开 **M0 spike**（先证 4 件事，再写正式插件）

---

## 12. 实测验证结果（2026-11-26 当场跑）

### 12.1 桥（`dshDesktop.browser`）确认可用

| 检查 | 结果 |
|---|---|
| 暴露条件 | `lib/preload-app.cjs:2112`：`location.protocol === 'dsh-app:' && hostname === 'app' && mainFrame` 才给完整 API，否则只给 `{ protocolVersion: 1 }` |
| 主窗口页面 | `dsh-app://app/...`（`lib/main.js` 多处 `assertDesktopSender`/`assertSender` 按此校验），所以**主帧拿得到完整 API** |
| 暴露的方法 | `acquire(workspace)` / `release(lease)` / `onOpenRequested(lease, cb)`，`protocolVersion: 1`（preload:1980-2000） |
| 结论 | **B 路线技术上成立**，插件 client 半区与内置 sidebar-browser 用同一套桥，能力等价 |

### 12.2 持久化分区：钩子在，目录是空的

- `lib/main.js:18109` 的 `persist:` 分支仍在；
- `%APPDATA%\@deepseek-ai\dsh-desktop\Partitions` 目前**为空**（v1 清理时删掉了 `dsh-ai-webapps-personal-browser`），首次 `acquire('ai-webapps:personal-browser')` 会重建它；
- 这台机器上**不需要再打补丁**就能拿到无感登录；只有换机器/DSH 升级后才需要一次性补丁。

### 12.3 站点连通性（本机，系统代理 `127.0.0.1:6234`）

| 站点 | 结果 | 备注 |
|---|---|---|
| chat.deepseek.com | 200（首页与 `/sign_in` 同壳 8.6KB） | SPA，正常 |
| chat.qwen.ai | 200（含验证码相关脚本） | 正常 |
| gemini.google.com / accounts.google.com | 200 | 有一次瞬时 SSL 失败（代理抖动），重试即过 |
| grok.com / accounts.x.ai | **403** | Cloudflare 类 bot 防护；`Invoke-WebRequest` 不是浏览器，真实 Chromium 里可能过 JS 挑战，**只能在 M0 真机验** |
| iframe | 三家全禁 | deepseek `frame-ancestors 'none'`、千问 `SAMEORIGIN`、Gemini `DENY` |

### 12.4 结论

- 桥、分区钩子、站点连通性三项已当场验证通过；
- 剩下 3 件必须用最小插件在真机验：① 切面板不重载 ② DeepSeek/千问能否走完登录（含验证码与 OAuth 弹窗）③ Grok 能否过 Cloudflare；
- Gemini 走 Google 账号，Electron webview 被 Google 判"不安全浏览器"是业界常态 → **默认站点表建议先只放 DeepSeek / 千问，Gemini、Grok 标为"实验，可能需要系统浏览器"**。

---

## 13. 已选定

- **路线：B（主面板自建 webview，md 原设计）**
- **登录保持：要求"装完即用 + 登录一次后跨重启无感"** → 结论更新为 **会话快照方案，不改应用**，见第 14 节（第 12 节的"一次性补丁"结论作废）。

---

## 14. 更正：登录持久化可以不改应用（会话快照）

### 14.1 为什么原结论变了

原先假设"cookie 存不住 ⇒ 登录必丢"。实测两家目标站的**登录态本身是 JS 可读的**，所以可以由插件在 guest 内读出来、存盘、下次回填：

| 站点 | 登录态存储（从站点 JS 实测） | 可移植性 |
|---|---|---|
| chat.deepseek.com | localStorage 键 `userToken`（另有 `__appKit_userInfo`；设备标识也在 localStorage：`deviceId/deviceModel`）；请求带 `Authorization: Bearer <token>` | ✅ 可快照回填 |
| chat.qwen.ai | localStorage 键 `token` + `at_expire_time`；`Ob()` 同时写 localStorage 与可读 cookie；设备号 `x-umid` 也来自 localStorage 随机键 | ✅ 可快照回填 |
| Gemini / Grok | Google / X 的会话是 HttpOnly cookie，且对 Electron webview 风控更严 | ❌ 搬不动，建议排除或标"实验" |

DeepSeek 有 `auth_token/check_device` 的设备校验，但 deviceId 同样在 localStorage 里 → 一起快照即可通过。

### 14.2 快照方案怎么做（零改应用、零脚本）

1. **首次**：用户在站点面板里照常登录（验证码/扫码都行，只需一次）。
2. **抓取**：插件通过 `<webview>.executeJavaScript` 读取该源的 `localStorage` 全量 + `document.cookie`（可读部分），交给插件 Host 半区落盘（profile 数据目录，明文，等价于浏览器的 Cookies 文件）。触发时机：页面加载后、面板隐藏、DSH 退出前，另可低频轮询。
3. **回填**：下次启动创建该站 webview → 加载源 → `dom-ready` 时写入快照 → `location.reload()` 一次 → 站点按已登录启动。
4. **附加保险**：仍用 `ai-webapps:personal-browser` 这个 workspace key 申请分区——若某台机器上恰好存在 `persist:` 钩子，cookie 还能真正落盘（双保险）；没有也不影响，快照兜底。

### 14.3 代价与边界

- 快照里的 token 是**明文**放在本机 profile 目录；设置页必须提供"清除已保存登录"，文档里写明等同浏览器 cookie 文件。
- 站点若把 token 绑定到更强的设备指纹（Canvas/WebGL + 服务端记录），可能触发重新验证 → 降级为"该站需重登"，不影响其它站。
- 仍需真机验证：DeepSeek/千问 各"登录一次 → 完全退出 DSH → 重启 → 自动进入聊天"一遍。
- 因此 **`app.asar` 的那行遗留补丁不再是必需品**：可以保留当保险，也可以还原成原版（备份在手）；建议等验证通过后再决定。

### 14.4 Gemini / Grok 为什么快照救不了，以及还能怎么救

Google / X 的会话是 **HttpOnly cookie**（`__Secure-1PSID`、`SAPISID` 等；X 侧的 `auth_token`/`ct0` 同理）：

- JS 读不到（HttpOnly），也写不了（HttpOnly 只能由服务端 Set-Cookie）；
- 而且 Google 的 cookie 是 `Domain=.google.com`，`gemini.google.com` 页面即使能写也只能写自己的域。

所以这两家**没有"快照回填"这条路**，在 DSH 内只剩三条：

| 方案 | 效果 | 代价 |
|---|---|---|
| **持久化分区**（`persist:`，即那行 app.asar 补丁 + 一次应用重启） | 真正的"重启也无感"，HttpOnly cookie 一并保住 | 改应用一次；DSH 升级后要重来 |
| **托盘常驻**（不改应用） | 关窗口 = 隐藏到托盘（源码确认：win32 首次提示后 `hide()`，托盘菜单才有 Quit），应用不退出 ⇒ 内存分区不丢 ⇒ Gemini/Grok 会话一直在；**只有真正退出/重启才需要重登** | 需要习惯"不退出应用"；重启后要重登 |
| **系统浏览器兜底** | 登录态本来就在浏览器里 | 又回到切窗口 |

另有一个必须先验的坑：**Google 会拦截嵌入式 webview 登录**（"此浏览器或应用可能不安全"），Electron 默认 UA 带 `Electron/32` 标记。可缓解手段是 `<webview>.setUserAgent(<纯 Chrome UA>)`（公开 API，不需要改应用），但能否放行只能真机登录一次才知道。




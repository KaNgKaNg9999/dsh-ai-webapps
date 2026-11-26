> 状态：历史记录（2026-11-26 第一轮严格评审）｜D1–D6 / R1–R13 的出处；现行结论见 `v1-deepseek-spec.md`
> 来源：讨论工作区 `D:\dsh\dsh-02_plugin_create\ai-webapps-review.md`（内容快照）

# 严格评审：前面梳理内容的漏洞与修正（2026-11-26）

> 评审对象：[v1-deepseek-spec.md](v1-deepseek-spec.md)（V1 规格）与 [ai-webapps-feasibility.md](ai-webapps-feasibility.md)（可行性评估）
> 评审方法：逐条回源码复核 + 检查推理链是否有跳步 + 区分「实测」「源码可证」「推断」
> 结论：**整体骨架成立，但有 1 个会直接导致方案失败的致命设计错误（D1），另有 5 个需要修正/降级的问题，以及一批遗漏的工程细节。**

---

## 一、必须改的设计错误

### D1（致命）「切走不重载」的保活方案是错的

**我原来写的**：webview 容器放在面板里，切走时 `display:none`；或者卸载前把 webview 搬到"暂存容器"。

**为什么错**：

1. 面板被 React 卸载时，**整棵子树都从 document 移除**——容器一起被移除，webview 随之销毁，`display:none` 根本没机会生效。
2. 换"卸载前搬走"也不行：主进程给每个 lease 只批一次 attach——
   ```js
   // lib/main.js:18153-18160
   owner.on("will-attach-webview", (event, preferences, params) => {
     const lease = this.leases.get(id)
     if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
       event.preventDefault(); return
     }
     lease.attached = true
   ```
   webview 元素在 DOM 里移动会触发 detach → attach；第二次 attach 时 `lease.attached` 已为 true → **直接 preventDefault**。结果是"搬走即报废"，而且旧 guest 已被销毁。

**修正方案**：**webview 一次都不能移动、不能脱离 document。**

- 容器由插件创建后**永久挂在一个稳定位置**，优先挂 `shell.overlay`（frame 级常驻浮层，整个会话只挂一次），退路是 `document.body` 下的 `position: fixed` 层；
- 面板组件只提供一个**占位 div**，不承载 webview；容器用 `getBoundingClientRect()`（+ `ResizeObserver` + `window.resize`）跟随占位 div 的几何；
- 未选中时**只改可见性**（`visibility:hidden; pointer-events:none`）并把容器移出可视区，**不移除、不改父节点**；
- 选中时同步几何并显示。

**影响**：布局跟随变成插件的责任（侧栏折叠、右栏全屏、窗口缩放、设置弹窗遮挡都要处理），实现复杂度明显上升；但这是唯一能保住 guest 的做法。

### D2 「快照能救回登录」还缺一个关键实测

我确认了 DeepSeek 的 token 走 localStorage（依据：`create("userToken")` 存储句柄 + 站点有 `storage` 事件监听 `e.key === 'userToken'`），但**没有实测**：

- 登录后 localStorage 里到底有哪些键（键名可能比 `userToken` 更多，比如设备标识的键名未知）；
- `__appKit_userInfo` 是否必须与 token 成对；
- 值是不是被包了一层编码（对我方无影响——我们原样拷贝字符串，但要知道键的数量和体积）。

**修正**：M0 第一件事就是打印 `Object.keys(localStorage)`（**只打键名，不打值**）核对，不要靠猜的键名写死逻辑；快照继续全量抓，不做白名单。

### D3 设备指纹风险被低估，直接影响「换机器」

从 bundle 里看到 DeepSeek 用了**数美 `SMSdk.getDeviceId()`** 做风控（`main.b2127178f0.js` 中 `window.SMSdk.getDeviceId`），这是**环境指纹**，不是 localStorage 里的字符串，搬不走；另有 `auth_token/check_device` 接口。

- **同机重启**：环境指纹一致，快照回填大概率无感；
- **换机器导入 token**：指纹变了，可能触发二次验证甚至直接失效。

**修正**：
- 把「跨机器迁移登录态」**从 V1 范围里删掉**，明确「每台机器各自登录一次」；
- 我上一轮说的「在裸机上验证出来的结论，换任何机器都成立」**说过头了**，只对"同机重启"成立；
- 若以后做导出/导入，只能承诺「站点表可迁移；登录态迁移可能要求重新验证」。

### D4 快照抓取时机覆盖不全

原计划：`did-finish-load` 后 3s、面板切走、`visibilitychange`、60s 轮询。缺的是：**用户登录完立刻从托盘退出**（几秒内）会抓不到。

**修正**：登录后尽快抓（`did-finish-load` 后 1.5s）+ 20s 低频轮询 + 面板切走 + `visibilitychange` + 设置页一个「立即保存登录态」手动按钮兜底。

### D5 分区 key 只适合单站，多站规则没定死

固定 key `ai-webapps:deepseek` 在 V1（只有一站）没问题，但多站时有两种语义：

- **一个总 key**：所有站点共享同一个内存分区（不同源之间仍隔离，同域会互见 cookie）；优点是分区数量不膨胀、进程少；
- **每站一个 key**：每站一套内存 session，隔离更彻底，进程更多。

**修正**：spec 里必须写死。建议**一个总 key**（`ai-webapps:shared`），并在文档说明「同域多站会共享 cookie」，V1 用 `ai-webapps:deepseek` 亦可，但加站时要一次决定。

### D6 面板选中态是否跨重启保留，未验证

layout 源码里没搜到持久化（`stores.ts`/`service.ts` 无 localStorage），倾向「不保留」；但没实际验证。若保留，重启后会直接落在站点面板，与「启动不抢主面板」冲突。

**修正**：启动时读 `ctx.layout.panelInfo`，若 `activePanelId` 是我们的 id 就 `selectPanel(null)`；并把这行为写进 M0 验收。

---

## 二、我之前说「已验证」，其实要降级的话

| # | 我原来的口径 | 实际 | 应改成 |
|---|---|---|---|
| F1 | 桥「插件能拿到」 | 源码可证：preload 只在 `dsh-app://app` 主帧给全量 API，主窗口就是该地址；**没运行时验证** | 高置信，待运行时确认 |
| F2 | `webview.executeJavaScript` 可用 | Electron 有此方法，本版本行为未实测 | 待验 |
| F3 | 关窗口=隐藏到托盘 | **已确认**：`main.js:21470-21482` close → preventDefault → hide | 保持"已验证" |
| F4 | Gemini/Grok 是 HttpOnly | 常识判断，本机未测 | 标"判断，未实测"（V1 不涉及） |
| F5 | 千问 token 可快照 | 只读了 bundle 片段 | 标"初步，未实测；V1 不涉及" |
| F6 | `settings.section` 第三方可用 | 契约在，未实测注册 | 待验 |
| F7 | 左栏行默认显示 | 依赖「`sidebar.panellist.actions` 当前为空」这一现状；将来若 DSH 注册了 actions，行会被收进 More 菜单，需手动钉住 | 加一句限制说明 |
| F8 | 「裸机验证结论换机器也成立」 | 对同机重启成立，对**换机迁移**不成立（见 D3） | 撤回 |

**另一个文档级错误**：spec 里引用的 `lib/main.js:18109`（persist 分支）在 asar 还原后**已经不存在**——那行是 v1 补丁。文档应改成"历史事实：还原前曾存在"，否则以后照着看会找不到。

---

## 三、遗漏的工程细节（M0/M1 必须补）

- **E1 guest 崩溃后必须重新 acquire**：`render-process-gone`/`destroyed` 时主进程已删除该 lease，**不能复用**，要释放+重新 `acquire`+重建 webview（新 lease）。
- **E2 插件重载/卸载必须清理**：释放 lease、销毁容器、清 interval；否则重装插件会留下孤儿 guest 常驻。
- **E3 一个 lease 只能 attach 一次**（同 D1）：页面刷新/崩溃重建都要新 lease。
- **E4 权限全拒的可见后果要提示**：下载、麦克风/摄像头、通知、`navigator.clipboard.readText`，以及 `disableDialogs: true` 导致站点的 `alert/confirm` 被吞。
- **E5 弹窗路径**：`onOpenRequested` 只在 `allowpopups` + 目标为 http(s) 时触发；`about:blank` 弹窗会被 deny → 某些 OAuth 会静默失败，要给出提示。
- **E6 调试手段**：打包版 guest 的 `devTools` 是关的，只能靠 `webview` 的 `console-message` 事件把 guest 日志转发到宿主 console。M0 必须加这条，否则现场排障抓瞎。
- **E7 快照可见性**：设置页显示「已保存 N 个键 / 时间」，不显示值；提供清除。同时说明：同页其它插件理论上可读（同一 localStorage 域）。
- **E8 Web 版兼容**：插件在非 Desktop profile 也会被加载，必须优雅降级为"此面板需要桌面端"，不能抛错。
- **E9 z-index/遮挡**：固定层要低于设置弹窗与 toast，且设置弹窗打开时建议直接隐藏容器。
- **E10 幂等**：重复选中同一面板不得重复 acquire；容器单例。
- **E11 升级降级**：`protocolVersion` 变化时给出明确文案，而不是白屏。

---

## 四、事实清单重列（按可信度分档）

### A. 已实测/源码可证（可直接依赖）

1. `app.asar` 已还原为官方原版（sha256 `5EC8ACD9…`，209,083,008 B）。
2. preload 只在 `dsh-app://app` 主帧暴露完整 `dshDesktop`（含 `browser`，`protocolVersion: 1`）；方法仅 `acquire/release/onOpenRequested`。
3. `will-attach-webview` 校验 lease + partition，**每个 lease 只批一次**。
4. 默认分区内存级；`persist:` 分支随还原已消失（文档需改注）。
5. 主面板 keyed slot 只渲染当前选中的 key；`AppFrame` 渲染 `.mainPanel`（flex column，flex:1，min-height:0）。
6. `sidebar.panellist` = 图标组件 + `id/order/label`，id 即 `main` 的 key；`settings.section` = `id/order/label` + 组件。
7. 关窗口 = 隐藏到托盘（`main.js:21470-21482`）。
8. DeepSeek：token 在 localStorage（`userToken`），请求 `Authorization: Bearer`；设备信息也在 localStorage；另有数美指纹与 `check_device`。
9. 三家站点禁 iframe（实测响应头）。
10. 本机代理 `127.0.0.1:6234`，DeepSeek/千问/Gemini 可达（Grok 403）。
11. Host 是独立 Node 进程，拿不到 Electron session。

### B. 高置信但未运行时验证（M0 要验）

1. 插件 client 半区真实拿到 `dshDesktop.browser`。
2. `<webview>` 能按 lease 创建并加载 chat.deepseek.com。
3. `executeJavaScript` 能读写 guest 的 localStorage。
4. 快照回填后 DeepSeek `check_device` 放行。
5. `settings.section` / `shell.overlay` 第三方注册可用。
6. 面板选中态是否跨重启保留。

### C. 未知 / 不可控

1. DeepSeek 是否对嵌入会话做更强风控（Turnstile 是否在 Electron 里通过）。
2. 换机器迁移 token 是否被要求重验（倾向会）。
3. DSH 升级是否会改 `protocolVersion` 或分区策略。
4. Grok 的 Cloudflare 是否放行（V1 不涉及）。

---

## 五、修正后的 V1 设计（重列）

```
[左栏行] sidebar.panellist(id='ai-webapps:deepseek', label='DeepSeek', 图标组件)
     │ 点击 → layout.selectPanel('ai-webapps:deepseek')
     ▼
[主面板] main(key='ai-webapps:deepseek')  ← React 可随时卸载，不承载 webview
     └─ 工具栏（名称/状态/刷新/浏览器打开/清登录） + 占位 div（只提供几何）
                                │ getBoundingClientRect + ResizeObserver
                                ▼
[常驻宿主] shell.overlay 中的单例容器（position:fixed，永不 reparent）
     └─ <webview name=lease partition=… src=about:blank#lease>
           ├─ 首次可见时 acquire → attach → loadURL
           ├─ guest 崩溃 → release + 新 lease + 重建
           └─ 快照：dom-ready 探测 → 需要则注入 + reload；20s/隐藏时抓取
[设置] settings.section(id='ai-webapps')：站点地址（只读）、登录保存状态、立即保存、清除
```

**明确不做（V1）**：站点增删/排序、登录态导出、Gemini/Grok、任何 `app.asar` 改动。

---

## 六、更新后的 M0 验收（6 条，比原来多 2 条）

1. 左栏出现 DeepSeek 行，点击后主面板被选中并渲染面板。
2. 桥可用、webview 加载 chat.deepseek.com 成功（含 `console-message` 转发可见）。
3. 能完成登录（手机/邮箱 + Turnstile）。
4. **切到会话再切回：不重载**（草稿/滚动保持），且 guest 进程未重建。
5. **key 名实核对**：登录后 `Object.keys(localStorage)` 里有 token 相关键（只打键名）。
6. 登录 → 托盘彻底退出 DSH → 重启 → 自动进聊天；启动时**不会**自动停在站点面板。

---

## 七、待确认（更新）

| # | 项 | 变化 |
|---|---|---|
| T5 | 保活方式 | **改**：从"面板内常驻"改为"shell.overlay 常驻容器 + 几何跟随"（D1） |
| T3/T4 | 快照存储与范围 | **保留**，但补：换机不迁登录态（D3）、值域先实测（D2） |
| T12（新） | 多站分区 key 规则 | 一个总 key 还是每站一个（D5），V1 先 `ai-webapps:deepseek` |
| T13（新） | 启动是否强制回会话面板 | 若选中态持久，启动时重置（D6） |
| T14（新） | 固定宿主挂 `shell.overlay` 还是 `document.body` | 优先 overlay（合规），失败再退 body |
| 其余 | T1/T2/T6–T11 | 不变 |

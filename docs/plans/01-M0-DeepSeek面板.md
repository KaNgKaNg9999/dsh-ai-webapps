# plans/01 — M0：DeepSeek 面板最小可装版

> 状态：✅ 完成（2026-11-26）｜类型：实施｜关联 commit/tag：—
> 用户定稿口径：「那就先按照deepseek去做，后面再适配别的」；T5/T12/T13/T14 按推荐（宿主挂 `shell.overlay`、总分区 key、启动强制回会话、每机各自登录一次）

## 前置条件（就绪检查）

- [x] 目标/范围/验收已明确（见下）
- [x] 相关设计文档已更新（`docs/reference/v1-deepseek-spec.md` / `architecture.md` / `product-brief.md`）
- [x] 无阻塞第一里程碑的未决项

## 未决（结构化）

- 无

## 目标

交付可安装的 `dsh-ai-webapps` bundle（V1 只做 DeepSeek），跑通 M0 六项验收：左栏行 → 主面板 webview → 登录 → 切面板不重载 → 快照键名核对 → 同机重启自动登录。

## 任务清单

- [x] A 生成 bundle 骨架：`package.json`（`dsh.bundle.patch` + `dsh.client{platform:'web',immediately:true,inject:[...]}`）、`cordis.patch.yml`（insert 本包）、`index.js`（Host 空壳）、`locale/{zh,en}.json`（含 `meta.title`/`meta.description`/`meta.detail`）、`icon.svg`、`docs/plugin/DETAIL.md`（草案已在库，M0 后转定稿）— 2026-11-26 完成
- [x] B 宿主与 webview 生命周期：`shell.overlay` 单例容器（`position:fixed`，永不 reparent）；占位 div 几何跟随（`getBoundingClientRect` + `ResizeObserver`）；`acquire→attach→loadURL`；`render-process-gone` 后 release + 新 lease 重建；`console-message` 转发（前缀 `[aiwa]`）；`[inert]` 出现时 blur + 隐藏（自 C 移入）；插件卸载时释放 lease/容器/计时器 — 2026-11-26 实现并真机验证：`acquire→attach(about:blank#lease)→dom-ready→loadURL→302 /sign_in→ready`，无闪烁无崩溃；期间修复 `protocolVersion` 层级与 `dom-ready` 重入自中断两处 bug（见 spec R14）
- [x] C 左栏与主面板注册：`sidebar.panellist`（图标组件 + `id='ai-webapps:deepseek'` + `label`）、`main`（`key` 同 id，工具栏四项：刷新 / 系统浏览器打开 / 复制链接 / 清除登录）；`ctx.layout.selectPanel(null)` 启动兜底 — 2026-11-26 完成；`[inert]` blur/隐藏挪到 B（C 阶段没有 guest 可 blur）；**真机：用户确认左栏 DeepSeek 行可见**（主面板工具栏与占位区未逐项核对）
- [x] D 登录快照：采集（`did-finish-load` 后 1.5s、隐藏、切走、20s 轮询、手动；仅已登录时写；单值 64KB 跳过、总量 512KB 截断）；回填（每 lease 一次 + 注入后 reload + 防循环 + `stale` 标记）；站点表 `dsh-ai-webapps.sites.v1` — 2026-11-26 实现；采集真机通过（快照 37KB、25 键含 `userToken`、cookie 209、20s 轮询更新）；回填重启验证通过；首次显示门控真机确认无未登录闪
- [x] E 设置页：`settings.section(id='ai-webapps')`，显示 URL、快照状态（键数/时间/是否 stale）、「立即保存」「清除已保存登录」— 2026-11-26 实现并真机验收通过：五张卡（面板位置/打开面板、站点地址+复制、登录快照（状态胶囊、保存时间、键数、cookie 条数、大小、跳过/截断、立即保存、清除）、桌面桥状态、已知限制）；保存按钮在面板未 ready 时禁用并写明原因；另注册 `settings.section.icon`（0.2.2 独立图标位）显示自绘鲸鱼图标
- [x] F 自检与安装：`node --check client.js` / `index.js`；`JSON.parse` 校验 manifest 与 locale；`install_bundle` 安装并在插件页确认行与图标 — 2026-11-26 自检与安装已完成（`application: applied`、行 `include:ai-webapps` active）；2026-11-27 补充核对：插件页「已安装插件」中可见 `DeepSeek 网页面板` 与鲸鱼图标，页面 console 的 `[aiwa]` 日志已由 V1 取证确认
- [x] V M0 六项验收（见下）真机跑通并回填结果 — 2026-11-26 通过：1 面板渲染；2 站点加载（`/sign_in` → 登录后 `/`；`console-message` 转发未目视）；3 手动登录成功（Turnstile 细节未记录）；4 切面板不重载；5 采集（25 键含 `userToken`，快照 37KB）；6 退出→重启自动登录且不自动停在站点面板。缺口：2 的 console 转发、`render-process-gone` 重建未目视

## 不在范围

- 多站（千问）、站点增删排序、登录态导出/导入、Gemini / Grok、任何 `app.asar` 改动、登录态跨机迁移。

## 计划外变更（如实记录）

- 2026-11-26：A 顺带加入最小 `client.js` 探测骨架——`package.json` 的 `dsh.client` 必须有 client 入口才能安装；该文件只打印 `[aiwa]` 桥状态，不含面板逻辑（面板在 C，webview 在 B）。
- 2026-11-26：`locale/*.json` 的 `meta.detail` 指向 `docs/plugin/DETAIL.md`（文本详情页）。dsh-doc 的 `plugin-details.md` 建议详情页只放一张配图、其余信息进 `meta.description`；本项目按已定稿设计保留文本详情页，功能/用法/限制同时写进 `meta.description`。
- 2026-11-26（B）：T13 启动守卫改为「每页运行首次 apply 才执行」（`globalThis.__aiwaStartupGuarded`）——插件 HMR/重载不应把正在看面板的用户踢回会话；验收 6 的语义不变。另经源码确认，桥调用契约（`acquire→{lease,partition}`、`about:blank#lease` + `partition` 引导、`dom-ready` 后才 `loadURL`）已回填 `docs/reference/v1-deepseek-spec.md` 与 `architecture.md`。
- 2026-11-26（D 后）：T6 修订——重启回填时不再接受「未登录闪」。宿主在 guest 首次加载完成且回填落定前保持隐藏、显示加载卡片；首次显示后整页导航保持可见。起因：重启实测回填成功，但先露出 `/sign_in` 再跳到聊天页。
- 2026-11-26（D 后）：加载卡视觉打磨（M1 提前）——品牌光晕 + 细点阵氛围、三步状态条（连接 / 恢复登录 / 加载界面）、底部流光、卡片入场与 guest 淡入，`prefers-reduced-motion` 降级；新增 `restoring` / `hasSnapshot` 状态，清除登录改走控制器。真机确认保留。
- 2026-11-26（E）：计划只写 `settings.section`（`id/order/label` + 组件），实现时按 dsh 0.2.2 的槽位事实补注册了 `settings.section.icon`（独立导航图标位，`{name, id}` + 组件收 `{size}`；参照 `dsh-mcp-connector` / `dsh-mobile-plugin` / `dshmarket` 的注册形态），宿主不声明该槽时 `inject` 只是等待。设置页样式全部自绘（`--dsw-alias-*` token），不引用宿主 CSS Module 类名。

## 防影响承诺

- 不修改 `app.asar`、DSH 安装目录、profile 的 `package.json` / `cordis.patch.yml`；安装/卸载只走插件管理器。
- 运行时只写 DSH 页面 localStorage 的两个键，不写其它站点数据。
- 回滚：插件管理器移除 `dsh-ai-webapps` 即可；残留仅 localStorage 两个键（设置页可清）。

## 验收标准

1. 左栏出现 DeepSeek 行；点击后主面板选中并渲染工具栏与占位区。
2. webview 成功加载 `https://chat.deepseek.com/`，宿主 console 可见 `[aiwa]` 转发日志。
3. 能完成登录（手机/邮箱 + Turnstile）；若 Turnstile 受阻，能切换 `webview.setUserAgent(纯 Chrome UA)` 后重试成功，或记录为站点侧限制。
4. 切到会话再切回：不重载（草稿/滚动保持），guest 未重建（日志可见同一 lease）。
5. 登录后打印 `Object.keys(localStorage)`（仅键名）核对 token 相关键，并成功采集快照。
6. 托盘彻底退出 → 重启：自动登录（无需手动输入），且启动不会自动停在站点面板（回会话）。

> 运行时未知项（桥是否真的可用、`executeJavaScript` 是否可读写 guest storage、`shell.overlay` 常驻性与层级、回填后 `check_device` 是否放行、选中态是否跨重启保留）在本计划的 V 步一次性证伪或证实；任何一项失败都回写到 `docs/reference/v1-deepseek-spec.md` 与 `architecture.md`。

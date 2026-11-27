# 进程快照

> 格式：倒序，最新在最上；新条目插到本说明块紧下方。每条 ≤5 行：日期 ｜ 批次 ｜ 主题，加 2–3 条要点（完成/文件/设计变更/下一步）。
> 会话结束协议追加，跨会话续接的唯一进度源。条数 >25 时，第 26 条及更早的整段剪切至 `process-archive.md` 顶部。

## 2026-11-27 ｜ 计划02 ｜ M1 五项验收全部通过（含 2 处修复）
- 手段：`--remote-debugging-port=9222` + 新增 `tools/cdp-eval.mjs`（CDP 执行 JS/抓 console）；崩溃注入改用「外部杀 guest 渲染进程」，用 CPU 时间增量精确认进程
- 结论：V5 通过（口径修正：只有设置弹窗与右键菜单能与 guest 同屏）；V1 通过（warn/error/前缀/站点日志全中）；V3 通过；V4 通过；V2 登录成功放行（无 Cloudflare Turnstile，仅站点自带的图片选择验证码），R5 不实现
- 修复：`validateBackfill` 补 `login` 判据（坏 token 键仍存在会误判成功）；`maybeStart` 放行 `crashed`（面板切走时崩溃后永久卡死）+ 重建用尽的 `stopped` 文案与按钮
- 副作用：`.dsh-pilot/` 截图会落进工作区，已加 `.gitignore`；清掉遗留键 `debug.v1`/`snapshot.backup.v1`；`cookie=209` 实为字符串长度非条数
- 状态：`client.js` 已改待提交；下一步 commit → M1 余项（`node --test`、DETAIL 定稿）

## 2026-11-26 ｜ 计划02 ｜ M1 缺口验收清单落地（会话结束）
- 新增 `docs/plans/02-M1-缺口验收清单.md`：执行序 V5 弹窗层级 → V1 console 转发 → V3 stale 降级 → V4 崩溃重建 → V2 Turnstile，每项含操作/通过判据/失败处置与结果记录表；README、spec §10 已交叉引用
- 口径：下一会话按清单执行，有问题当场修并重验；崩溃注入首选 `chrome://crash`，被拦则转 `node --test` 合成状态机测试
- 状态：本轮只落文档、未改代码；最近提交 `a3a2216`（M0-E）；本计划相关文档未提交

## 2026-11-26 ｜ 计划01 ｜ M0-E 设置页完成（真机验收通过）
- 实现：`settings.section(id='ai-webapps')` 五张卡（面板位置/打开面板、URL+复制、登录快照状态+立即保存+清除、桌面桥、已知限制）；另注册 `settings.section.icon`（0.2.2 图标位）
- 控制器新增 `snapshotInfo()`（键数/cookie 条数/大小/stale）与带原因的 `saveSnapshot()`；删掉两个死文案键 `bridgeReady`/`settingsStatus`
- 校验：`node --check` 通过；离线冒烟通过（模块加载 / 5 个槽位形状 / zh-en 文案键齐全，脚本为临时件未入库）
- 真机：用户验收通过（设置项与鲸鱼图标、立即保存、清除均正常）；M0 全部任务完成，plans/01 标 ✅

## 2026-11-26 ｜ 收尾 ｜ V 验收基本通过，停在 E 前
- 真机：切面板不重载（V4）与再次退出→重启→打开自动登录（V6）均通过；回填无未登录闪
- V 汇总：1/2(加载)/3/4/5/6 通过；2 的 console 转发、3 的 Turnstile 细节、崩溃重建未目视
- 状态：A/B/C/D 完成，E（`settings.section`）未做；最近提交 c662242；工作区干净
- 下次：E 设置页（URL/快照状态/立即保存/清除）→ M1 余项

## 2026-11-26 ｜ 计划01 ｜ 加载卡视觉打磨（M1 提前）
- UI：品牌光晕 + 细点阵氛围、三步状态条（连接/恢复登录/加载界面）、底部流光、卡片入场与 guest 淡入；`prefers-reduced-motion` 降级
- 状态：新增 `restoring` / `hasSnapshot`；清除登录改走 `controller.clearLogin()` 并同步；不再显示「桌面桥：可用」噪声
- 真机：用户确认「可以，保留这版」；D + 视觉改动仍未提交

## 2026-11-26 ｜ 计划01 ｜ 回填验证 + 消除未登录闪
- 真机：彻底退出→重启自动登录成功（D 回填生效，V 验收 6 通过）；现象是先露 `/sign_in` 再跳到聊天页
- 修复：guest 首次加载完成且回填落定（probing/injecting/injected）前保持隐藏、显示加载卡片；首次显示后整页导航保持可见
- 设计：T6 由「接受一次未登录闪」修订为「不出现未登录闪」（spec §0/§4 已回填）
- 待确认：再重启一次确认无闪；D 改动仍未提交

## 2026-11-26 ｜ 计划01 ｜ M0-D 登录快照（采集真机通过）
- 新增：`client.js` ~1150 行——`sites.v1`/`snapshot.v1` 结构、guest 探针/采集/注入脚本、采集时机（ready+1.5s/切走/隐藏/20s/手动）、每 lease 一次回填 + 校验 + stale 通知
- 真机：快照 37KB、25 键（`userToken` 等）、cookie 209，20s 轮询更新；日志只打键名，不打印值
- 未验：回填注入待重启（V 验收 6）；`sites.v1` 落盘未直接取证（LevelDB 压缩块），E 设置页会读它
- 下一步：E 设置页（URL/快照状态/立即保存/清除），再跑 V 3/4/6

## 2026-11-26 ｜ 计划01 ｜ M0-B 完成（真机打通）
- 回填：spec §2.A/§4/R1/R14 + architecture 记录桥契约、overlay 内联 pointer-events、`dom-ready` 只发一次目标导航
- 实现：`client.js` 742 行——`shell.overlay` 宿主、占位几何跟随、acquire→attach→loadURL、`[aiwa][guest]` console 转发、崩溃重建（3 次上限）、`[inert]` 隐藏、卸载释放 lease
- 真机：`acquire→attach(about:blank#lease)→dom-ready→loadURL→302 /sign_in→ready`，无闪烁；修复 `protocolVersion` 层级（在 `dshDesktop` 上）与 `dom-ready` 重入自中断循环
- 取证方式：临时诊断写 localStorage + 读 LevelDB（含 UTF-16 值）；诊断已移除；V 部分回填（1/2 通过）；下一步 D 登录快照

## 2026-11-26 ｜ 收尾 ｜ M0-A/C 完成，暂停在 B 前
- 验证：用户确认左栏 DeepSeek 行可见（C 真机通过）；主面板工具栏、插件页图标、页面 console 的 `[aiwa]` 日志未逐项核对
- 状态：A/C 完成；F 安装 applied（`include:ai-webapps` active）；B/D/E/V 未做；计划 01 仍 🟡；最近提交 `cf437f9`
- 下次开工顺序：B（`shell.overlay` 单例 + 占位几何跟随 + acquire/attach/loadURL + `render-process-gone` 重建 + `[inert]` blur/隐藏 + 卸载清理），随后 D 快照、E 设置页、V 六项验收

## 2026-11-26 ｜ 计划01 ｜ M0-C 左栏入口与主面板
- 新增：`client.js` 246 行——`sidebar.panellist`（`ai-webapps:deepseek`，order 50，`label: () => t('panel')`）、`main` keyed 面板（工具栏四项 + 占位区 + 桥状态行）、`ctx.locale.register` zh/en、启动 `selectPanel(null)` 兜底（T13）
- 取舍：`[inert]` blur/隐藏移到 B（C 阶段没有 guest）；刷新/系统浏览器动作留 `controller.onRefresh/onOpenExternal` 钩子给 B 覆盖
- 校验：`node --check` 通过；未提交；**未真机验**（需刷新页面后看左栏 DeepSeek 行与主面板占位区）

## 2026-11-26 ｜ 计划01 ｜ M0-A bundle 骨架
- 新增：`package.json`（`dsh.bundle.patch` + `dsh.client{platform:web,immediately,inject:[locale,ui-layout,ui-sidebar]}` + exports/files）、`cordis.patch.yml`（insert `ai-webapps`）、`index.js`（Host 空壳）、`client.js`（仅 `[aiwa]` 桥探测）、`locale/{zh,en}.json`、`icon.svg`（#4D6BFE 圆角底 + 白鲸）
- 校验：`node --check client.js/index.js` 通过；package/locale JSON 与 icon SVG 可解析；exports 与 files 路径全部存在；未安装、未提交
- 契约核对：`sidebar.panellist`（root list，owner {size,active,only}）、`main` keyed slot + `ctx.layout.selectPanel(null)`、`shell.overlay` 覆盖整帧、`settings.section` 由 dsh-client-ui-settings 声明
- 下一步：刷新 DSH 页面确认 `[aiwa] bridge=present protocol=1` 与插件页行/图标；随后开工 C（左栏行 + 主面板工具栏）

## 2026-11-26 ｜ 初始化 ｜ 版本控制落地（git init）
- 建仓：`git init -b main`（无远端）；新增 `.gitignore`（忽略 `node_modules/`、`*.log`、`package-lock.json`、本机残留）与 `.gitattributes`（统一 LF，避免 Windows 检出噪声）
- 同步：`docs/agent/project.md`（分支/红线）、`docs/CODING.md`（§2 命令表 + §3 分支与提交 + 红线3）改为「已建仓，提交仍需确认」
- 提交：首个提交 `chore: 初始化仓库与项目文档基线`（16 文件，基线可回滚）→ 下一步开工计划 01 任务 A

## 2026-11-26 ｜ 初始化 ｜ 项目开发结构落地
- 生成：`AGENTS.md` 指针、`docs/agent/project.md`、`docs/CODING.md`、`docs/memory/`、`docs/reference/{product-brief,architecture,overview,v1-deepseek-spec,ai-webapps-feasibility,ai-webapps-review}.md`、`docs/plans/{README,00,01}`
- 事实：纯 JS 无构建 client bundle；命令见 `docs/CODING.md`；无 git；红线=不改 DSH 本体 / 不写明文凭据
- 设计：V1 只做 DeepSeek；主面板 webview + `shell.overlay` 单例宿主（永不 reparent）；登录态用 localStorage/cookie 快照（每 lease 回填一次、失败标 stale）
- 下一步：按 `docs/plans/01-M0-DeepSeek面板.md` 生成 bundle 并跑 M0 六项验收

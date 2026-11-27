# CHANGELOG

## 1.0.0 — 2026-11-27

V1 功能闭环：DeepSeek 网页版内嵌面板 + 登录快照 + 应用内诊断。

### 新增

- 设置页「诊断」卡：阶段、容器 lease、站点主机、登录回填、崩溃次数、快照状态，最近 100 条日志（环形缓冲 200 条），「复制诊断信息」「清空日志」。
- 统一日志入口 `log()`：console 与内存缓冲双写；guest `console-message` 转发入缓冲。
- 日志脱敏：URL query、`token`/`password`/`api_key` 等键值、`Authorization`/`Cookie` 头、`user_unique_id`/`web_id` 与 UUID（含嵌在键名里的）→ `***`；超长行截断。
- 提示分级：失败提示 3.5s + 错误色，成功提示 2.2s；常驻 `role="status" aria-live="polite"`。
- `node --test` 测试套件（41 条断言，零依赖）：文案键集、脱敏、guest 三段脚本、回填判定、崩溃重建门、格式化与小工具。
- `tools/cdp-eval.mjs`：`--target` 选 guest、`net`/`watch` 抓网络（只打方法/状态/路径，`--body` 只回白名单字段）、`crash` 注入 `Page.crash`。
- 插件详情页定稿、README、术语表（`CODING §4.1`）。

### 修复

- `validateBackfill` 补 `login` 判据：坏 token（键在、值坏）不再被误判为恢复成功（M1）。
- `maybeStart` 放行 `crashed`：面板切走时崩溃不再永久卡在「正在重建」；次数用尽改文案并给手动刷新按钮（M1）。
- 设置页「面板未加载」提示不再误用「未能保存」文案。
- `settingsLimit2` 与实际行为对齐：站点弹窗改为在系统浏览器打开。

### 验证

- M0 六项、M1 五项真机通过（见 `docs/plans/01`、`02`）。
- 收尾取证：回填后 `POST /api/v0/users/auth_token/check_device → 200 {"code":0}`；面板选中态不跨重启持久（DSH 布局状态 reload 即重置）。
- 中文/英文两套 UI 实测无溢出；诊断复制不含凭据与稳定标识。

## 0.1.0 — 2026-11-26

- bundle 骨架（manifest / patch / locale / icon / Host 空壳）。
- 左栏入口与主面板工具栏。
- `shell.overlay` 常驻 webview 宿主：切面板不重载。
- 登录快照采集/回填、stale 降级、崩溃重建。
- 设置页与加载卡视觉。

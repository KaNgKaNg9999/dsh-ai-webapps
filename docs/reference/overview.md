# dsh-ai-webapps — 总览（设计事实源）

> 状态：初稿（2026-11-26）｜最后更新：2026-11-26｜适用版本：DSH Desktop 0.2.2-rc.5
> 本文件是设计索引；代码偏离时先改 `docs/reference/` 对应文档，再改代码。

## 相关文档

- 产品简报：`product-brief.md`（定稿）
- 架构：`architecture.md`（定稿）
- V1 设计事实源：`v1-deepseek-spec.md`（当前，含 T1–T14 决策与 M0 验收）
- 可行性评估：`ai-webapps-feasibility.md`（历史，结论已被 spec 取代）
- 第一轮严格评审：`ai-webapps-review.md`（历史，D1–D6/R1–R13 的出处）

## 定位

- 是什么：DSH Desktop 插件；左栏一个站点行 → 主面板全宽内嵌网页版 AI 聊天（V1 只做 DeepSeek）；切面板不重载；登录一次后同机重启保持登录。
- 不是什么：通用浏览器、模型/API 接入替代、登录态跨机迁移工具、DSH 本体修改方案。

## 技术栈与目录

纯 JS 无构建 DSH bundle（React 由宿主提供），依赖公开 Slot 契约与 `globalThis.dshDesktop.browser`（`protocolVersion: 1`）。

```
dsh-ai-webapps/
├─ package.json          # name=dsh-ai-webapps；dsh.bundle.patch + dsh.client
├─ cordis.patch.yml      # 插入本包一行
├─ index.js              # Host 空壳：export function apply() {}
├─ client.js             # Client 全部实现（注册 + 宿主 + 快照）
├─ locale/{zh,en}.json   # meta.title / meta.description / 面板文案
├─ icon.svg              # 自绘图标
├─ docs/plugin/DETAIL.md # 插件详情页正文
└─ docs/…                # 本目录（工程文档）
```

## 关键决策（含被否方案）

| 决策 | 理由 | 被否方案 |
|---|---|---|
| 主面板 `<webview>`（B 路线） | 满宽、站点化、切走不重载 | 右侧栏 Browser；iframe（站点禁 frame） |
| 会话快照持久化 | 零应用改动、跨重启保持 | 改 `app.asar` 的 `persist:` 分区（v1 事故） |
| `shell.overlay` 常驻宿主 | 每 lease 只 attach 一次，webview 不能移动 | 面板内常驻 / 搬 DOM（会被拒） |
| 总分区 key `ai-webapps:shared` | 规则简单、进程少 | 每站一 key |
| 启动强制回会话 | 避免"DSH 好像坏了" | 恢复上次面板 |

## 外部依赖与边界

- 依赖 DSH 内部桥 `dshDesktop.browser`：可能随版本变化 → 降级提示 + 升级回归。
- 依赖站点自身存储形态（DeepSeek token 在 localStorage）：站点改版需重新核对，不改站点、不代理流量。
- 运行时只写本机页面 localStorage 两个键；不写 profile、不写安装目录。

## 未决问题

- [ ] 无（真机验证项见 `docs/plans/01-M0-DeepSeek面板.md`）

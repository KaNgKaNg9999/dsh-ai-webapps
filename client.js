/**
 * Client 半区（M0-B）：左栏入口 + 主面板工具栏 + 常驻宿主 webview。
 * - 宿主：`shell.overlay` 单例容器，`position:fixed`，永不 reparent（每个 lease 只能 attach 一次）。
 * - 占位 div 只提供几何；隐藏只改 visibility/pointer-events 并移出视口，guest 不重建。
 * - 快照采集/回填在 M0-D，设置页在 M0-E（`settings.section` + `settings.section.icon`）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ai-webapps',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useMemo, useRef, useState } = React;

    const NS = 'ai-webapps';
    const PANEL_ID = 'ai-webapps:deepseek';
    const SITE_URL = 'https://chat.deepseek.com/';
    const WORKSPACE_KEY = 'ai-webapps:shared';
    const SNAPSHOT_KEY = 'dsh-ai-webapps.snapshot.v1';
    const SITES_KEY = 'dsh-ai-webapps.sites.v1';
    const SITE_ID = 'deepseek';
    const SNAPSHOT_SINGLE_LIMIT = 64 * 1024;
    const SNAPSHOT_TOTAL_LIMIT = 512 * 1024;
    const COLLECT_DELAY_MS = 1500;
    const POLL_INTERVAL_MS = 20000;
    const SITE_DEF = { id: SITE_ID, name: 'DeepSeek', url: SITE_URL, order: 0, enabled: true };
    const HIDDEN_TRANSFORM = 'translateX(-200vw)';
    const CRASH_RESTART_DELAY_MS = 600;
    const MAX_CRASH_RESTARTS = 3;
    const LOG_LIMIT = 200;
    const LOG_SHOW = 100;
    const LOG_LINE_MAX = 240;
    const LOG_HEADER_SECRET = /(^|\n)([ \t]*(?:authorization|proxy-authorization|set-cookie|cookie)[ \t]*:[ \t]*)[^\n]*/gi;
    const LOG_SENSITIVE = /\b(token|userToken|access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|session[_-]?id|user[_-]?unique[_-]?id|web[_-]?id|device[_-]?id)\b(["']?\s*[=:]\s*["']?)([^"'\s,;&]+)/gi;
    const LOG_QUERY_PAIR = /([?&][\w.-]+=)[^&\s]+/g;
    const LOG_UUID = /(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f])/gi;

    /**
     * 诊断用的脱敏：URL query 值、敏感键值与 Authorization/Cookie 头打码；UUID（含嵌在键名里的用户标识）打码；过长行截断。
     * 只作用于内存缓冲与复制出口，console 输出保持原样。
     */
    function redactLog(value) {
      const text = typeof value === 'string' ? value : String(value);
      const masked = text
        .replace(LOG_HEADER_SECRET, (match, lead, prefix) => lead + prefix + '***')
        .replace(LOG_QUERY_PAIR, '$1***')
        .replace(LOG_SENSITIVE, (match, key, separator) => key + separator + '***')
        .replace(LOG_UUID, '***');
      return masked.length > LOG_LINE_MAX ? masked.slice(0, LOG_LINE_MAX) + '…' : masked;
    }

    /** 环形日志缓冲：内存态，随插件卸载丢弃；条数上限之外丢最旧。 */
    function createLogRing(limit) {
      const items = [];
      return {
        push(level, scope, text) {
          items.push({ ts: Date.now(), level, scope, text: redactLog(text) });
          if (items.length > limit) items.splice(0, items.length - limit);
        },
        list(count) {
          const from = typeof count === 'number' && count > 0 ? Math.max(0, items.length - count) : 0;
          return items.slice(from);
        },
        clear() {
          items.length = 0;
        },
      };
    }

    const logRing = createLogRing(LOG_LIMIT);

    /** 把 fmt + args 拼成一行；支持 %s/%d/%i/%f/%o/%O/%% 与 Error/对象。 */
    function stringifyLogArg(value) {
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.message;
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      try {
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      } catch (error) {
        return String(value);
      }
    }

    function formatLog(fmt, args) {
      if (typeof fmt !== 'string') return [fmt].concat(args).map(stringifyLogArg).join(' ');
      if (!args.length) return fmt;
      let index = 0;
      const text = fmt.replace(/%[sdifOo%]/g, (token) => {
        if (token === '%%') return '%';
        if (index >= args.length) return token;
        return stringifyLogArg(args[index++]);
      });
      if (index >= args.length) return text;
      return text + ' ' + args.slice(index).map(stringifyLogArg).join(' ');
    }

    /**
     * 插件内唯一日志入口：同时写 console 与环形缓冲。
     * 传入的文案已带 `[aiwa]` 前缀时不再重复添加；`[aiwa][guest]` 记为 guest 来源。
     */
    function log(level, fmt, ...args) {
      let text = formatLog(fmt, args);
      if (text.indexOf('[aiwa]') !== 0) text = '[aiwa] ' + text;
      const scope = text.indexOf('[aiwa][guest]') === 0 ? 'guest' : 'host';
      const method = level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log';
      try {
        const write = console[method];
        if (typeof write === 'function') write.call(console, text);
      } catch (error) {
        /* console 不可用时只留缓冲 */
      }
      logRing.push(method, scope, text);
    }

    function formatClock(ts) {
      const date = new Date(ts);
      const pad = (value) => String(value).padStart(2, '0');
      return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    }

    /** 快照里 cookie 的条数（按 `;` 分段，空段不算）。 */
    function countCookies(cookie) {
      if (typeof cookie !== 'string' || cookie === '') return 0;
      return cookie.split(';').filter((part) => part.trim() !== '').length;
    }

    /** 回填校验判定：有 token 且不在登录路径才算恢复成功。 */
    function probeVerdict(probe) {
      return probe && probe.token && !probe.login ? 'valid' : 'stale';
    }

    /** 有 token 却仍在登录路径：站点可能还在跳转，给一次复核机会。 */
    function needsProbeRetry(probe) {
      return !!(probe && probe.token && probe.login);
    }

    /** 崩溃后是否重建：不可见/已释放时跳过，超过上限则停手。 */
    function decideCrashRestart({ disposed, active, suspended, crashes, max }) {
      if (disposed || !active || suspended) return 'skip';
      return crashes > max ? 'stop' : 'restart';
    }

    /** maybeStart 的门（M1 修复的 `crashed` 放行与重建上限都在这里）。 */
    function shouldStart({ disposed, starting, webview, phase, active, suspended, hasRect, bridgeReady, crashes, max }) {
      if (disposed || starting || webview) return 'skip';
      if (phase !== 'idle' && phase !== 'crashed') return 'skip';
      if (!active || suspended || !hasRect) return 'skip';
      if (!bridgeReady) return 'unavailable';
      if (phase === 'crashed' && crashes > max) return 'stop';
      return 'start';
    }

    /** 复制诊断信息：只含状态、键数与已脱敏日志，不含任何凭据值。 */
    function buildDiagnosticReport(diag, entries) {
      const lines = ['[aiwa] diagnostics'];
      lines.push('phase=' + diag.phase + ' lease=' + (diag.lease || '-') + ' host=' + (diag.host || '-')
        + ' crashes=' + String(diag.crashes) + ' backfill=' + diag.backfill + ' bridge=' + diag.bridge);
      lines.push('snapshot=' + (diag.hasSnapshot ? (diag.stale ? 'stale' : 'valid') : 'none')
        + ' keys=' + String(diag.keys) + ' savedAt='
        + (diag.savedAt ? new Date(diag.savedAt).toISOString() : '-'));
      lines.push('--- logs (last ' + String(entries.length) + ') ---');
      for (const entry of entries) lines.push(formatClock(entry.ts) + ' [' + entry.level + '] ' + entry.text);
      return lines.join('\n');
    }

    const zh = {
      panel: 'DeepSeek',
      title: 'DeepSeek 网页',
      refresh: '刷新',
      openExternal: '在系统浏览器打开',
      copyLink: '复制链接',
      clearLogin: '清除登录',
      copied: '链接已复制',
      copiedFailed: '复制失败，请手动复制地址',
      cleared: '已清除本机保存的登录',
      placeholderTitle: 'DeepSeek 网页面板',
      placeholderHint: '内容区由常驻宿主承载；切换面板不会重载。',
      starting: '正在准备网页容器…',
      loading: '正在加载 DeepSeek…',
      restoring: '正在恢复登录…',
      stepConnect: '连接网页容器',
      stepRestore: '恢复登录',
      stepLoad: '加载页面',
      failed: '页面加载失败',
      crashed: '页面已崩溃，正在重建…',
      crashedStopped: '自动重建已停止，请手动刷新',
      retry: '刷新重试',
      loginStale: '登录已失效，请重新登录',
      bridgeMissing: '桌面桥：不可用（需要 DSH 桌面端）',
      bridgeMismatch: '桌面桥：协议版本不符',
      protocol: '协议',
      settingsNav: 'DeepSeek 网页',
      settingsTitle: 'DeepSeek 网页面板',
      settingsDesc: '把 DeepSeek 网页版放进主面板：切面板不重载，登录一次后本机重启保持登录。',
      settingsOpen: '打开面板',
      settingsTarget: '面板位置',
      settingsTargetValue: '左栏「DeepSeek」行 → 主面板',
      settingsSite: '站点',
      settingsUrl: '地址',
      settingsCopy: '复制地址',
      settingsSnapshot: '登录快照',
      settingsStatusSaved: '已保存',
      settingsStatusMissing: '未保存',
      settingsStatusStale: '已失效',
      settingsSavedAt: '保存时间',
      settingsKeys: 'localStorage 键',
      settingsCookie: 'cookie 条数',
      settingsSize: '快照大小',
      settingsSkipped: '跳过的大值',
      settingsTruncated: '总量截断',
      settingsSaveNow: '立即保存',
      settingsClear: '清除已保存登录',
      settingsSavedOk: '已保存新的登录快照',
      settingsNeedSignin: '未能保存：先在面板里完成登录',
      settingsPanelClosed: '未能保存：先打开 DeepSeek 面板加载一次',
      settingsPanelHint: '打开 DeepSeek 面板加载一次后即可立即保存。',
      settingsCleared: '已清除本机保存的登录',
      settingsBridge: '桌面桥',
      settingsBridgeOk: '可用',
      settingsBridgeDown: '不可用',
      settingsLimits: '已知限制',
      settingsLimit1: '仅 DSH 桌面端可用；每台机器各自登录一次。',
      settingsLimit2: '下载、麦克风/摄像头、通知、剪贴板读取不可用；站点弹窗改在系统浏览器打开。',
      settingsLimit3: '快照以明文存于本机页面存储（等同浏览器 Cookie 文件），可在此清除。',
      settingsLimit4: '内嵌页面的开发者工具在打包版关闭；「诊断」卡可看最近日志与状态。',
      settingsDiagnostics: '诊断',
      diagLease: '容器 lease',
      diagHost: '站点主机',
      diagBackfill: '登录回填',
      diagCrashes: '崩溃次数',
      diagSnapshotState: '快照状态',
      diagCopy: '复制诊断信息',
      diagCopied: '诊断信息已复制',
      diagClear: '清空日志',
      diagCleared: '日志已清空',
      diagEmpty: '还没有日志；打开 DeepSeek 面板后会记录加载、回填与崩溃事件。',
      yes: '是',
      no: '否',
    };

    const en = {
      panel: 'DeepSeek',
      title: 'DeepSeek web',
      refresh: 'Refresh',
      openExternal: 'Open in system browser',
      copyLink: 'Copy link',
      clearLogin: 'Clear sign-in',
      copied: 'Link copied',
      copiedFailed: 'Copy failed; copy the address manually',
      cleared: 'Saved sign-in cleared',
      placeholderTitle: 'DeepSeek web panel',
      placeholderHint: 'The live page is hosted outside the panel, so switching panels never reloads it.',
      starting: 'Preparing the web container…',
      loading: 'Loading DeepSeek…',
      restoring: 'Restoring sign-in…',
      stepConnect: 'Connecting',
      stepRestore: 'Restore sign-in',
      stepLoad: 'Load page',
      failed: 'The page failed to load',
      crashed: 'The page crashed; rebuilding…',
      crashedStopped: 'Automatic rebuild stopped; reload manually',
      retry: 'Reload',
      loginStale: 'Saved sign-in expired; sign in again',
      bridgeMissing: 'Desktop bridge: unavailable (DSH Desktop required)',
      bridgeMismatch: 'Desktop bridge: protocol mismatch',
      protocol: 'protocol',
      settingsNav: 'DeepSeek web',
      settingsTitle: 'DeepSeek web panel',
      settingsDesc: 'Embeds the DeepSeek web app in the main panel: switching panels never reloads it, and one sign-in survives restarts on this machine.',
      settingsOpen: 'Open panel',
      settingsTarget: 'Panel location',
      settingsTargetValue: 'Sidebar "DeepSeek" row → main panel',
      settingsSite: 'Site',
      settingsUrl: 'URL',
      settingsCopy: 'Copy address',
      settingsSnapshot: 'Saved sign-in',
      settingsStatusSaved: 'Saved',
      settingsStatusMissing: 'Not saved',
      settingsStatusStale: 'Expired',
      settingsSavedAt: 'Saved at',
      settingsKeys: 'localStorage keys',
      settingsCookie: 'Cookie count',
      settingsSize: 'Snapshot size',
      settingsSkipped: 'Skipped large values',
      settingsTruncated: 'Truncated',
      settingsSaveNow: 'Save now',
      settingsClear: 'Clear saved sign-in',
      settingsSavedOk: 'Saved a fresh sign-in snapshot',
      settingsNeedSignin: 'Not saved: sign in inside the panel first',
      settingsPanelClosed: 'Not saved: open the DeepSeek panel once to load it',
      settingsPanelHint: 'Open the DeepSeek panel once; Save now becomes available after it loads.',
      settingsCleared: 'Saved sign-in cleared on this machine',
      settingsBridge: 'Desktop bridge',
      settingsBridgeOk: 'available',
      settingsBridgeDown: 'unavailable',
      settingsLimits: 'Known limits',
      settingsLimit1: 'Desktop only; sign in once per machine.',
      settingsLimit2: 'Downloads, mic/camera, notifications and clipboard reads are unavailable; site popups open in the system browser.',
      settingsLimit3: 'The snapshot is plain text in this machine\'s page storage (like a browser cookie file); clear it here.',
      settingsLimit4: 'The embedded page has no devTools in packaged builds; the Diagnostics card shows recent logs and state.',
      settingsDiagnostics: 'Diagnostics',
      diagLease: 'Lease',
      diagHost: 'Site host',
      diagBackfill: 'Backfill',
      diagCrashes: 'Crashes',
      diagSnapshotState: 'Snapshot',
      diagCopy: 'Copy diagnostics',
      diagCopied: 'Diagnostics copied',
      diagClear: 'Clear logs',
      diagCleared: 'Logs cleared',
      diagEmpty: 'No logs yet. Opening the DeepSeek panel records load, backfill, and crash events.',
      yes: 'yes',
      no: 'no',
    };

    const CSS = [
      '.aiwa-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.aiwa-toolbar{display:flex;align-items:center;gap:8px;flex:none;height:44px;padding:0 12px;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
      '.aiwa-brand{display:flex;align-items:center;gap:8px;min-width:0}',
      '.aiwa-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-warn-primary)}',
      '.aiwa-dot[data-state="ok"]{background:var(--dsw-alias-state-success-primary)}',
      '.aiwa-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.aiwa-spacer{flex:1}',
      '.aiwa-toast{font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.aiwa-toast[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.aiwa-notice{font-size:12px;line-height:20px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:360px}',
      '.aiwa-btn{font:inherit;font-size:12px;line-height:20px;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.aiwa-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}',
      '.aiwa-btn:active{background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent)}',
      '.aiwa-btn-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l2))}',
      '.aiwa-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '.aiwa-btn-primary:hover{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff;filter:brightness(1.06)}',
      '.aiwa-viewport{position:relative;flex:1;min-height:0;overflow:hidden}',
      '.aiwa-stage{position:absolute;inset:0}',
      '.aiwa-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:none}',
      '.aiwa-card::before{content:"";position:absolute;left:50%;top:50%;width:520px;height:520px;transform:translate(-50%,-52%);border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent),transparent 62%);filter:blur(6px);pointer-events:none;z-index:0;animation:aiwa-ambient 9s ease-in-out infinite alternate}',
      '.aiwa-card::after{content:"";position:absolute;left:50%;top:50%;width:560px;height:420px;transform:translate(-50%,-52%);pointer-events:none;z-index:0;opacity:.5;background-image:radial-gradient(color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent) 1px,transparent 1px);background-size:18px 18px;mask-image:radial-gradient(closest-side,#000,transparent);-webkit-mask-image:radial-gradient(closest-side,#000,transparent)}',
      '@keyframes aiwa-ambient{0%{transform:translate(-50%,-52%) scale(.96);opacity:.7}100%{transform:translate(-50%,-50%) scale(1.04);opacity:1}}',
      '@keyframes aiwa-card-in{0%{opacity:0;transform:translateY(6px) scale(.97)}100%{opacity:1;transform:none}}',
      '.aiwa-placeholder{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:10px;width:min(420px,100%);padding:34px 32px 28px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:18px;text-align:center;pointer-events:auto;overflow:hidden;background:linear-gradient(180deg,var(--dsw-alias-bg-layer-1),var(--dsw-alias-bg-base));box-shadow:0 28px 60px -34px rgba(0,0,0,.5);animation:aiwa-card-in .3s cubic-bezier(.2,.8,.2,1) both}',
      '.aiwa-placeholder[data-state="failed"]{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1))}',
      '.aiwa-mark{position:relative;display:flex;align-items:center;justify-content:center;width:64px;height:64px;margin-bottom:2px;border-radius:18px;background:linear-gradient(155deg,rgba(77,107,254,.18),rgba(77,107,254,.03));box-shadow:inset 0 0 0 1px rgba(77,107,254,.18)}',
      '.aiwa-mark::after{content:"";position:absolute;inset:-9px;border:1px solid rgba(77,107,254,.35);border-radius:24px;opacity:.2;animation:aiwa-halo 2.6s ease-in-out infinite}',
      '@keyframes aiwa-halo{0%,100%{transform:scale(.94);opacity:.12}50%{transform:scale(1.05);opacity:.4}}',
      '.aiwa-placeholder-title{font-size:15px;font-weight:600;letter-spacing:.01em}',
      '.aiwa-phase{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.aiwa-phase::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);animation:aiwa-pulse 1.5s ease-in-out infinite}',
      '.aiwa-phase[data-tone="error"]::before{background:var(--dsw-alias-state-error-primary);box-shadow:none;animation:none}',
      '@keyframes aiwa-pulse{0%,100%{transform:scale(.9);opacity:.5}50%{transform:scale(1.08);opacity:1}}',
      '.aiwa-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.aiwa-hint-dim{color:var(--dsw-alias-label-tertiary)}',
      '.aiwa-error{color:var(--dsw-alias-state-error-primary)}',
      '.aiwa-steps{list-style:none;margin:8px 0 2px;padding:0;width:100%;display:flex;flex-direction:column;gap:8px;text-align:left}',
      '.aiwa-step{display:flex;align-items:center;gap:9px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);transition:color .2s ease}',
      '.aiwa-step-dot{position:relative;flex:none;width:12px;height:12px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);box-sizing:border-box;transition:background .2s ease,border-color .2s ease}',
      '.aiwa-step[data-state="current"]{color:var(--dsw-alias-label-secondary)}',
      '.aiwa-step[data-state="current"] .aiwa-step-dot{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent);animation:aiwa-step-pulse 1.5s ease-in-out infinite}',
      '.aiwa-step[data-state="done"]{color:var(--dsw-alias-label-secondary)}',
      '.aiwa-step[data-state="done"] .aiwa-step-dot{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary)}',
      '.aiwa-step[data-state="done"] .aiwa-step-dot::after{content:"";position:absolute;left:3.5px;top:1.5px;width:3px;height:6px;border:solid #fff;border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}',
      '@keyframes aiwa-step-pulse{0%,100%{box-shadow:0 0 0 0 rgba(77,107,254,.28)}50%{box-shadow:0 0 0 4px rgba(77,107,254,0)}}',
      '.aiwa-progress{position:absolute;left:0;right:0;bottom:0;height:2px;overflow:hidden;background:color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent)}',
      '.aiwa-progress::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,var(--dsw-alias-brand-primary),transparent);transform:translateX(-100%);animation:aiwa-progress 1.6s cubic-bezier(.4,0,.2,1) infinite}',
      '@keyframes aiwa-progress{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}',
      '@media (prefers-reduced-motion:reduce){.aiwa-mark::after,.aiwa-phase::before,.aiwa-progress::after,.aiwa-card::before,.aiwa-card::after,.aiwa-placeholder,.aiwa-step-dot{animation:none}.aiwa-host,.aiwa-step{transition:none}}',
      '.aiwa-host{position:fixed;left:0;top:0;width:0;height:0;z-index:1;overflow:hidden;visibility:hidden;pointer-events:none;background:var(--dsw-alias-bg-base);opacity:0;transition:opacity .2s ease}',
      '.aiwa-guest{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-base)}',
      // 设置页（settings.section）：自带样式，不依赖宿主 CSS Module 类名。
      '.aiwa-sec{display:flex;flex-direction:column;gap:14px;padding:2px 2px 28px;max-width:620px;box-sizing:border-box;color:var(--dsw-alias-label-primary)}',
      '.aiwa-sec-head{display:flex;flex-direction:column;gap:6px}',
      '.aiwa-sec-title{font-size:15px;font-weight:600;line-height:22px}',
      '.aiwa-sec-desc{font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.aiwa-sec-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.aiwa-sec-card-head{display:flex;align-items:center;gap:8px;min-height:22px}',
      '.aiwa-sec-card-title{font-size:13px;font-weight:600}',
      '.aiwa-sec-row{display:flex;align-items:baseline;gap:10px;font-size:12.5px;line-height:19px;min-width:0}',
      '.aiwa-sec-key{flex:none;min-width:92px;color:var(--dsw-alias-label-tertiary)}',
      '.aiwa-sec-val{min-width:0;color:var(--dsw-alias-label-primary);word-break:break-all;user-select:text}',
      '.aiwa-sec-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
      '.aiwa-sec-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
      '.aiwa-sec-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
      '.aiwa-sec-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.aiwa-pill{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;line-height:18px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.aiwa-pill[data-tone="ok"]{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,var(--dsw-alias-border-l2))}',
      '.aiwa-pill[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,var(--dsw-alias-border-l2))}',
      '.aiwa-pill[data-tone="error"]{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l2))}',
      '.aiwa-sec-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:12.5px;line-height:19px;color:var(--dsw-alias-label-secondary)}',
      '.aiwa-btn[disabled]{opacity:.5;cursor:default}',
      '.aiwa-btn[disabled]:hover{background:transparent;color:var(--dsw-alias-label-secondary)}',
      // 诊断卡（plans/03 T1）：只读日志视图。
      '.aiwa-diag-logs{margin-top:2px;max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 70%,transparent);padding:6px 8px;display:flex;flex-direction:column;gap:2px}',
      '.aiwa-diag-line{display:flex;gap:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}',
      '.aiwa-diag-line[data-level="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.aiwa-diag-line[data-level="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.aiwa-diag-time{flex:none;color:var(--dsw-alias-label-tertiary)}',
      '.aiwa-diag-text{min-width:0}',
    ].join('');

    /**
     * 读取桌面桥：`protocolVersion` 在 `dshDesktop` 上，`browser` 只是它的子 API。
     * 只报告存在性与协议版本，不触碰任何凭据。
     */
    function readBridge() {
      const desktop = globalThis.dshDesktop;
      const bridge = desktop && desktop.browser ? desktop.browser : null;
      const protocol = desktop && desktop.protocolVersion !== undefined ? desktop.protocolVersion : null;
      const ready = !!bridge && protocol === 1 && typeof bridge.acquire === 'function';
      const status = ready ? 'ready' : desktop && protocol !== null && protocol !== 1 ? 'mismatch' : 'missing';
      return { desktop, bridge, protocol, ready, status };
    }

    /** ERR_ABORTED 表示旧导航被新导航取代（含站点重定向），不是加载失败。 */
    function isAbortedNavigation(error) {
      if (!error) return false;
      if (error.code === -3 || error.code === 'ERR_ABORTED') return true;
      const text = String(error.message || error);
      return text.indexOf('ERR_ABORTED') !== -1 || text.indexOf('(-3)') !== -1;
    }

    /**
     * guest 内探针：只返回键名、是否带 token 键、是否在登录路径。
     * 不把值写进日志；执行结果由宿主决定是否落盘。
     */
    const GUEST_PROBE_SCRIPT = [
      '(function () {',
      '  var keys = [], token = false;',
      '  try {',
      '    for (var i = 0; i < localStorage.length && keys.length < 60; i++) {',
      '      var key = localStorage.key(i);',
      '      if (key === null) continue;',
      '      keys.push(key);',
      '      var value = localStorage.getItem(key) || "";',
      '      if (String(key).toLowerCase().indexOf("token") >= 0 && value.length > 0) token = true;',
      '    }',
      '  } catch (error) {}',
      '  var path = String(location.pathname || "").toLowerCase();',
      '  var login = path.indexOf("sign_in") >= 0 || path.indexOf("signin") >= 0 || path.indexOf("login") >= 0;',
      '  return JSON.stringify({ url: location.href, path: location.pathname, login: login, token: token, keys: keys });',
      '})()',
    ].join('\n');

    /**
     * guest 内采集：单值 >64KB 跳过、总量 >512KB 截断；含可读 cookie。
     * 返回 JSON 字符串，由宿主解析并写入本机快照。
     */
    const GUEST_COLLECT_SCRIPT = [
      '(function () {',
      '  var singleLimit = 65536, totalLimit = 524288;',
      '  var entries = {}, used = 0, skipped = 0, truncated = false;',
      '  try {',
      '    for (var i = 0; i < localStorage.length; i++) {',
      '      var key = localStorage.key(i);',
      '      if (key === null) continue;',
      '      var value = localStorage.getItem(key) || "";',
      '      if (value.length === 0) continue;',
      '      if (value.length > singleLimit) { skipped += 1; continue; }',
      '      if (used + key.length + value.length > totalLimit) { truncated = true; break; }',
      '      entries[key] = value;',
      '      used += key.length + value.length;',
      '    }',
      '  } catch (error) {}',
      '  var cookie = "";',
      '  try { cookie = document.cookie || ""; } catch (error) {}',
      '  var path = String(location.pathname || "").toLowerCase();',
      '  var login = path.indexOf("sign_in") >= 0 || path.indexOf("signin") >= 0 || path.indexOf("login") >= 0;',
      '  var keys = Object.keys(entries), token = false;',
      '  for (var j = 0; j < keys.length; j++) {',
      '    if (String(keys[j]).toLowerCase().indexOf("token") >= 0 && entries[keys[j]].length > 0) token = true;',
      '  }',
      '  return JSON.stringify({ url: location.href, login: login, token: token, keys: keys, entries: entries, cookie: cookie, skipped: skipped, truncated: truncated });',
      '})()',
    ].join('\n');

    /** 回填脚本：写 localStorage + 可读 cookie（属性不可还原，用默认 path）。 */
    function buildInjectScript(site) {
      const payload = JSON.stringify(JSON.stringify(site));
      return [
        '(function (payloadJson) {',
        '  var snap;',
        '  try { snap = JSON.parse(payloadJson); } catch (error) { return JSON.stringify({ ok: false, error: "payload" }); }',
        '  var written = 0;',
        '  try {',
        '    var data = snap.localStorage || {};',
        '    for (var key in data) {',
        '      if (!Object.prototype.hasOwnProperty.call(data, key)) continue;',
        '      localStorage.setItem(key, data[key]);',
        '      written += 1;',
        '    }',
        '  } catch (error) { return JSON.stringify({ ok: false, error: "storage", written: written }); }',
        '  var cookies = 0;',
        '  try {',
        '    var parts = String(snap.cookie || "").split(";");',
        '    for (var i = 0; i < parts.length; i++) {',
        '      var pair = parts[i].trim();',
        '      if (!pair) continue;',
        '      var eq = pair.indexOf("=");',
        '      if (eq <= 0) continue;',
        '      var name = pair.slice(0, eq);',
        '      var value = pair.slice(eq + 1);',
        '      if (!value) continue;',
        '      document.cookie = name + "=" + value + "; path=/; SameSite=Lax";',
        '      cookies += 1;',
        '    }',
        '  } catch (error) { return JSON.stringify({ ok: false, error: "cookie", written: written, cookies: cookies }); }',
        '  return JSON.stringify({ ok: true, written: written, cookies: cookies });',
        '})(' + payload + ')',
      ].join('\n');
    }

    /** 站点表：V1 固定单站，结构按多站设计。 */
    function ensureSites() {
      try {
        const raw = localStorage.getItem(SITES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.version === 1 && Array.isArray(parsed.sites)
            && parsed.sites.some((site) => site && site.id === SITE_ID)) return;
        }
        localStorage.setItem(SITES_KEY, JSON.stringify({ version: 1, sites: [SITE_DEF] }));
      } catch (error) {
        log('warn', '[aiwa] sites table unavailable', error && error.message);
      }
    }

    function readSnapshotSite() {
      try {
        const raw = localStorage.getItem(SNAPSHOT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const site = parsed && parsed.sites ? parsed.sites[SITE_ID] : null;
        return site && typeof site === 'object' ? site : null;
      } catch (error) {
        log('warn', '[aiwa] snapshot unreadable', error && error.message);
        return null;
      }
    }

    function writeSnapshotSite(site) {
      try {
        let root = null;
        const raw = localStorage.getItem(SNAPSHOT_KEY);
        if (raw) {
          try {
            root = JSON.parse(raw);
          } catch (error) {
            root = null;
          }
        }
        if (!root || typeof root !== 'object') root = { version: 1, sites: {} };
        if (!root.sites || typeof root.sites !== 'object') root.sites = {};
        root.version = 1;
        root.sites[SITE_ID] = site;
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(root));
        return true;
      } catch (error) {
        log('warn', '[aiwa] snapshot write failed', error && error.message);
        return false;
      }
    }

    function markSnapshotStale() {
      const site = readSnapshotSite();
      if (!site) return false;
      if (site.stale === true) return true;
      const ok = writeSnapshotSite(Object.assign({}, site, { stale: true }));
      if (ok) log('warn', '[aiwa] snapshot marked stale; sign-in required again');
      return ok;
    }

    /**
     * 宿主控制器：持有一个 lease 与一个 webview，永不 reparent。
     * 对外只有显隐、几何、刷新、打开外部和状态订阅；任何失败都不抛给 React。
     */
    function createHost() {
      const listeners = new Set();
      const bridgeInfo = readBridge();
      ensureSites();
      let state = {
        phase: bridgeInfo.ready ? 'idle' : 'unavailable',
        error: null,
        title: '',
        notice: null,
        restoring: false,
        hasSnapshot: !!readSnapshotSite(),
        stopped: false,
      };
      let container = null;
      let webview = null;
      let lease = null;
      let partition = null;
      let unsubscribeOpen = null;
      let listenerCleanup = [];
      let placeholder = null;
      let rectObserver = null;
      let inertObserver = null;
      let restartTimer = null;
      let active = false;
      let suspended = false;
      let starting = false;
      let crashes = 0;
      let disposed = false;
      let shownOnce = false;
      let loadFinished = false;
      let collectTimer = null;
      let pollTimer = null;
      let validateTimer = null;
      let collecting = false;
      // none → 本 guest 未回填；injecting/injected → 已注入待校验；validated → 已在用；invalid → 快照失效
      let backfill = 'none';
      document.addEventListener('visibilitychange', onDocumentVisibility);

      function emit(patch) {
        state = Object.assign({}, state, patch);
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            log('warn', '[aiwa] host listener failed', error && error.message);
          }
        }
        // 阶段变化会改变显隐（starting→loading→ready），几何必须跟着状态走。
        applyGeometry();
      }

      function subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }

      function getState() {
        return state;
      }

      /** 诊断摘要：只有状态、主机名、计数与键名数量，不含任何值。 */
      function diagnostics() {
        const snapshot = readSnapshotSite();
        const stored = snapshot && snapshot.localStorage && typeof snapshot.localStorage === 'object'
          ? snapshot.localStorage : {};
        let host = '';
        try {
          if (webview && typeof webview.getURL === 'function') host = new URL(webview.getURL()).host;
        } catch (error) {
          host = '';
        }
        if (!host && snapshot && typeof snapshot.url === 'string') {
          try {
            host = new URL(snapshot.url).host;
          } catch (error) {
            host = '';
          }
        }
        return {
          phase: state.phase,
          notice: state.notice,
          stopped: state.stopped === true,
          crashes,
          suspended: suspended === true,
          lease: lease ? String(lease).slice(0, 8) : '',
          host,
          backfill,
          hasSnapshot: !!snapshot,
          stale: !!(snapshot && snapshot.stale === true),
          keys: Object.keys(stored).length,
          savedAt: snapshot && typeof snapshot.savedAt === 'number' ? snapshot.savedAt : 0,
          bridge: bridgeInfo.status,
        };
      }

      /** 最近日志（默认全部，最多 LOG_LIMIT 条）；entries 已脱敏。 */
      function logEntries(count) {
        return logRing.list(count);
      }

      function clearLogs() {
        logRing.clear();
      }

      async function runInGuest(script) {
        const element = webview;
        if (!element) return null;
        try {
          const raw = await element.executeJavaScript(script);
          if (typeof raw !== 'string') return null;
          return JSON.parse(raw);
        } catch (error) {
          log('warn', '[aiwa] guest script failed', error && error.message);
          return null;
        }
      }

      function scheduleCollect() {
        if (disposed || !webview) return;
        if (collectTimer) clearTimeout(collectTimer);
        collectTimer = setTimeout(() => {
          collectTimer = null;
          void collectSnapshot();
        }, COLLECT_DELAY_MS);
        if (!pollTimer) {
          pollTimer = setInterval(() => {
            if (state.phase === 'ready') void collectSnapshot();
          }, POLL_INTERVAL_MS);
        }
      }

      /**
       * 采集并写本机快照。只在 guest 已登录（有 token 键或首次宽松判定）时写，
       * 避免坏快照覆盖好快照；日志只打键名与计数。
       */
      async function collectSnapshot() {
        if (disposed || !webview || collecting) return null;
        if (backfill === 'injecting' || backfill === 'injected') return null;
        if (state.phase !== 'ready') return null;
        const element = webview;
        collecting = true;
        try {
          const data = await runInGuest(GUEST_COLLECT_SCRIPT);
          if (!data || webview !== element) return null;
          if (data.login) {
            log('log', '[aiwa] snapshot skipped; guest is on the sign-in path');
            return null;
          }
          const existing = readSnapshotSite();
          if (!data.token && existing) {
            log('log', '[aiwa] snapshot skipped; no token key in the guest');
            return null;
          }
          if (!data.token && (!data.keys || data.keys.length === 0)) return null;
          const site = {
            savedAt: Date.now(),
            url: data.url || SITE_URL,
            stale: false,
            truncated: !!data.truncated,
            skipped: data.skipped || 0,
            cookie: data.cookie || '',
            localStorage: data.entries || {},
          };
          if (!writeSnapshotSite(site)) return null;
          log('log', '[aiwa] snapshot saved; keys=%s cookie=%d truncated=%s skipped=%d',
            Object.keys(site.localStorage).join(','), site.cookie.length, site.truncated, site.skipped);
          if (state.notice || !state.hasSnapshot) emit({ notice: null, hasSnapshot: true });
          return site;
        } finally {
          collecting = false;
        }
      }

      function clearSnapshot() {
        try {
          localStorage.removeItem(SNAPSHOT_KEY);
          log('log', '[aiwa] snapshot cleared');
        } catch (error) {
          log('warn', '[aiwa] clear snapshot failed', error && error.message);
        }
        emit({ hasSnapshot: false, notice: null });
      }

      function scheduleValidation() {
        if (backfill !== 'injected') return;
        if (validateTimer) clearTimeout(validateTimer);
        validateTimer = setTimeout(() => {
          validateTimer = null;
          void validateBackfill();
        }, 1200);
      }

      function backfillBusy() {
        return backfill === 'probing' || backfill === 'injecting' || backfill === 'injected';
      }

      /** 页面已加载完且回填已落定后才发 ready；提前发 ready 会把未登录页露出来。 */
      function finishBackfill() {
        if (!loadFinished) return;
        if (state.phase === 'ready') {
          scheduleCollect();
          return;
        }
        emit({ phase: 'ready', error: null, restoring: false });
        scheduleCollect();
      }

      async function validateBackfill() {
        if (backfill !== 'injected' || !webview) return;
        const element = webview;
        let probe = await runInGuest(GUEST_PROBE_SCRIPT);
        if (!probe || webview !== element) return;
        if (needsProbeRetry(probe)) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          if (webview !== element) return;
          probe = await runInGuest(GUEST_PROBE_SCRIPT);
          if (!probe || webview !== element) return;
        }
        if (probeVerdict(probe) === 'stale') {
          backfill = 'invalid';
          markSnapshotStale();
          emit({ notice: 'loginStale', restoring: false });
          log('warn', '[aiwa] backfill did not restore the sign-in (%s); snapshot marked stale',
            probe.token ? 'still on ' + (probe.path || 'the sign-in path') : 'token key missing');
          finishBackfill();
          return;
        }
        backfill = 'validated';
        log('log', '[aiwa] backfill restored sign-in; keys=%s', (probe.keys || []).join(','));
        finishBackfill();
        void collectSnapshot();
      }

      /**
       * 每个 lease 最多回填一次：未登录且有快照时注入并回首页；
       * 注入后由 validateBackfill 判定快照是否仍有效（R2/R12）。
       */
      async function maybeBackfill() {
        if (backfill !== 'none' || !webview) return;
        const element = webview;
        const snapshot = readSnapshotSite();
        if (!snapshot) return;
        if (snapshot.stale === true) {
          backfill = 'invalid';
          if (state.notice !== 'loginStale') emit({ notice: 'loginStale', restoring: false });
          finishBackfill();
          return;
        }
        backfill = 'probing';
        emit({ restoring: true });
        const probe = await runInGuest(GUEST_PROBE_SCRIPT);
        if (!probe || webview !== element) {
          backfill = 'failed';
          finishBackfill();
          return;
        }
        if (!probe.login && probe.token) {
          backfill = 'validated';
          log('log', '[aiwa] sign-in already present; skip backfill');
          finishBackfill();
          return;
        }
        backfill = 'injecting';
        const result = await runInGuest(buildInjectScript(snapshot));
        if (!result) {
          backfill = 'failed';
          log('warn', '[aiwa] snapshot injection failed; keeping the guest as-is');
          finishBackfill();
          return;
        }
        if (webview !== element) return;
        if (result.ok !== true) {
          backfill = 'failed';
          log('warn', '[aiwa] snapshot injection failed (%s); keeping the guest as-is',
            result && result.error ? result.error : 'unknown');
          finishBackfill();
          return;
        }
        backfill = 'injected';
        log('log', '[aiwa] snapshot injected; localStorage=%d cookie=%d', result.written, result.cookies);
        if (webview !== element) return;
        try {
          const loading = webview.loadURL(SITE_URL);
          if (loading && typeof loading.catch === 'function') {
            loading.catch((error) => {
              if (isAbortedNavigation(error)) return;
              log('warn', '[aiwa] post-inject navigation failed', error && error.message);
            });
          }
        } catch (error) {
          log('warn', '[aiwa] post-inject navigation failed', error && error.message);
        }
      }

      function onDocumentVisibility() {
        if (document.visibilityState === 'hidden') void collectSnapshot();
      }

      function placeholderRect() {
        if (!placeholder || !placeholder.isConnected) return null;
        const rect = placeholder.getBoundingClientRect();
        if (!(rect.width >= 1) || !(rect.height >= 1)) return null;
        return rect;
      }

      /**
       * 同步容器几何与显隐。pointer-events 必须内联：`.overlayLayer > *` 把它设成 auto，
       * 隐藏时若只改 visibility 仍会挡住会话。
       */
      function applyGeometry() {
        if (!container) return;
        const rect = placeholderRect();
        if (rect) {
          container.style.left = rect.left + 'px';
          container.style.top = rect.top + 'px';
          container.style.width = rect.width + 'px';
          container.style.height = rect.height + 'px';
        }
        // 回填落定前不显示 guest：否则会先看到未登录页再闪到聊天页。
        // 首次显示后，站内整页导航允许保持可见（React 卡片会被 guest 盖住）。
        const visible = !!rect && active && !suspended && webview !== null
          && (state.phase === 'ready' || (shownOnce && state.phase === 'loading'));
        if (visible) shownOnce = true;
        container.style.visibility = visible ? 'visible' : 'hidden';
        container.style.opacity = visible ? '1' : '0';
        container.style.pointerEvents = visible ? 'auto' : 'none';
        container.style.transform = visible ? 'none' : HIDDEN_TRANSFORM;
        maybeStart();
      }

      function maybeStart() {
        const decision = shouldStart({
          disposed,
          starting,
          webview,
          phase: state.phase,
          active,
          suspended,
          hasRect: !!placeholderRect(),
          bridgeReady: bridgeInfo.ready,
          crashes,
          max: MAX_CRASH_RESTARTS,
        });
        if (decision === 'unavailable') {
          if (state.phase !== 'unavailable') emit({ phase: 'unavailable' });
          return;
        }
        // 重建次数已用尽：停在卡片上等手动刷新，避免崩溃 → 重建 → 再崩溃的死循环。
        if (decision === 'stop') {
          if (!state.stopped) emit({ stopped: true });
          return;
        }
        if (decision !== 'start') return;
        void start();
      }

      function blurGuest() {
        if (!webview) return;
        try {
          webview.blur();
        } catch (error) {
          // 焦点不在 guest 时 blur 可能抛错，忽略。
        }
      }

      function checkInert() {
        if (!container) return;
        // 只有 container 自身处于 inert 子树（例如设置弹窗把 #root 置 inert）才暂停；
        // 文档里其它隐藏元素带 inert 不应误伤。
        let blocked = false;
        for (let node = container; node; node = node.parentElement) {
          if (node.hasAttribute('inert')) {
            blocked = true;
            break;
          }
        }
        setSuspended(blocked);
      }

      function setSuspended(next) {
        if (suspended === next) return;
        suspended = next;
        if (suspended) blurGuest();
        applyGeometry();
      }

      function installInertObserver() {
        if (inertObserver || !container) return;
        inertObserver = new MutationObserver(checkInert);
        inertObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['inert'], subtree: true });
        checkInert();
      }

      function createGuest(reservation) {
        const element = document.createElement('webview');
        element.className = 'aiwa-guest';
        element.setAttribute('name', reservation.lease);
        element.setAttribute('partition', reservation.partition);
        element.setAttribute('allowpopups', '');
        // 引导文档必须原样保留到 dom-ready，主进程据此认领 lease。
        element.setAttribute('src', 'about:blank#' + reservation.lease);
        return element;
      }

      function forwardConsole(event) {
        const message = event && typeof event.message === 'string' ? event.message : '';
        if (!message) return;
        const level = event.level;
        const kind = level === 3 || level === 'error' ? 'error'
          : level === 2 || level === 'warning' ? 'warn' : 'log';
        log(kind, '[aiwa][guest] %s', message);
      }

      function wireGuest(element) {
        const on = (name, handler) => {
          const wrapped = (event) => {
            if (webview === element) handler(event);
          };
          element.addEventListener(name, wrapped);
          listenerCleanup.push(() => element.removeEventListener(name, wrapped));
        };
        const committedUrl = () => {
          try {
            return element.getURL() || '';
          } catch (error) {
            return '';
          }
        };
        // 引导文档是 about:blank#lease；只有真实站点才算加载完成，避免提前显示空白页。
        const committed = () => /^https?:/i.test(committedUrl());

        let loadAttempts = 0;
        let loadTimer = null;
        let firstCommit = true;
        // dom-ready 会为引导文档和站点文档各触发一次；目标导航只能发一次，
        // 否则站点文档的 dom-ready 又会 loadURL，形成自中断循环。
        let siteLoadStarted = false;
        listenerCleanup.push(() => {
          if (loadTimer) {
            clearTimeout(loadTimer);
            loadTimer = null;
          }
        });

        function loadSite() {
          if (webview !== element) return;
          loadAttempts += 1;
          log('log', '[aiwa] guest load attempt %d: %s', loadAttempts, SITE_URL);
          const loading = element.loadURL(SITE_URL);
          if (!loading || typeof loading.catch !== 'function') return;
          loading.catch((error) => {
            if (webview !== element) return;
            if (isAbortedNavigation(error)) {
              log('warn', '[aiwa] guest load aborted (redirect or superseded); waiting for navigation events');
              if (loadAttempts < 2) {
                loadTimer = setTimeout(() => {
                  loadTimer = null;
                  if (disposed || webview !== element || state.phase === 'failed') return;
                  if (committed()) return;
                  loadSite();
                }, 2000);
              }
              return;
            }
            fail('loadURL: ' + ((error && error.message) || String(error)));
          });
        }

        on('dom-ready', () => {
          if (siteLoadStarted) {
            // 站点文档就绪后才有同源 localStorage：在这里尝试快照回填。
            void maybeBackfill();
            return;
          }
          siteLoadStarted = true;
          emit({ phase: 'loading', error: null });
          log('log', '[aiwa] guest dom-ready; loading %s', SITE_URL);
          // 让主进程先完成 dom-ready 的 lease 认领，再发目标导航，避免引导文档归属校验被打断。
          if (loadTimer) clearTimeout(loadTimer);
          loadTimer = setTimeout(() => {
            loadTimer = null;
            loadSite();
          }, 30);
        });

        on('did-navigate', () => {
          if (!firstCommit || !committed()) return;
          firstCommit = false;
          try {
            // 首次真实提交后清掉引导文档，避免 about:blank 成为可后退项。
            element.clearHistory();
          } catch (error) {
            // 清历史失败不影响使用。
          }
        });

        on('did-start-loading', () => {
          loadFinished = false;
          if (state.phase !== 'failed' && state.phase !== 'crashed') emit({ phase: 'loading' });
        });
        on('did-stop-loading', () => {
          if (!committed()) return;
          crashes = 0;
          loadFinished = true;
          if (backfillBusy()) {
            scheduleValidation();
            return;
          }
          finishBackfill();
        });
        on('did-finish-load', () => {
          if (!committed()) return;
          crashes = 0;
          loadFinished = true;
          if (backfillBusy()) {
            scheduleValidation();
            return;
          }
          finishBackfill();
        });
        on('did-fail-load', (event) => {
          if (!event || event.isMainFrame === false) return;
          if (event.errorCode === -3) return;
          const code = event.errorCode === undefined ? '' : ' [' + event.errorCode + ']';
          fail('did-fail-load' + code + ' ' + (event.errorDescription || ''));
        });
        on('render-process-gone', (event) => {
          crash('render-process-gone: ' + ((event && event.reason) || 'unknown'));
        });
        on('destroyed', () => {
          crash('destroyed');
        });
        on('console-message', forwardConsole);
        on('page-title-updated', (event) => {
          const title = event && typeof event.title === 'string' ? event.title : '';
          try {
            element.setAttribute('aria-label', title);
          } catch (error) {
            // 仅用于可访问名称。
          }
          emit({ title });
        });
      }

      async function releaseLease(id) {
        if (!id || !bridgeInfo.bridge) return;
        try {
          await bridgeInfo.bridge.release(id);
        } catch (error) {
          log('warn', '[aiwa] guest release failed', error && error.message);
        }
      }

      async function teardown() {
        if (collectTimer) {
          clearTimeout(collectTimer);
          collectTimer = null;
        }
        if (validateTimer) {
          clearTimeout(validateTimer);
          validateTimer = null;
        }
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        backfill = 'none';
        collecting = false;
        shownOnce = false;
        loadFinished = false;
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }
        const element = webview;
        webview = null;
        if (unsubscribeOpen) {
          try {
            unsubscribeOpen();
          } catch (error) {
            // 取消订阅失败不影响释放。
          }
          unsubscribeOpen = null;
        }
        for (const cleanup of listenerCleanup.splice(0)) {
          try {
            cleanup();
          } catch (error) {
            // 元素已被移除时 removeEventListener 不会抛错，忽略即可。
          }
        }
        if (element) {
          try {
            element.remove();
          } catch (error) {
            // 元素已脱离文档时忽略。
          }
        }
        const id = lease;
        lease = null;
        partition = null;
        if (id) await releaseLease(id);
        applyGeometry();
      }

      function fail(message) {
        log('warn', '[aiwa] guest failed: %s', message);
        emit({ phase: 'failed', error: message || null });
        void teardown();
      }

      function crash(reason) {
        log('warn', '[aiwa] guest gone: %s', reason);
        crashes += 1;
        emit({ phase: 'crashed', error: reason });
        void teardown().then(() => {
          const decision = decideCrashRestart({ disposed, active, suspended, crashes, max: MAX_CRASH_RESTARTS });
          if (decision === 'stop') {
            log('warn', '[aiwa] guest crash limit reached; waiting for a manual refresh');
            emit({ stopped: true });
            return;
          }
          if (decision !== 'restart') return;
          restartTimer = setTimeout(() => {
            restartTimer = null;
            if (disposed) return;
            emit({ phase: 'idle', error: null });
            maybeStart();
          }, CRASH_RESTART_DELAY_MS);
        });
      }

      async function start() {
        if (disposed || starting || webview !== null) return;
        if (!bridgeInfo.ready || !container) return;
        starting = true;
        emit({ phase: 'starting', error: null, restoring: false, stopped: false });
        try {
          const reservation = await bridgeInfo.bridge.acquire(WORKSPACE_KEY);
          if (disposed || !container) {
            await releaseLease(reservation && reservation.lease);
            starting = false;
            emit({ phase: 'idle' });
            return;
          }
          lease = reservation.lease;
          partition = reservation.partition;
          const element = createGuest(reservation);
          webview = element;
          wireGuest(element);
          container.appendChild(element);
          unsubscribeOpen = bridgeInfo.bridge.onOpenRequested(lease, (url) => openExternal(url));
          log('log', '[aiwa] guest attached; lease=%s partition=%s', lease, partition);
          applyGeometry();
        } catch (error) {
          log('warn', '[aiwa] guest attach failed', error && error.message);
          emit({ phase: 'failed', error: (error && error.message) || 'attach failed' });
          await teardown();
        } finally {
          starting = false;
        }
      }

      function reload() {
        if (disposed) return;
        if (starting) {
          log('log', '[aiwa] reload ignored while the guest is starting');
          return;
        }
        crashes = 0;
        if (webview) {
          try {
            webview.reload();
            log('log', '[aiwa] guest reload requested');
            return;
          } catch (error) {
            log('warn', '[aiwa] guest reload failed', error && error.message);
          }
        }
        emit({ phase: 'idle', error: null, stopped: false });
        void teardown();
      }

      function openExternal(url) {
        let target = SITE_URL;
        try {
          const parsed = new URL(String(url));
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') target = parsed.href;
        } catch (error) {
          target = SITE_URL;
        }
        try {
          log('log', '[aiwa] open in system browser: %s', target);
          // 主进程的主窗口 setWindowOpenHandler 会把 http(s) 交给系统浏览器并 deny 新窗口。
          window.open(target, '_blank', 'noopener,noreferrer');
        } catch (error) {
          log('warn', '[aiwa] open in system browser failed', error && error.message);
        }
      }

      function observePlaceholder(element) {
        placeholder = element;
        active = true;
        if (!rectObserver) rectObserver = new ResizeObserver(() => applyGeometry());
        rectObserver.observe(element);
        window.addEventListener('resize', applyGeometry);
        window.addEventListener('scroll', applyGeometry, true);
        applyGeometry();
        return () => {
          active = false;
          if (rectObserver) rectObserver.disconnect();
          window.removeEventListener('resize', applyGeometry);
          window.removeEventListener('scroll', applyGeometry, true);
          if (placeholder === element) placeholder = null;
          blurGuest();
          // 面板切走：把当前登录态落一次快照（切面板不应丢登录）。
          void collectSnapshot();
          applyGeometry();
        };
      }

      function attachContainer(element) {
        container = element;
        installInertObserver();
        applyGeometry();
      }

      function detachContainer(element) {
        if (container !== element) return;
        // 容器卸载只断开几何来源；真正的 lease 释放在 apply 的 guest lifetime effect 里。
        container = null;
      }

      function dispose() {
        if (disposed) return;
        disposed = true;
        active = false;
        listeners.clear();
        document.removeEventListener('visibilitychange', onDocumentVisibility);
        if (rectObserver) {
          rectObserver.disconnect();
          rectObserver = null;
        }
        if (inertObserver) {
          inertObserver.disconnect();
          inertObserver = null;
        }
        window.removeEventListener('resize', applyGeometry);
        window.removeEventListener('scroll', applyGeometry, true);
        placeholder = null;
        void teardown();
        container = null;
      }


      return {
        attachContainer,
        detachContainer,
        observePlaceholder,
        subscribe,
        getState,
        diagnostics,
        logEntries,
        clearLogs,
        collectSnapshot,
        clearSnapshot,
        reload,
        openExternal,
        dispose,
        bridgeInfo,
      };
    }

    function DeepSeekGlyph({ size }) {
      const edge = typeof size === 'number' && size > 0 ? size : 18;
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 36 36',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block' },
      },
        h('rect', { x: 2, y: 2, width: 32, height: 32, rx: 8, fill: '#4D6BFE' }),
        h('path', {
          d: 'M7.2 18C7.2 14 10.9 10.8 15.7 10.8C19.9 10.8 22.9 12.7 24.5 15.6L29.3 12.3C28.9 14.6 28.7 16.3 28.7 18C28.7 19.7 28.9 21.4 29.3 23.7L24.5 20.4C22.9 23.3 19.9 25.2 15.7 25.2C10.9 25.2 7.2 22 7.2 18Z',
          fill: '#FFFFFF',
        }),
        h('circle', { cx: 13.2, cy: 16.6, r: 1.15, fill: '#4D6BFE' }),
      );
    }

    function fallbackCopy(text) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch (error) {
        log('warn', '[aiwa] copy fallback failed', error && error.message);
        return false;
      }
    }

    function copyText(text) {
      const clipboard = globalThis.navigator ? globalThis.navigator.clipboard : null;
      if (clipboard && typeof clipboard.writeText === 'function') {
        return clipboard.writeText(text).then(
          () => true,
          () => fallbackCopy(text),
        );
      }
      return Promise.resolve(fallbackCopy(text));
    }

    /** 设置页用的两个格式化：时间按本机时区，大小按 KB/MB。 */
    function formatTime(ts) {
      if (!ts) return '';
      try {
        return new Date(ts).toLocaleString();
      } catch (error) {
        return String(ts);
      }
    }

    function formatSize(size) {
      if (!size) return '0 KB';
      if (size < 1024) return size + ' B';
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
      return (size / 1024 / 1024).toFixed(1) + ' MB';
    }

    /** 宿主容器：由 shell.overlay 常驻渲染，React 只负责提供这一个稳定节点。 */
    function HostOverlay({ controller }) {
      const ref = useRef(null);
      useEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        controller.host.attachContainer(element);
        return () => {
          controller.host.detachContainer(element);
        };
      }, [controller]);
      return h('div', { ref, className: 'aiwa-host' });
    }

    function MainPanel({ t, controller }) {
      const host = controller.host;
      const [snapshot, setSnapshot] = useState(host.getState());
      const [note, setNote] = useState(null);
      const stageRef = useRef(null);
      const bridge = useMemo(readBridge, []);

      useEffect(() => host.subscribe(() => setSnapshot(host.getState())), [host]);

      useEffect(() => {
        const element = stageRef.current;
        if (!element) return undefined;
        return host.observePlaceholder(element);
      }, [host]);

      useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(null), note.tone === 'error' ? 3500 : 2200);
        return () => clearTimeout(timer);
      }, [note]);

      const showNote = (text, tone) => setNote({ text, tone });

      const onCopy = () => {
        copyText(SITE_URL).then((ok) => showNote(ok ? t('copied') : t('copiedFailed'), ok ? 'ok' : 'error'));
      };
      const onClear = () => {
        controller.clearLogin();
        showNote(t('cleared'), 'ok');
      };

      const failed = snapshot.phase === 'failed';
      const manualRetry = failed || (snapshot.phase === 'crashed' && !!snapshot.stopped);
      const busy = snapshot.phase === 'starting' || snapshot.phase === 'loading';
      const protocol = bridge.protocol === null ? '' : ' · ' + t('protocol') + ' ' + String(bridge.protocol);
      const bridgeHint = bridge.status === 'ready' ? null
        : (bridge.status === 'mismatch' ? t('bridgeMismatch') : t('bridgeMissing')) + protocol;

      const phaseLine = snapshot.phase === 'starting'
        ? t('starting')
        : snapshot.phase === 'loading'
          ? (snapshot.restoring ? t('restoring') : t('loading'))
          : snapshot.phase === 'crashed'
            ? (snapshot.stopped ? t('crashedStopped') : t('crashed'))
            : failed
              ? t('failed')
              : t('placeholderHint');
      const showCard = snapshot.phase !== 'ready';
      const dotState = snapshot.phase === 'ready' ? 'ok' : 'warn';

      const steps = [];
      if (snapshot.phase === 'idle' || snapshot.phase === 'starting') {
        steps.push({ key: 'connect', state: 'current', label: t('stepConnect') });
        if (snapshot.hasSnapshot) steps.push({ key: 'restore', state: 'pending', label: t('stepRestore') });
        steps.push({ key: 'load', state: 'pending', label: t('stepLoad') });
      } else if (snapshot.phase === 'loading') {
        steps.push({ key: 'connect', state: 'done', label: t('stepConnect') });
        if (snapshot.hasSnapshot || snapshot.restoring) {
          steps.push({ key: 'restore', state: snapshot.restoring ? 'current' : 'done', label: t('stepRestore') });
        }
        steps.push({ key: 'load', state: snapshot.restoring ? 'pending' : 'current', label: t('stepLoad') });
      }

      return h('div', { className: 'aiwa-root' },
        h('style', null, CSS),
        h('div', { className: 'aiwa-toolbar' },
          h('span', { className: 'aiwa-brand' },
            h('span', { className: 'aiwa-dot', 'data-state': dotState }),
            h('span', { className: 'aiwa-title' }, t('title')),
          ),
          snapshot.notice ? h('span', { className: 'aiwa-notice' }, t(snapshot.notice)) : null,
          h('span', { className: 'aiwa-toast', 'data-tone': note ? note.tone : 'ok', role: 'status', 'aria-live': 'polite' },
            note ? note.text : ''),
          h('span', { className: 'aiwa-spacer' }),
          h('button', { className: 'aiwa-btn', type: 'button', onClick: () => controller.refresh() }, t('refresh')),
          h('button', { className: 'aiwa-btn', type: 'button', onClick: () => controller.openExternal() }, t('openExternal')),
          h('button', { className: 'aiwa-btn', type: 'button', onClick: onCopy }, t('copyLink')),
          h('button', { className: 'aiwa-btn aiwa-btn-danger', type: 'button', onClick: onClear }, t('clearLogin')),
        ),
        h('div', { className: 'aiwa-viewport' },
          h('div', { className: 'aiwa-stage', ref: stageRef, 'aria-hidden': 'true' }),
          showCard
            ? h('div', { className: 'aiwa-card' },
              h('div', {
                className: 'aiwa-placeholder',
                'data-state': failed ? 'failed' : 'loading',
                role: 'status',
                'aria-live': 'polite',
              },
                h('div', { className: 'aiwa-mark' }, h(DeepSeekGlyph, { size: 34 })),
                h('div', { className: 'aiwa-placeholder-title' }, t('placeholderTitle')),
                h('div', { className: 'aiwa-phase', 'data-tone': failed ? 'error' : 'busy' }, phaseLine),
                steps.length
                  ? h('ol', { className: 'aiwa-steps' },
                    steps.map((step) => h('li', { key: step.key, className: 'aiwa-step', 'data-state': step.state },
                      h('span', { className: 'aiwa-step-dot', 'aria-hidden': 'true' }),
                      h('span', null, step.label),
                    )),
                  )
                  : null,
                failed && snapshot.error
                  ? h('div', { className: 'aiwa-hint aiwa-error' }, snapshot.error)
                  : null,
                bridgeHint ? h('div', { className: 'aiwa-hint aiwa-hint-dim' }, bridgeHint) : null,
                manualRetry
                  ? h('button', { className: 'aiwa-btn aiwa-btn-primary', type: 'button', onClick: () => controller.refresh() }, t('retry'))
                  : null,
                busy ? h('div', { className: 'aiwa-progress', 'aria-hidden': 'true' }) : null,
              ),
            )
            : null,
        ),
      );
    }

    /**
     * 设置页（`settings.section`）：URL、登录快照状态、立即保存、清除登录。
     * 只读 localStorage 与宿主状态，不碰 lease；面板没打开时保存会给出明确原因。
     */
    function SettingsSection({ t, controller, openPanel, close }) {
      const [hostState, setHostState] = useState(() => controller.host.getState());
      const [info, setInfo] = useState(() => controller.snapshotInfo());
      const [diag, setDiag] = useState(() => controller.diagnostics());
      const [entries, setEntries] = useState(() => controller.logs(LOG_SHOW));
      const [busy, setBusy] = useState(false);
      const [note, setNote] = useState(null);
      const bridge = useMemo(readBridge, []);

      useEffect(() => {
        const refresh = () => {
          setHostState(controller.host.getState());
          setInfo(controller.snapshotInfo());
          setDiag(controller.diagnostics());
          setEntries(controller.logs(LOG_SHOW));
        };
        const unsubscribe = controller.host.subscribe(refresh);
        // 日志不进 host 状态，靠定时器刷新；设置页打开时 1.5s 一次足够。
        const timer = setInterval(refresh, 1500);
        window.addEventListener('focus', refresh);
        refresh();
        return () => {
          unsubscribe();
          clearInterval(timer);
          window.removeEventListener('focus', refresh);
        };
      }, [controller]);

      useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(null), note.tone === 'error' ? 3500 : 2600);
        return () => clearTimeout(timer);
      }, [note]);

      const showNote = (text, tone) => setNote({ text, tone });

      const onOpen = () => {
        if (typeof openPanel === 'function') openPanel();
        if (typeof close === 'function') close();
      };
      const onCopy = () => {
        copyText((info && info.url) || SITE_URL).then((ok) => showNote(ok ? t('copied') : t('copiedFailed'), ok ? 'ok' : 'error'));
      };
      const onSave = async () => {
        if (busy) return;
        setBusy(true);
        try {
          const result = await controller.saveSnapshot();
          setHostState(controller.host.getState());
          setInfo(controller.snapshotInfo());
          showNote(result.ok
            ? t('settingsSavedOk')
            : result.reason === 'signin' ? t('settingsNeedSignin') : t('settingsPanelClosed'),
          result.ok ? 'ok' : 'error');
        } finally {
          setBusy(false);
        }
      };
      const onClear = () => {
        controller.clearLogin();
        setHostState(controller.host.getState());
        setInfo(controller.snapshotInfo());
        showNote(t('settingsCleared'), 'ok');
      };
      const onCopyDiag = () => {
        copyText(buildDiagnosticReport(diag, entries)).then((ok) => showNote(ok ? t('diagCopied') : t('copiedFailed'), ok ? 'ok' : 'error'));
      };
      const onClearLogs = () => {
        controller.clearLogs();
        setEntries(controller.logs(LOG_SHOW));
        showNote(t('diagCleared'), 'ok');
      };

      const statusTone = !info ? 'warn' : info.stale ? 'error' : 'ok';
      const statusText = !info ? t('settingsStatusMissing') : info.stale ? t('settingsStatusStale') : t('settingsStatusSaved');
      const diagTone = diag.phase === 'ready' && !diag.stale && !diag.stopped ? 'ok'
        : (diag.stopped || diag.phase === 'failed' || diag.phase === 'unavailable') ? 'error' : 'warn';
      const diagSnapshotText = (!diag.hasSnapshot ? t('settingsStatusMissing')
        : (diag.stale ? t('settingsStatusStale') : t('settingsStatusSaved')) + ' · ' + String(diag.keys));
      const bridgeText = (bridge.status === 'ready' ? t('settingsBridgeOk')
        : bridge.status === 'mismatch' ? t('bridgeMismatch') : t('settingsBridgeDown'))
        + (bridge.protocol === null ? '' : ' · ' + t('protocol') + ' ' + String(bridge.protocol));
      const ready = hostState.phase === 'ready';

      const row = (key, value, mono) => h('div', { className: 'aiwa-sec-row', key },
        h('span', { className: 'aiwa-sec-key' }, key),
        h('span', { className: mono ? 'aiwa-sec-val aiwa-sec-mono' : 'aiwa-sec-val' }, value),
      );

      return h('div', { className: 'aiwa-sec' },
        h('style', null, CSS),
        h('div', { className: 'aiwa-sec-head' },
          h('div', { className: 'aiwa-sec-title' }, t('settingsTitle')),
          h('div', { className: 'aiwa-sec-desc' }, t('settingsDesc')),
        ),
        h('div', {
          className: 'aiwa-sec-note',
          'data-tone': note ? note.tone : 'ok',
          role: 'status',
          'aria-live': 'polite',
          style: { minHeight: '18px' },
        }, note ? note.text : ''),
        h('div', { className: 'aiwa-sec-card' },
          h('div', { className: 'aiwa-sec-card-head' },
            h('span', { className: 'aiwa-sec-card-title' }, t('settingsTarget')),
            h('span', { className: 'aiwa-spacer' }),
            h('button', { className: 'aiwa-btn aiwa-btn-primary', type: 'button', onClick: onOpen }, t('settingsOpen')),
          ),
          h('div', { className: 'aiwa-sec-note' }, t('settingsTargetValue')),
        ),
        h('div', { className: 'aiwa-sec-card' },
          h('div', { className: 'aiwa-sec-card-head' },
            h('span', { className: 'aiwa-sec-card-title' }, t('settingsSite')),
            h('span', { className: 'aiwa-spacer' }),
            h('button', { className: 'aiwa-btn', type: 'button', onClick: onCopy }, t('settingsCopy')),
          ),
          row(t('settingsUrl'), (info && info.url) || SITE_URL, true),
        ),
        h('div', { className: 'aiwa-sec-card' },
          h('div', { className: 'aiwa-sec-card-head' },
            h('span', { className: 'aiwa-sec-card-title' }, t('settingsSnapshot')),
            h('span', { className: 'aiwa-spacer' }),
            h('span', { className: 'aiwa-pill', 'data-tone': statusTone }, statusText),
          ),
          row(t('settingsSavedAt'), info ? (info.savedAt ? formatTime(info.savedAt) : '—') : '—'),
          info ? row(t('settingsKeys'), String(info.keys)) : null,
          info ? row(t('settingsCookie'), String(info.cookies)) : null,
          info ? row(t('settingsSize'), formatSize(info.size)) : null,
          info ? row(t('settingsSkipped'), String(info.skipped)) : null,
          info ? row(t('settingsTruncated'), info.truncated ? t('yes') : t('no')) : null,
          h('div', { className: 'aiwa-sec-actions' },
            h('button', {
              className: 'aiwa-btn aiwa-btn-primary',
              type: 'button',
              disabled: busy || !ready,
              onClick: onSave,
            }, t('settingsSaveNow')),
            h('button', {
              className: 'aiwa-btn aiwa-btn-danger',
              type: 'button',
              disabled: busy || !info,
              onClick: onClear,
            }, t('settingsClear')),
          ),
          !ready ? h('div', { className: 'aiwa-sec-note' }, t('settingsPanelHint')) : null,
        ),
        h('div', { className: 'aiwa-sec-card' },
          h('div', { className: 'aiwa-sec-card-head' },
            h('span', { className: 'aiwa-sec-card-title' }, t('settingsBridge')),
            h('span', { className: 'aiwa-spacer' }),
            h('span', { className: 'aiwa-pill', 'data-tone': bridge.status === 'ready' ? 'ok' : 'warn' }, bridgeText),
          ),
        ),
        h('div', { className: 'aiwa-sec-card' },
          h('div', { className: 'aiwa-sec-card-head' },
            h('span', { className: 'aiwa-sec-card-title' }, t('settingsDiagnostics')),
            h('span', { className: 'aiwa-spacer' }),
            h('span', { className: 'aiwa-pill', 'data-tone': diagTone }, diag.phase),
          ),
          row(t('diagLease'), diag.lease || '—', true),
          row(t('diagHost'), diag.host || '—', true),
          row(t('diagBackfill'), diag.backfill + (diag.stopped ? ' · stopped' : '')),
          row(t('diagCrashes'), String(diag.crashes) + (diag.suspended ? ' · suspended' : '')),
          row(t('diagSnapshotState'), diagSnapshotText),
          h('div', { className: 'aiwa-sec-actions' },
            h('button', { className: 'aiwa-btn', type: 'button', onClick: onCopyDiag }, t('diagCopy')),
            h('button', {
              className: 'aiwa-btn',
              type: 'button',
              disabled: !entries.length,
              onClick: onClearLogs,
            }, t('diagClear')),
          ),
          h('div', { className: 'aiwa-diag-logs', role: 'log' },
            entries.length
              ? entries.map((entry, index) => h('div', {
                key: index,
                className: 'aiwa-diag-line',
                'data-level': entry.level,
              },
                h('span', { className: 'aiwa-diag-time' }, formatClock(entry.ts)),
                h('span', { className: 'aiwa-diag-text' }, entry.text),
              ))
              : h('div', { className: 'aiwa-sec-note' }, t('diagEmpty')),
          ),
        ),
        h('div', { className: 'aiwa-sec-card' },
          h('div', { className: 'aiwa-sec-card-head' },
            h('span', { className: 'aiwa-sec-card-title' }, t('settingsLimits')),
          ),
          h('ul', { className: 'aiwa-sec-list' },
            h('li', null, t('settingsLimit1')),
            h('li', null, t('settingsLimit2')),
            h('li', null, t('settingsLimit3')),
            h('li', null, t('settingsLimit4')),
          ),
        ),
      );
    }

    /** 工具栏与宿主共用的控制器：宿主在 apply 时创建一次，随插件生命周期释放。 */
    function createController() {
      const host = createHost();
      return {
        host,
        /** 设置页只读的快照摘要；不返回任何值，只有键数/条数/时间/标记。 */
        snapshotInfo() {
          const site = readSnapshotSite();
          if (!site) return null;
          let size = 0;
          try {
            const raw = localStorage.getItem(SNAPSHOT_KEY);
            size = raw ? raw.length : 0;
          } catch (error) {
            size = 0;
          }
          const stored = site.localStorage && typeof site.localStorage === 'object' ? site.localStorage : {};
          const cookie = typeof site.cookie === 'string' ? site.cookie : '';
          return {
            savedAt: typeof site.savedAt === 'number' ? site.savedAt : 0,
            url: typeof site.url === 'string' && site.url ? site.url : SITE_URL,
            stale: site.stale === true,
            keys: Object.keys(stored).length,
            cookies: countCookies(cookie),
            size,
            skipped: typeof site.skipped === 'number' ? site.skipped : 0,
            truncated: site.truncated === true,
          };
        },
        /** 立即采集；失败时给出原因，供设置页写清「为什么没保存」。 */
        async saveSnapshot() {
          const site = await host.collectSnapshot();
          if (site) return { ok: true, reason: null };
          return { ok: false, reason: host.getState().phase === 'ready' ? 'signin' : 'closed' };
        },
        /** 设置页诊断卡：状态摘要 + 最近日志；两者都只读。 */
        diagnostics() {
          return host.diagnostics();
        },
        logs(count) {
          return host.logEntries(count);
        },
        clearLogs() {
          host.clearLogs();
        },
        clearLogin() {
          host.clearSnapshot();
        },
        refresh() {
          host.reload();
        },
        openExternal() {
          host.openExternal(SITE_URL);
        },
      };
    }

    return {
      inject: ['slots', 'layout', 'locale'],
      // 纯函数出口，供 `node --test` 使用；宿主只读 inject/apply，忽略未知字段。
      __test: {
        zh,
        en,
        GUEST_PROBE_SCRIPT,
        GUEST_COLLECT_SCRIPT,
        buildInjectScript,
        redactLog,
        formatLog,
        formatClock,
        formatTime,
        formatSize,
        countCookies,
        probeVerdict,
        needsProbeRetry,
        decideCrashRestart,
        shouldStart,
        isAbortedNavigation,
        readBridge,
        buildDiagnosticReport,
        createLogRing,
      },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'aiwa: dictionaries');
        const t = ctx.locale.bind(NS);
        const controller = createController();
        const bridgeInfo = readBridge();

        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 50,
          label: () => t('panel'),
          locale: NS,
        }, DeepSeekGlyph)), 'aiwa: sidebar entry');

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ controller }),
        }, MainPanel)), 'aiwa: main panel');

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'ai-webapps-host',
          order: 60,
          locale: NS,
          inject: () => ({ controller }),
        }, HostOverlay)), 'aiwa: guest host');

        const openPanel = () => {
          try {
            ctx.layout.selectPanel(PANEL_ID);
          } catch (error) {
            log('warn', '[aiwa] open panel from settings failed', error && error.message);
          }
        };

        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: NS,
          order: 55,
          label: () => t('settingsNav'),
          locale: NS,
          inject: () => ({ controller, openPanel }),
        }, SettingsSection)), 'aiwa: settings section');

        // dsh 0.2.2 起有独立的导航图标位；宿主不声明该槽时 inject 只是等待，不报错。
        ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: NS,
        }, (owner = {}) => h(DeepSeekGlyph, { size: owner.size ?? 16 }))), 'aiwa: settings nav icon');

        // 插件卸载 / HMR：释放 lease、移除容器、断开观察者。
        ctx.effect(() => () => controller.host.dispose(), 'aiwa: guest lifetime');

        // T13：只在页面本次运行的首次 apply 生效；插件 HMR 重载不应把正在看面板的用户踢回会话。
        if (!globalThis.__aiwaStartupGuarded) {
          globalThis.__aiwaStartupGuarded = true;
          ctx.effect(() => {
            try {
              const info = ctx.layout.panelInfo;
              const active = info && typeof info.getSnapshot === 'function' ? info.getSnapshot().activePanelId : null;
              if (active === PANEL_ID) {
                log('log', '[aiwa] active panel was this panel; selectPanel(null) back to conversation');
                ctx.layout.selectPanel(null);
              }
            } catch (error) {
              log('warn', '[aiwa] startup panel guard failed', error && error.message);
            }
          }, 'aiwa: startup panel guard');
        }

        log('log', '[aiwa] client ready; bridge=%s protocol=%s', bridgeInfo.ready ? 'ok' : 'unavailable',
          bridgeInfo.protocol === null ? 'n/a' : String(bridgeInfo.protocol));
      },
    };
  },
});

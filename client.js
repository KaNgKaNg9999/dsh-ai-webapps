/**
 * Client 半区（M0-C）：左栏 DeepSeek 入口 + 主面板（工具栏 + 占位区）。
 * - webview / 宿主 overlay 在 M0-B 接入，快照采集回填在 M0-D，设置页在 M0-E。
 * - 契约：id 必须等于包名 dsh-ai-webapps；只 require('react')，不引 @deepseek-ai/* Client 包。
 * - 本步骤不含 `[inert]` 处理：没有 guest 可 blur，随 B 的 overlay 一起落地。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ai-webapps',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useMemo, useState } = React;

    const NS = 'ai-webapps';
    const PANEL_ID = 'ai-webapps:deepseek';
    const SITE_URL = 'https://chat.deepseek.com/';
    const SNAPSHOT_KEY = 'dsh-ai-webapps.snapshot.v1';

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
      placeholderHint: '内容区在下一步接入；当前只验证左栏入口与主面板。',
      bridgeReady: '桌面桥：可用',
      bridgeMissing: '桌面桥：不可用（需要 DSH 桌面端）',
      bridgeMismatch: '桌面桥：协议版本不符',
      protocol: '协议',
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
      placeholderHint: 'The content area arrives in the next step; this step verifies the sidebar entry and the main panel.',
      bridgeReady: 'Desktop bridge: available',
      bridgeMissing: 'Desktop bridge: unavailable (DSH Desktop required)',
      bridgeMismatch: 'Desktop bridge: protocol mismatch',
      protocol: 'protocol',
    };

    const CSS = [
      '.aiwa-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.aiwa-toolbar{display:flex;align-items:center;gap:8px;flex:none;height:44px;padding:0 12px;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
      '.aiwa-brand{display:flex;align-items:center;gap:8px;min-width:0}',
      '.aiwa-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-warn-primary)}',
      '.aiwa-dot[data-state="ok"]{background:var(--dsw-alias-state-success-primary)}',
      '.aiwa-title{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.aiwa-spacer{flex:1}',
      '.aiwa-btn{font:inherit;font-size:12px;line-height:20px;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.aiwa-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.aiwa-btn:active{background:var(--dsw-alias-interactive-bg-active)}',
      '.aiwa-btn-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}',
      '.aiwa-viewport{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px}',
      '.aiwa-placeholder{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:460px;padding:28px 32px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;text-align:center}',
      '.aiwa-placeholder-title{font-size:14px;font-weight:500}',
      '.aiwa-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.aiwa-note{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:4px 12px}',
    ].join('');

    /** 读取桌面桥：只报告存在性与协议版本，不触碰任何凭据。 */
    function readBridge() {
      const desktop = globalThis.dshDesktop;
      const bridge = desktop ? desktop.browser : null;
      const protocol = bridge && bridge.protocolVersion !== undefined ? bridge.protocolVersion : null;
      return { bridge, protocol, ready: !!bridge && protocol === 1 };
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
        console.warn('[aiwa] copy fallback failed', error && error.message);
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

    function MainPanel({ t, controller }) {
      const [note, setNote] = useState('');
      const bridge = useMemo(readBridge, []);

      useEffect(() => {
        if (!note) return undefined;
        const timer = setTimeout(() => setNote(''), 2200);
        return () => clearTimeout(timer);
      }, [note]);

      const onCopy = () => {
        copyText(SITE_URL).then((ok) => setNote(ok ? t('copied') : t('copiedFailed')));
      };
      const onClear = () => {
        try {
          localStorage.removeItem(SNAPSHOT_KEY);
          console.log('[aiwa] snapshot cleared');
          setNote(t('cleared'));
        } catch (error) {
          console.warn('[aiwa] clear snapshot failed', error && error.message);
        }
      };

      const status = bridge.ready
        ? t('bridgeReady')
        : bridge.bridge ? t('bridgeMismatch') : t('bridgeMissing');
      const protocol = bridge.protocol === null ? '' : ' · ' + t('protocol') + ' ' + String(bridge.protocol);

      return h('div', { className: 'aiwa-root' },
        h('style', null, CSS),
        h('div', { className: 'aiwa-toolbar' },
          h('span', { className: 'aiwa-brand' },
            h('span', { className: 'aiwa-dot', 'data-state': bridge.ready ? 'ok' : 'warn' }),
            h('span', { className: 'aiwa-title' }, t('title')),
          ),
          h('span', { className: 'aiwa-spacer' }),
          h('button', { className: 'aiwa-btn', type: 'button', onClick: () => controller.refresh() }, t('refresh')),
          h('button', { className: 'aiwa-btn', type: 'button', onClick: () => controller.openExternal() }, t('openExternal')),
          h('button', { className: 'aiwa-btn', type: 'button', onClick: onCopy }, t('copyLink')),
          h('button', { className: 'aiwa-btn aiwa-btn-danger', type: 'button', onClick: onClear }, t('clearLogin')),
        ),
        h('div', { className: 'aiwa-viewport' },
          h('div', { className: 'aiwa-placeholder' },
            h(DeepSeekGlyph, { size: 40 }),
            h('div', { className: 'aiwa-placeholder-title' }, t('placeholderTitle')),
            h('div', { className: 'aiwa-hint' }, t('placeholderHint')),
            h('div', { className: 'aiwa-hint' }, status + protocol),
          ),
          note ? h('div', { className: 'aiwa-note' }, note) : null,
        ),
      );
    }

    /** 工具栏动作：B 接入 webview 后由宿主控制器覆盖 onRefresh / onOpenExternal。 */
    function createController() {
      const controller = {
        onRefresh: null,
        onOpenExternal: null,
        refresh() {
          if (controller.onRefresh) {
            controller.onRefresh();
            return;
          }
          console.log('[aiwa] refresh requested; webview 尚未接入（M0-B）');
        },
        openExternal() {
          if (controller.onOpenExternal) {
            controller.onOpenExternal();
            return;
          }
          console.log('[aiwa] open-in-system-browser requested; 桥接方式待 M0-B 确认');
        },
      };
      return controller;
    }

    return {
      inject: ['slots', 'layout', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'aiwa: dictionaries');
        const t = ctx.locale.bind(NS);
        const controller = createController();

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

        // T13：启动时若选中态停在本面板，强制回会话，避免重启后自动停在站点面板。
        ctx.effect(() => {
          try {
            const info = ctx.layout.panelInfo;
            const active = info && typeof info.getSnapshot === 'function' ? info.getSnapshot().activePanelId : null;
            if (active === PANEL_ID) {
              console.log('[aiwa] active panel was this panel; selectPanel(null) back to conversation');
              ctx.layout.selectPanel(null);
            }
          } catch (error) {
            console.warn('[aiwa] startup panel guard failed', error && error.message);
          }
        }, 'aiwa: startup panel guard');

        console.log('[aiwa] client ready; bridge=%s', readBridge().ready ? 'ok' : 'unavailable');
      },
    };
  },
});

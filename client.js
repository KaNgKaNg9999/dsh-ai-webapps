/**
 * Client 半区（M0-B）：左栏入口 + 主面板工具栏 + 常驻宿主 webview。
 * - 宿主：`shell.overlay` 单例容器，`position:fixed`，永不 reparent（每个 lease 只能 attach 一次）。
 * - 占位 div 只提供几何；隐藏只改 visibility/pointer-events 并移出视口，guest 不重建。
 * - 快照采集/回填在 M0-D，设置页在 M0-E；本步骤不含 executeJavaScript。
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
    const HIDDEN_TRANSFORM = 'translateX(-200vw)';
    const CRASH_RESTART_DELAY_MS = 600;
    const MAX_CRASH_RESTARTS = 3;

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
      failed: '页面加载失败',
      crashed: '页面已崩溃，正在重建…',
      retry: '刷新重试',
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
      placeholderHint: 'The live page is hosted outside the panel, so switching panels never reloads it.',
      starting: 'Preparing the web container…',
      loading: 'Loading DeepSeek…',
      failed: 'The page failed to load',
      crashed: 'The page crashed; rebuilding…',
      retry: 'Reload',
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
      '.aiwa-toast{font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.aiwa-btn{font:inherit;font-size:12px;line-height:20px;padding:3px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.aiwa-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.aiwa-btn:active{background:var(--dsw-alias-interactive-bg-active)}',
      '.aiwa-btn-danger:hover{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-secondary)}',
      '.aiwa-viewport{position:relative;flex:1;min-height:0;overflow:hidden}',
      '.aiwa-stage{position:absolute;inset:0}',
      '.aiwa-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:none}',
      '.aiwa-placeholder{display:flex;flex-direction:column;align-items:center;gap:8px;max-width:480px;padding:28px 32px;border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;text-align:center;pointer-events:auto;background:var(--dsw-alias-bg-base)}',
      '.aiwa-placeholder-title{font-size:14px;font-weight:500}',
      '.aiwa-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.aiwa-host{position:fixed;left:0;top:0;width:0;height:0;z-index:1;overflow:hidden;visibility:hidden;pointer-events:none;background:var(--dsw-alias-bg-base)}',
      '.aiwa-guest{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--dsw-alias-bg-base)}',
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
     * 宿主控制器：持有一个 lease 与一个 webview，永不 reparent。
     * 对外只有显隐、几何、刷新、打开外部和状态订阅；任何失败都不抛给 React。
     */
    function createHost() {
      const listeners = new Set();
      const bridgeInfo = readBridge();
      let state = {
        phase: bridgeInfo.ready ? 'idle' : 'unavailable',
        error: null,
        title: '',
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

      function emit(patch) {
        state = Object.assign({}, state, patch);
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.warn('[aiwa] host listener failed', error && error.message);
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
        const visible = !!rect && active && !suspended && webview !== null
          && (state.phase === 'ready' || state.phase === 'loading');
        container.style.visibility = visible ? 'visible' : 'hidden';
        container.style.pointerEvents = visible ? 'auto' : 'none';
        container.style.transform = visible ? 'none' : HIDDEN_TRANSFORM;
        maybeStart();
      }

      function maybeStart() {
        if (disposed || starting || webview !== null) return;
        if (state.phase !== 'idle') return;
        if (!active || suspended || !placeholderRect()) return;
        if (!bridgeInfo.ready) {
          if (state.phase !== 'unavailable') emit({ phase: 'unavailable' });
          return;
        }
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
        const write = level === 3 || level === 'error'
          ? console.error
          : level === 2 || level === 'warning' ? console.warn : console.log;
        write.call(console, '[aiwa][guest] %s', message);
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
          console.log('[aiwa] guest load attempt %d: %s', loadAttempts, SITE_URL);
          const loading = element.loadURL(SITE_URL);
          if (!loading || typeof loading.catch !== 'function') return;
          loading.catch((error) => {
            if (webview !== element) return;
            if (isAbortedNavigation(error)) {
              console.warn('[aiwa] guest load aborted (redirect or superseded); waiting for navigation events');
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
          if (siteLoadStarted) return;
          siteLoadStarted = true;
          emit({ phase: 'loading', error: null });
          console.log('[aiwa] guest dom-ready; loading %s', SITE_URL);
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
          if (state.phase !== 'failed' && state.phase !== 'crashed') emit({ phase: 'loading' });
        });
        on('did-stop-loading', () => {
          if (!committed()) return;
          crashes = 0;
          emit({ phase: 'ready', error: null });
        });
        on('did-finish-load', () => {
          if (!committed()) return;
          crashes = 0;
          emit({ phase: 'ready', error: null });
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
          console.warn('[aiwa] guest release failed', error && error.message);
        }
      }

      async function teardown() {
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
        console.warn('[aiwa] guest failed: %s', message);
        emit({ phase: 'failed', error: message || null });
        void teardown();
      }

      function crash(reason) {
        console.warn('[aiwa] guest gone: %s', reason);
        crashes += 1;
        emit({ phase: 'crashed', error: reason });
        void teardown().then(() => {
          if (disposed || !active || suspended) return;
          if (crashes > MAX_CRASH_RESTARTS) {
            console.warn('[aiwa] guest crash limit reached; waiting for a manual refresh');
            return;
          }
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
        emit({ phase: 'starting', error: null });
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
          console.log('[aiwa] guest attached; lease=%s partition=%s', lease, partition);
          applyGeometry();
        } catch (error) {
          console.warn('[aiwa] guest attach failed', error && error.message);
          emit({ phase: 'failed', error: (error && error.message) || 'attach failed' });
          await teardown();
        } finally {
          starting = false;
        }
      }

      function reload() {
        if (disposed) return;
        if (starting) {
          console.log('[aiwa] reload ignored while the guest is starting');
          return;
        }
        crashes = 0;
        if (webview) {
          try {
            webview.reload();
            console.log('[aiwa] guest reload requested');
            return;
          } catch (error) {
            console.warn('[aiwa] guest reload failed', error && error.message);
          }
        }
        emit({ phase: 'idle', error: null });
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
          console.log('[aiwa] open in system browser: %s', target);
          // 主进程的主窗口 setWindowOpenHandler 会把 http(s) 交给系统浏览器并 deny 新窗口。
          window.open(target, '_blank', 'noopener,noreferrer');
        } catch (error) {
          console.warn('[aiwa] open in system browser failed', error && error.message);
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
      const [note, setNote] = useState('');
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

      const status = bridge.status === 'ready'
        ? t('bridgeReady')
        : bridge.status === 'mismatch' ? t('bridgeMismatch') : t('bridgeMissing');
      const protocol = bridge.protocol === null ? '' : ' · ' + t('protocol') + ' ' + String(bridge.protocol);

      const phaseLine = snapshot.phase === 'starting'
        ? t('starting')
        : snapshot.phase === 'loading'
          ? t('loading')
          : snapshot.phase === 'crashed'
            ? t('crashed')
            : snapshot.phase === 'failed'
              ? t('failed')
              : t('placeholderHint');
      const showCard = snapshot.phase !== 'ready';
      const dotState = snapshot.phase === 'ready' ? 'ok' : 'warn';

      return h('div', { className: 'aiwa-root' },
        h('style', null, CSS),
        h('div', { className: 'aiwa-toolbar' },
          h('span', { className: 'aiwa-brand' },
            h('span', { className: 'aiwa-dot', 'data-state': dotState }),
            h('span', { className: 'aiwa-title' }, t('title')),
          ),
          note ? h('span', { className: 'aiwa-toast' }, note) : null,
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
              h('div', { className: 'aiwa-placeholder' },
                h(DeepSeekGlyph, { size: 40 }),
                h('div', { className: 'aiwa-placeholder-title' }, t('placeholderTitle')),
                h('div', { className: 'aiwa-hint' }, phaseLine),
                snapshot.phase === 'failed' && snapshot.error
                  ? h('div', { className: 'aiwa-hint' }, snapshot.error)
                  : null,
                h('div', { className: 'aiwa-hint' }, status + protocol),
                snapshot.phase === 'failed'
                  ? h('button', { className: 'aiwa-btn', type: 'button', onClick: () => controller.refresh() }, t('retry'))
                  : null,
              ),
            )
            : null,
        ),
      );
    }

    /** 工具栏与宿主共用的控制器：宿主在 apply 时创建一次，随插件生命周期释放。 */
    function createController() {
      const host = createHost();
      return {
        host,
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
                console.log('[aiwa] active panel was this panel; selectPanel(null) back to conversation');
                ctx.layout.selectPanel(null);
              }
            } catch (error) {
              console.warn('[aiwa] startup panel guard failed', error && error.message);
            }
          }, 'aiwa: startup panel guard');
        }

        console.log('[aiwa] client ready; bridge=%s protocol=%s', bridgeInfo.ready ? 'ok' : 'unavailable',
          bridgeInfo.protocol === null ? 'n/a' : String(bridgeInfo.protocol));
      },
    };
  },
});

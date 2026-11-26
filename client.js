/**
 * Client 半区（M0-A 骨架）：只探测 `dshDesktop.browser` 桥是否可用。
 * 面板 / webview / 快照将在 M0-B、M0-C、M0-D 逐步加入；此处保持无副作用注册。
 * 契约：id 必须等于包名 dsh-ai-webapps；只 require('react')，不引 @deepseek-ai/* Client 包。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ai-webapps',
  factory(require) {
    require('react');

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const bridge = globalThis.dshDesktop ? globalThis.dshDesktop.browser : null;
          const protocol = bridge ? bridge.protocolVersion : null;
          console.log(
            '[aiwa] client loaded; bridge=%s protocol=%s',
            bridge ? 'present' : 'absent',
            protocol === null ? '-' : String(protocol),
          );
          if (!bridge) {
            console.warn('[aiwa] dshDesktop.browser 不可用：面板将降级为提示，不建 guest');
          } else if (protocol !== 1) {
            console.warn('[aiwa] 桥协议版本不符：期望 1，实际 ' + String(protocol));
          }
          return () => console.log('[aiwa] client disposed');
        });
      },
    };
  },
});

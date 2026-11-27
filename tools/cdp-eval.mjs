#!/usr/bin/env node
// tools/cdp-eval.mjs — 通过 Chrome DevTools Protocol 在 DSH 宿主渲染进程里执行 JS、抓 console、抓网络。
//
// 为什么需要它：DSH 打包版把「应用 → 开发者工具」做成可点但无窗口的无效项，
// 主窗口默认也没有 --remote-debugging-port，因此没有别的办法在宿主渲染进程取证。
// 本脚本只读地连本机调试端口（`crash` 模式除外，它按用户要求注入一次页面崩溃），
// 不修改 DSH 安装目录，也不碰 profile。
//
// 前提：DSH 以调试端口启动，例如
//   & "D:\software\DeepSeek Harness\DeepSeek Harness.exe" --remote-debugging-port=9222
//
// 用法：
//   node tools/cdp-eval.mjs list                              列出可连的 target
//   node tools/cdp-eval.mjs eval "<表达式>"                   在宿主页面求值，打印 JSON 结果
//   node tools/cdp-eval.mjs listen <秒> ["<触发>"]            先订阅 console，再执行触发表达式
//   node tools/cdp-eval.mjs net <秒> ["<URL 子串>"]           订阅网络请求，打印方法/状态/路径（不含 query）
//   node tools/cdp-eval.mjs watch <秒> ["<URL 子串>"]         等一个新 target（如崩溃重建后的 guest）再抓网络
//   node tools/cdp-eval.mjs crash                            在目标页面注入一次崩溃（Page.crash）
//
// 通用选项（放在模式后面）：
//   --target <URL 子串>   选择 guest 目标（默认选宿主页面）；可用 list 里的 url/title 片段
//   --body                 net 模式：对匹配的 JSON 响应，只打印白名单字段的值
//   --body-keys code,msg   net 模式配合 --body，指定白名单字段（默认 code,msg）
//
// 日志里只打印键名/状态/错误码/路径，不打印 token、cookie 值，也不打印响应体全文。

const PORT = process.env.CDP_PORT || '9222';
const BASE = `http://127.0.0.1:${PORT}`;
const DEFAULT_BODY_KEYS = ['code', 'msg'];

async function listTargets() {
  let res;
  try {
    res = await fetch(`${BASE}/json/list`);
  } catch {
    throw new Error(`连不上 ${BASE}；DSH 是否以 --remote-debugging-port=${PORT} 启动？`);
  }
  if (!res.ok) throw new Error(`GET ${BASE}/json/list -> HTTP ${res.status}`);
  return res.json();
}

/** 解析通用选项，返回剩余参数（模式 + 位置参数）。 */
function parseOptions(argv) {
  const options = { target: '', body: false, bodyKeys: DEFAULT_BODY_KEYS };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const cut = arg.indexOf('=');
    const key = cut >= 0 ? arg.slice(0, cut) : arg;
    const inline = cut >= 0 ? arg.slice(cut + 1) : null;
    if (key === '--target') {
      options.target = inline !== null ? inline : (argv[(index += 1)] || '');
    } else if (key === '--body') {
      options.body = true;
    } else if (key === '--body-keys') {
      const value = inline !== null ? inline : (argv[(index += 1)] || '');
      const keys = value.split(',').map((entry) => entry.trim()).filter(Boolean);
      if (keys.length) options.bodyKeys = keys;
    } else {
      rest.push(arg);
    }
  }
  return { options, rest };
}

/** 宿主页面：URL 指向本机 web 服务的那个 page target。 */
function pickHostPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  return pages.find((t) => /127\.0\.0\.1|localhost/.test(t.url || '')) || pages[0] || null;
}

/**
 * 目标选择：给了 --target 就按 url/title 子串找（guest webview 也在其中），
 * 没给就沿用宿主页面。
 */
function pickTarget(targets, substring) {
  const candidates = targets.filter((t) => t.webSocketDebuggerUrl);
  if (!substring) return pickHostPage(targets);
  return candidates.find((t) => (t.url || '').includes(substring))
    || candidates.find((t) => (t.title || '').includes(substring))
    || null;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Set();
  }

  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.addEventListener('open', () => resolve(this));
      ws.addEventListener('error', (event) => reject(new Error(`WebSocket error: ${event.message || 'unknown'}`)));
      ws.addEventListener('message', (event) => this.#onMessage(event.data));
      ws.addEventListener('close', () => {
        for (const { reject: rej } of this.pending.values()) rej(new Error('CDP socket closed'));
        this.pending.clear();
      });
    });
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else entry.resolve(msg.result);
      return;
    }
    for (const handler of this.handlers) handler(msg);
  }

  on(handler) {
    this.handlers.add(handler);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`求值抛异常: ${text}`);
  }
  return result.result?.value;
}

function print(value) {
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

/** 把 CDP 的 consoleAPICalled 事件压成一行可读文本。 */
function formatConsole(params) {
  const args = (params.args || []).map((arg) => {
    if (arg.value !== undefined) return String(arg.value);
    if (arg.description !== undefined) return arg.description;
    return arg.type;
  });
  return `[${params.type}] ${args.join(' ')}`;
}

/** 只保留主机名与路径，丢掉 query/fragment（里面可能有凭据）。 */
function safePath(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.host + url.pathname;
  } catch {
    return String(rawUrl).split('?')[0];
  }
}

function matches(filter, rawUrl) {
  if (!filter) return true;
  return String(rawUrl || '').includes(filter) || safePath(rawUrl).includes(filter);
}

/** 白名单字段取值：只取指定键，字符串截断，避免把响应体里的凭据带出来。 */
function pickBodyFields(text, keys) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const picked = {};
  for (const key of keys) {
    if (value[key] === undefined) continue;
    const field = value[key];
    picked[key] = typeof field === 'string' && field.length > 160 ? field.slice(0, 160) + '…' : field;
  }
  return Object.keys(picked).length ? picked : null;
}

/** 在已连上的 target 里监听网络，打印方法/状态/路径；`--body` 时只回白名单字段。 */
async function captureNetwork(cdp, seconds, filter, options) {
  const requests = new Map(); // requestId -> { method, path, matched }
  await cdp.send('Network.enable');
  cdp.on((msg) => {
    const { method, params } = msg;
    if (method === 'Network.requestWillBeSent') {
      const matched = matches(filter, params.request.url);
      requests.set(params.requestId, { method: params.request.method, path: safePath(params.request.url), matched });
      if (matched) console.log(`req  ${params.request.method} ${safePath(params.request.url)}`);
      return;
    }
    if (method === 'Network.responseReceived') {
      const known = requests.get(params.requestId);
      if (!known || !known.matched) return;
      console.log(`res  ${params.response.status} ${known.method} ${safePath(params.response.url) || known.path}` +
        (params.type ? ` (${params.type})` : ''));
      return;
    }
    if (method === 'Network.loadingFailed') {
      const known = requests.get(params.requestId);
      if (!known || !known.matched) return;
      console.log(`fail ${known.method} ${known.path} ${params.errorText || 'unknown'}`);
      return;
    }
    if (method === 'Network.loadingFinished' && options.body) {
      const known = requests.get(params.requestId);
      if (!known || !known.matched) return;
      cdp.send('Network.getResponseBody', { requestId: params.requestId }).then((body) => {
        if (!body || body.base64Encoded) return;
        const picked = pickBodyFields(body.body, options.bodyKeys);
        if (picked) console.log(`body ${known.path} ${JSON.stringify(picked)}`);
      }).catch(() => {});
    }
  });
  if (filter) console.log(`（监听 ${String(seconds)}s，过滤 ${JSON.stringify(filter)}）`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main() {
  const { options, rest } = parseOptions(process.argv.slice(2));
  const [mode, ...args] = rest;

  if (!mode || mode === 'list') {
    const targets = await listTargets();
    if (!targets.length) console.log('（没有可连的 target）');
    for (const t of targets) {
      console.log(`${t.type}\t${t.title || '(no title)'}\t${t.url || ''}`);
    }
    return;
  }

  const targets = await listTargets();

  // watch：等一个「新出现」的 target（例如崩溃重建后的 guest），连上去抓网络。
  if (mode === 'watch') {
    const seconds = Number(args[0] || 20);
    const filter = args.slice(1).join(' ').trim();
    const before = new Set(targets.map((t) => t.id));
    const deadline = Date.now() + seconds * 1000;
    let target = null;
    while (Date.now() < deadline) {
      const list = await listTargets();
      target = list.find((t) => t.webSocketDebuggerUrl && !before.has(t.id)
        && (!options.target || (t.url || '').includes(options.target) || (t.title || '').includes(options.target)));
      if (target) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!target) throw new Error(`等待新 target 超时${options.target ? `（--target ${JSON.stringify(options.target)} 是否匹配？）` : '（先触发一次崩溃/重建）'}`);
    console.log(`watch target: ${target.type} ${target.url}`);
    const guest = await new Cdp(target.webSocketDebuggerUrl).open();
    try {
      await captureNetwork(guest, seconds, filter, options);
    } finally {
      guest.close();
    }
    return;
  }

  const page = pickTarget(targets, options.target);
  if (!page) {
    throw new Error(options.target
      ? `没有 URL/title 含 ${JSON.stringify(options.target)} 的 target，先用 list 看清单`
      : '没有可连的 page target，DSH 是否以 --remote-debugging-port 启动？');
  }
  const cdp = await new Cdp(page.webSocketDebuggerUrl).open();

  try {
    if (mode === 'eval') {
      const expression = args.join(' ');
      if (!expression) throw new Error('eval 需要表达式');
      print(await evaluate(cdp, expression));
      return;
    }

    if (mode === 'listen') {
      const seconds = Number(args[0] || 5);
      const trigger = args.slice(1).join(' ');
      const seen = [];
      await cdp.send('Runtime.enable');
      await cdp.send('Log.enable').catch(() => {});
      cdp.on((msg) => {
        if (msg.method === 'Runtime.consoleAPICalled') seen.push(formatConsole(msg.params));
        if (msg.method === 'Log.entryAdded') {
          const e = msg.params.entry;
          seen.push(`[log:${e.level}] ${e.text}`);
        }
      });
      if (trigger) {
        await evaluate(cdp, trigger).catch((error) => seen.push(`[trigger-error] ${error.message}`));
      }
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      if (!seen.length) console.log('（没有捕获到任何 console 输出）');
      else seen.forEach((line) => console.log(line));
      return;
    }

    if (mode === 'net') {
      const seconds = Number(args[0] || 5);
      const filter = args.slice(1).join(' ').trim();
      await captureNetwork(cdp, seconds, filter, options);
      return;
    }

    if (mode === 'crash') {
      // Page.crash 会让渲染进程直接消失，命令可能没有返回；不等它。
      const crashed = cdp.send('Page.crash').then(() => 'returned', (error) => `error: ${error.message}`);
      const result = await Promise.race([crashed, new Promise((resolve) => setTimeout(() => resolve('sent'), 1500))]);
      console.log(`crash ${result}`);
      return;
    }

    throw new Error(`未知模式: ${mode}（可用: list / eval / listen / net / watch / crash）`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(`cdp-eval 失败: ${error.message}`);
  process.exitCode = 1;
});

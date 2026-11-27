#!/usr/bin/env node
// tools/cdp-eval.mjs — 通过 Chrome DevTools Protocol 在 DSH 宿主渲染进程里执行 JS、抓 console。
//
// 为什么需要它：DSH 打包版把「应用 → 开发者工具」做成可点但无窗口的无效项，
// 主窗口默认也没有 --remote-debugging-port，因此没有别的办法在宿主渲染进程取证。
// 本脚本只读地用 CDP 连本机调试端口，不修改 DSH 安装目录，也不碰 profile。
//
// 前提：DSH 以调试端口启动，例如
//   & "D:\software\DeepSeek Harness\DeepSeek Harness.exe" --remote-debugging-port=9222
//
// 用法：
//   node tools/cdp-eval.mjs list                     列出可连的 target
//   node tools/cdp-eval.mjs eval "<表达式>"          在宿主页面求值，打印 JSON 结果
//   node tools/cdp-eval.mjs listen <秒> ["<触发>"]   先订阅 console，再执行触发表达式，收集并打印
//
// 日志里只打印键名/状态/错误码，不打印 token、cookie 值。

const PORT = process.env.CDP_PORT || '9222';
const BASE = `http://127.0.0.1:${PORT}`;

async function listTargets() {
  const res = await fetch(`${BASE}/json/list`);
  if (!res.ok) throw new Error(`GET ${BASE}/json/list -> HTTP ${res.status}`);
  return res.json();
}

/** 宿主页面：URL 指向本机 web 服务的那个 page target。 */
function pickHostPage(targets) {
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  return pages.find((t) => /127\.0\.0\.1|localhost/.test(t.url || '')) || pages[0] || null;
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

async function main() {
  const [mode, ...rest] = process.argv.slice(2);

  if (!mode || mode === 'list') {
    const targets = await listTargets();
    for (const t of targets) {
      console.log(`${t.type}\t${t.title || '(no title)'}\t${t.url || ''}`);
    }
    return;
  }

  const targets = await listTargets();
  const page = pickHostPage(targets);
  if (!page) throw new Error('没有可连的 page target，DSH 是否以 --remote-debugging-port 启动？');
  const cdp = await new Cdp(page.webSocketDebuggerUrl).open();

  try {
    if (mode === 'eval') {
      const expression = rest.join(' ');
      if (!expression) throw new Error('eval 需要表达式');
      print(await evaluate(cdp, expression));
      return;
    }

    if (mode === 'listen') {
      const seconds = Number(rest[0] || 5);
      const trigger = rest.slice(1).join(' ');
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

    throw new Error(`未知模式: ${mode}（可用: list / eval / listen）`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  console.error(`cdp-eval 失败: ${error.message}`);
  process.exitCode = 1;
});

// test/loader.mjs — 用最小桩加载 client.js，取出 `__test` 纯函数出口。
// 不依赖 DOM / React 真实实现；被测函数必须保持无宿主依赖。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/** 加载 client.js；storage 为初始 localStorage 内容。 */
export function loadClient({ dshDesktop = null, storage = {} } = {}) {
  const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
  const captured = { spec: null };
  const store = new Map(Object.entries(storage));
  const localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    get length() { return store.size; },
    key: (index) => [...store.keys()][index] ?? null,
  };
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    Date,
    JSON,
    Promise,
    localStorage,
    navigator: {},
    document: {
      addEventListener() {},
      removeEventListener() {},
      querySelector() { return null; },
      visibilityState: 'visible',
    },
    dshDesktop: dshDesktop || undefined,
  };
  sandbox.window = {
    __ModuleLoader__: { load: (spec) => { captured.spec = spec; } },
    addEventListener() {},
    removeEventListener() {},
    navigator: sandbox.navigator,
    localStorage,
    document: sandbox.document,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  if (!captured.spec) throw new Error('client.js 没有调用 window.__ModuleLoader__.load');
  const mod = captured.spec.factory((name) => {
    if (name === 'react') return React;
    throw new Error(`unexpected require: ${name}`);
  });
  if (!mod || typeof mod.apply !== 'function') throw new Error('模块没有返回 apply');
  if (!mod.__test) throw new Error('模块没有返回 __test 出口');
  return { mod, test: mod.__test, sandbox, store, root };
}

/** 在隔离 vm 里执行 guest 内脚本（探针/采集/注入），返回解析后的结果。 */
export function runGuestScript(script, { entries = {}, cookie = '', pathname = '/' } = {}) {
  const store = new Map(Object.entries(entries));
  const cookieWrites = [];
  const sandbox = {
    JSON,
    Object,
    Array,
    String,
    Number,
    localStorage: {
      get length() { return store.size; },
      key: (index) => [...store.keys()][index] ?? null,
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
    },
    location: { href: `https://chat.deepseek.com${pathname}`, pathname },
  };
  sandbox.document = {};
  Object.defineProperty(sandbox.document, 'cookie', {
    get: () => cookie,
    set: (value) => { cookieWrites.push(value); },
  });
  vm.createContext(sandbox);
  const raw = vm.runInContext(script, sandbox);
  return { result: JSON.parse(raw), store, cookieWrites };
}

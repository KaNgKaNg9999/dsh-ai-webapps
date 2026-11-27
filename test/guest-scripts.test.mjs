// guest 内三段脚本（探针 / 采集 / 注入）在隔离 vm 里跑真实逻辑。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient, runGuestScript } from './loader.mjs';

const { test: T } = loadClient();

test('探针：登录路径与大 token 键都识别', () => {
  const { result } = runGuestScript(T.GUEST_PROBE_SCRIPT, {
    entries: { userToken: 'x'.repeat(20), other: 'y' },
    pathname: '/sign_in',
  });
  assert.equal(result.login, true);
  assert.equal(result.token, true);
  assert.deepEqual(result.keys.sort(), ['other', 'userToken']);
});

test('探针：只返回键名，不返回值', () => {
  const { result } = runGuestScript(T.GUEST_PROBE_SCRIPT, {
    entries: { userToken: 'super-secret-value' },
    pathname: '/',
  });
  assert.equal(JSON.stringify(result).includes('super-secret-value'), false);
});

test('采集：>64KB 的单值跳过并计数', () => {
  const big = 'a'.repeat(65537);
  const { result } = runGuestScript(T.GUEST_COLLECT_SCRIPT, {
    entries: { big, small: 'ok' },
    pathname: '/',
  });
  assert.equal(result.skipped, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(Object.keys(result.entries), ['small']);
  assert.equal(result.token, false);
});

test('采集：总量超过 512KB 时截断', () => {
  const chunk = 'b'.repeat(60000);
  const entries = {};
  for (let index = 0; index < 10; index += 1) entries[`k${index}`] = chunk;
  const { result } = runGuestScript(T.GUEST_COLLECT_SCRIPT, { entries, pathname: '/' });
  assert.equal(result.truncated, true);
  assert.ok(Object.keys(result.entries).length < 10);
  assert.ok(Object.keys(result.entries).length >= 8);
});

test('采集：带 token 键且不在登录路径时标记为已登录', () => {
  const { result } = runGuestScript(T.GUEST_COLLECT_SCRIPT, {
    entries: { userToken: 'abc' },
    pathname: '/',
  });
  assert.equal(result.token, true);
  assert.equal(result.login, false);
  assert.equal(result.entries.userToken, 'abc');
});

test('注入：写 localStorage、按条写 cookie，并返回计数', () => {
  const site = {
    localStorage: { userToken: 'tok', other: 'v' },
    cookie: 'smidV2=abc; .thumbcache_x=def;',
  };
  const { result, store, cookieWrites } = runGuestScript(T.buildInjectScript(site), {});
  assert.equal(result.ok, true);
  assert.equal(result.written, 2);
  assert.equal(result.cookies, 2);
  assert.equal(store.get('userToken'), 'tok');
  assert.equal(store.get('other'), 'v');
  assert.equal(cookieWrites.length, 2);
  assert.ok(cookieWrites[0].startsWith('smidV2=abc; path=/'));
});

test('注入：payload 含引号/尖括号也能安全序列化', () => {
  const site = { localStorage: { 'a"b': '</script>', 'c\\d': 'e' }, cookie: '' };
  const { result, store } = runGuestScript(T.buildInjectScript(site), {});
  assert.equal(result.ok, true);
  assert.equal(store.get('a"b'), '</script>');
  assert.equal(store.get('c\\d'), 'e');
});

// 格式化与小工具：格式化、cookie 条数、错误判定、桥状态、诊断报告。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './loader.mjs';

const { test: T } = loadClient();

test('cookie 条数按分号分段（M1「209 是长度不是条数」回归）', () => {
  assert.equal(T.countCookies(''), 0);
  assert.equal(T.countCookies('a=1; b=2;'), 2);
  assert.equal(T.countCookies('a=1;; b=2'), 2);
  assert.equal(T.countCookies(null), 0);
});

test('ERR_ABORTED 视为旧导航被取代，不算失败', () => {
  assert.equal(T.isAbortedNavigation({ code: -3 }), true);
  assert.equal(T.isAbortedNavigation({ message: 'ERR_ABORTED (-3)' }), true);
  assert.equal(T.isAbortedNavigation({ code: -105, message: 'NAME_NOT_RESOLVED' }), false);
  assert.equal(T.isAbortedNavigation(null), false);
});

test('formatSize / formatTime / formatClock 稳定', () => {
  assert.equal(T.formatSize(0), '0 KB');
  assert.ok(T.formatSize(36.8 * 1024).includes('36.8'));
  assert.equal(T.formatTime(0), '');
  assert.match(T.formatClock(0), /^\d{2}:\d{2}:\d{2}$/);
});

test('formatLog 支持 %s/%d 与多余参数', () => {
  assert.equal(T.formatLog('keys=%s cookie=%d', ['a,b', 209]), 'keys=a,b cookie=209');
  assert.equal(T.formatLog('plain', ['extra']), 'plain extra');
  assert.equal(T.formatLog('100%%', []), '100%%');
  assert.equal(T.formatLog('100%% %s', ['x']), '100% x');
});

test('readBridge：缺失 / 协议不符 / 就绪三态', () => {
  const { test: none } = loadClient({ dshDesktop: null });
  assert.equal(none.readBridge().status, 'missing');

  const { test: mismatch } = loadClient({ dshDesktop: { protocolVersion: 2, browser: { acquire() {} } } });
  assert.equal(mismatch.readBridge().status, 'mismatch');

  const { test: ready } = loadClient({ dshDesktop: { protocolVersion: 1, browser: { acquire() {} } } });
  assert.equal(ready.readBridge().status, 'ready');
});

test('诊断报告只含状态与脱敏日志，不含凭据值', () => {
  const diag = {
    phase: 'ready', lease: 'abcd1234', host: 'chat.deepseek.com', crashes: 1,
    backfill: 'validated', bridge: 'ready', hasSnapshot: true, stale: false,
    keys: 30, savedAt: 1700000000000,
  };
  const entries = [{ ts: 1700000000000, level: 'warn', scope: 'host', text: T.redactLog('token=secret') }];
  const report = T.buildDiagnosticReport(diag, entries);
  assert.ok(report.startsWith('[aiwa] diagnostics'));
  assert.ok(report.includes('phase=ready'));
  assert.ok(report.includes('lease=abcd1234'));
  assert.ok(!report.includes('secret'));
  assert.ok(report.includes('token=***'));
});

test('日志环：超限丢最旧', () => {
  const ring = T.createLogRing(2);
  ring.push('log', 'host', 'one');
  ring.push('warn', 'host', 'two');
  ring.push('error', 'host', 'three');
  assert.deepEqual(Array.from(ring.list(), (entry) => entry.text), ['two', 'three']);
  assert.equal(ring.list(1)[0].text, 'three');
  ring.clear();
  assert.equal(ring.list().length, 0);
});

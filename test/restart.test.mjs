// 崩溃重建与启动门：M1 修复（crashed 态放行、上限停手）的回归保护。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './loader.mjs';

const { test: T } = loadClient();
const MAX = 3;

const base = {
  disposed: false, starting: false, webview: null, phase: 'idle',
  active: true, suspended: false, hasRect: true, bridgeReady: true,
  crashes: 0, max: MAX,
};

test('可见崩溃：重建', () => {
  assert.equal(T.decideCrashRestart({ disposed: false, active: true, suspended: false, crashes: 1, max: MAX }), 'restart');
});

test('不可见/已释放时崩溃：跳过重建', () => {
  assert.equal(T.decideCrashRestart({ disposed: false, active: false, suspended: false, crashes: 1, max: MAX }), 'skip');
  assert.equal(T.decideCrashRestart({ disposed: true, active: true, suspended: false, crashes: 1, max: MAX }), 'skip');
  assert.equal(T.decideCrashRestart({ disposed: false, active: true, suspended: true, crashes: 1, max: MAX }), 'skip');
});

test('超过重建上限：停手等手动刷新', () => {
  assert.equal(T.decideCrashRestart({ disposed: false, active: true, suspended: false, crashes: MAX + 1, max: MAX }), 'stop');
});

test('crashed 相位允许重新拉起（M1 修复回归）', () => {
  assert.equal(T.shouldStart({ ...base, phase: 'crashed', crashes: 1 }), 'start');
});

test('crashed 且次数用尽：停手', () => {
  assert.equal(T.shouldStart({ ...base, phase: 'crashed', crashes: MAX + 1 }), 'stop');
});

test('非 idle/crashed 相位不重建', () => {
  assert.equal(T.shouldStart({ ...base, phase: 'loading' }), 'skip');
  assert.equal(T.shouldStart({ ...base, phase: 'ready' }), 'skip');
  assert.equal(T.shouldStart({ ...base, phase: 'failed' }), 'skip');
});

test('面板不可见 / 已挂 guest / 正在启动：都跳过', () => {
  assert.equal(T.shouldStart({ ...base, active: false }), 'skip');
  assert.equal(T.shouldStart({ ...base, hasRect: false }), 'skip');
  assert.equal(T.shouldStart({ ...base, suspended: true }), 'skip');
  assert.equal(T.shouldStart({ ...base, webview: {} }), 'skip');
  assert.equal(T.shouldStart({ ...base, starting: true }), 'skip');
  assert.equal(T.shouldStart({ ...base, disposed: true }), 'skip');
});

test('桥不可用：报 unavailable', () => {
  assert.equal(T.shouldStart({ ...base, bridgeReady: false }), 'unavailable');
});

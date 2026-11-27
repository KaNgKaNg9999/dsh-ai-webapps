// 回填判定：M1 两处修复的回归保护。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './loader.mjs';

const { test: T } = loadClient();

test('有效会话：有 token 且不在登录路径', () => {
  assert.equal(T.probeVerdict({ token: true, login: false }), 'valid');
});

test('坏 token 但键存在：判为 stale（M1 修复回归）', () => {
  // 旧逻辑只看「token 键是否存在」，坏值会被误判成功。
  assert.equal(T.probeVerdict({ token: false, login: true }), 'stale');
});

test('有 token 但仍在登录路径：第一次给复核机会', () => {
  const probe = { token: true, login: true };
  assert.equal(T.needsProbeRetry(probe), true);
  assert.equal(T.probeVerdict(probe), 'stale');
});

test('无 token：直接 stale，不重试', () => {
  assert.equal(T.needsProbeRetry({ token: false, login: true }), false);
  assert.equal(T.probeVerdict({ token: false, login: false }), 'stale');
});

test('探针缺失按 stale 处理', () => {
  assert.equal(T.probeVerdict(null), 'stale');
  assert.equal(T.needsProbeRetry(null), false);
});

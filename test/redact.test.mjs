// 诊断脱敏：凭据、query、Authorization/Cookie 头、站点标识与 UUID 都不得原样出现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClient } from './loader.mjs';

const { test: T } = loadClient();

test('token / password / api key 值被打码', () => {
  const line = T.redactLog('[aiwa] token=abc123 password: hunter2 api_key="sk-9"');
  assert.ok(!line.includes('abc123'));
  assert.ok(!line.includes('hunter2'));
  assert.ok(!line.includes('sk-9'));
  assert.ok(line.includes('***'));
});

test('Authorization 与 Cookie 头整行值被打码', () => {
  assert.equal(T.redactLog('Authorization: Bearer sk-12345'), 'Authorization: ***');
  assert.equal(T.redactLog('Cookie: smidV2=abc; x=y'), 'Cookie: ***');
});

test('URL query 值被打码但路径保留', () => {
  const line = T.redactLog('open https://chat.deepseek.com/a/b?token=zzz&x=2');
  assert.ok(line.startsWith('open https://chat.deepseek.com/a/b?token=***&x=***'));
});

test('站点标识与 UUID（含嵌在键名里的）被打码', () => {
  const line = T.redactLog('[aiwa][guest] {"user_unique_id":"1d3ac34c-848e-481e-9983-8993b57b2c96","web_id":"7712477240193294095"}');
  assert.ok(!line.includes('1d3ac34c'));
  assert.ok(!line.includes('7712477240193294095'));
  const keyLine = T.redactLog('snapshot saved; keys=__appKit_@deepseek/chat_1d3ac34c-848e-481e-9983-8993b57b2c96_userStorage');
  assert.ok(!keyLine.includes('1d3ac34c'));
  assert.ok(keyLine.includes('_userStorage'));
});

test('长度类数字保留，方便排障', () => {
  assert.equal(T.redactLog('snapshot saved; cookie=209 truncated=false'), 'snapshot saved; cookie=209 truncated=false');
});

test('超长行被截断', () => {
  const line = T.redactLog('x'.repeat(400));
  assert.equal(line.length, 241);
  assert.ok(line.endsWith('…'));
});

test('普通日志原样保留', () => {
  assert.equal(T.redactLog('[aiwa] guest attached; lease=abc'), '[aiwa] guest attached; lease=abc');
});

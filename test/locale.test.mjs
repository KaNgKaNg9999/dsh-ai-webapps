// 文案断言：zh/en 键集相同、值非空、英文无中文字符；locale 元数据可解析且 detail 文件存在。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadClient } from './loader.mjs';

const { test: T, root } = loadClient();

test('zh/en 字典键集一致', () => {
  const zhKeys = Object.keys(T.zh).sort();
  const enKeys = Object.keys(T.en).sort();
  assert.deepEqual(enKeys, zhKeys);
  assert.ok(zhKeys.length >= 60, `键数偏少: ${zhKeys.length}`);
});

test('字典值全部为非空白字符串', () => {
  for (const [key, value] of Object.entries(T.zh)) {
    assert.equal(typeof value, 'string', `zh.${key} 不是字符串`);
    assert.ok(value.trim().length > 0, `zh.${key} 为空`);
  }
  for (const [key, value] of Object.entries(T.en)) {
    assert.equal(typeof value, 'string', `en.${key} 不是字符串`);
    assert.ok(value.trim().length > 0, `en.${key} 为空`);
  }
});

test('英文文案不含中文字符', () => {
  const cjk = /[\u4e00-\u9fff]/;
  for (const [key, value] of Object.entries(T.en)) {
    assert.ok(!cjk.test(value), `en.${key} 含中文: ${value}`);
  }
});

test('中文文案使用全角标点与省略号', () => {
  for (const [key, value] of Object.entries(T.zh)) {
    assert.ok(!value.includes(',') || key === 'settingsKeys', `zh.${key} 出现半角逗号: ${value}`);
    assert.ok(!value.includes('...'), `zh.${key} 用 ... 代替 …`);
  }
});

test('locale 元数据可解析，detail 指向存在的文件', () => {
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const meta = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).meta;
    assert.equal(typeof meta.title, 'string');
    assert.ok(meta.title.length > 0);
    assert.equal(typeof meta.description, 'string');
    assert.ok(meta.description.length > 0);
    assert.ok(fs.existsSync(path.join(root, meta.detail)), `${file} 的 meta.detail 不存在: ${meta.detail}`);
  }
});

test('详情页已定稿且包含验证结论', () => {
  const detail = fs.readFileSync(path.join(root, 'docs/plugin/DETAIL.md'), 'utf8');
  assert.ok(!detail.includes('草案'), 'DETAIL 仍标草案');
  assert.ok(detail.includes('验证状态'), 'DETAIL 缺验证状态');
  assert.ok(detail.includes('check_device'), 'DETAIL 缺 check_device 结论');
  assert.ok(detail.includes('诊断'), 'DETAIL 缺诊断入口');
});

/*
 * 核心逻辑单元测试 — node --test tests/core.test.js
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

test('题型识别：multi/多选文本/single', () => {
  assert.equal(C.parseQuestionType('multi', ''), 'multi');
  assert.equal(C.parseQuestionType('single', '多选题'), 'multi');
  assert.equal(C.parseQuestionType('single', '单选题'), 'single');
  assert.equal(C.parseQuestionType(null, null), 'single');
});

test('分值只取真实值，取不到为 null，不反推', () => {
  assert.equal(C.parseScore(2, '多选 2分'), 2);
  assert.equal(C.parseScore(null, '单选 1分'), 1);
  assert.equal(C.parseScore(null, null), null);
  assert.equal(C.parseScore(undefined, '无分值'), null);
  // 禁止从满分/题数反推：函数根本不接受这些参数
  assert.equal(C.parseScore(null, ''), null);
});

test('全站均分解析（含分母）', () => {
  assert.deepEqual(C.parseAverage('全站均分 25 / 50'), { avg: 25, full: 50 });
  assert.deepEqual(C.parseAverage('31.5 / 50'), { avg: 31.5, full: 50 });
  assert.deepEqual(C.parseAverage('暂无数据'), { avg: null, full: null });
  assert.deepEqual(C.parseAverage('均分 28'), { avg: 28, full: null });
});

test('progress total 解析', () => {
  assert.equal(C.parseTotalFromProgress('已作答 0 / 33'), 33);
  assert.equal(C.parseTotalFromProgress('3/150'), 150);
  assert.equal(C.parseTotalFromProgress('无'), null);
});

test('键盘字母/数字映射，超范围返回 -1', () => {
  assert.equal(C.optionIndexFromKey('a', 4), 0);
  assert.equal(C.optionIndexFromKey('D', 4), 3);
  assert.equal(C.optionIndexFromKey('1', 4), 0);
  assert.equal(C.optionIndexFromKey('4', 4), 3);
  assert.equal(C.optionIndexFromKey('5', 4), -1);   // 超范围
  assert.equal(C.optionIndexFromKey('E', 4), -1);
  assert.equal(C.optionIndexFromKey('A', 0), -1);   // 零选项
});

test('键盘阻断上下文', () => {
  assert.equal(C.isKeyboardBlocked({ inEditable: true }), true);
  assert.equal(C.isKeyboardBlocked({ scratchActive: true }), true);
  assert.equal(C.isKeyboardBlocked({ isComposing: true }), true);
  assert.equal(C.isKeyboardBlocked({ repeat: true }), true);
  assert.equal(C.isKeyboardBlocked({ modifier: true }), true);
  assert.equal(C.isKeyboardBlocked({}), false);
});

test('白名单分类与 preventDefault', () => {
  assert.equal(C.classifyNavigationKey('Enter'), 'confirm');
  assert.equal(C.classifyNavigationKey('ArrowLeft'), 'prev');
  assert.equal(C.classifyNavigationKey('Escape'), 'esc');
  assert.equal(C.classifyNavigationKey('Tab'), null);
  assert.equal(C.shouldPreventDefault('A', {}, 4), true);
  assert.equal(C.shouldPreventDefault('Tab', {}, 4), false);   // 放行
  assert.equal(C.shouldPreventDefault('F5', {}, 4), false);
  assert.equal(C.shouldPreventDefault('A', { inEditable: true }, 4), false);
});

test('状态机：单选自动切、多选不切', () => {
  assert.equal(C.shouldAutoAdvance('single'), true);
  assert.equal(C.shouldAutoAdvance('multi'), false);
});

test('状态机：切题边界', () => {
  const m = C.createMachine(3);
  assert.equal(C.goNext(m), 1);
  assert.equal(C.goNext(m), 2);
  assert.equal(C.goNext(m), 2);   // 末题不动
  assert.equal(C.goPrev(m), 1);
  assert.equal(C.goTo(m, 99), 1); // 越界不变
  assert.equal(C.goTo(m, 0), 0);
  assert.equal(C.goPrev(m), 0);   // 首题不动
});

test('快速连按锁', () => {
  const m = C.createMachine(10);
  assert.equal(C.canAct(m, 1000, 120), true);
  C.markActed(m, 1000);
  assert.equal(C.canAct(m, 1050, 120), false);
  assert.equal(C.canAct(m, 1130, 120), true);
  m.transitioning = true;
  assert.equal(C.canAct(m, 2000, 120), false);
});

test('多选切换（不可变、可取消）', () => {
  let picked = [];
  picked = C.toggleChoice(picked, 'A');
  picked = C.toggleChoice(picked, 'C');
  assert.deepEqual(picked.sort(), ['A', 'C']);
  picked = C.toggleChoice(picked, 'A');
  assert.deepEqual(picked, ['C']);
});

test('已作答统计（跳过空答案，修改覆盖）', () => {
  const picked = { q1: ['A'], q2: [], q3: ['B', 'D'], q4: null, q5: '' };
  assert.equal(C.answeredCount(picked), 2);
  assert.equal(C.answeredCount({ q1: ['A'] }), 1);
  assert.equal(C.answeredCount({}), 0);
});

test('笔画栈：撤销、清空、重做链清空', () => {
  const s = C.createStrokeStack();
  C.addStroke(s, { points: [{ x: 1, y: 1 }] });
  C.addStroke(s, { points: [{ x: 2, y: 2 }] });
  assert.equal(s.strokes.length, 2);
  assert.deepEqual(C.undoStroke(s), { points: [{ x: 2, y: 2 }] });
  assert.equal(s.strokes.length, 1);
  C.addStroke(s, { points: [{ x: 3, y: 3 }] });
  assert.equal(s.redo.length, 0);  // 新笔画清空 redo
  const removed = C.clearStrokes(s);
  assert.equal(removed.length, 2); // 清空交回，可支持撤销
  assert.equal(s.strokes.length, 0);
});

test('resize 后笔画坐标缩放，不改原笔画', () => {
  const strokes = [{ points: [{ x: 10, y: 20 }, { x: 50, y: 60 }] }];
  const out = C.rescaleStrokes(strokes, { w: 100, h: 100 }, { w: 200, h: 50 });
  assert.deepEqual(out[0].points[0], { x: 20, y: 10 });
  assert.deepEqual(out[0].points[1], { x: 100, y: 30 });
  assert.deepEqual(strokes[0].points[0], { x: 10, y: 20 }); // 入参未变
});

test('total 来源：paper/mock 与 practice/book 不同', () => {
  assert.equal(C.resolveTotal('paper', 33, null, null), 33);
  assert.equal(C.resolveTotal('mock', 20, null, 20), 20);
  assert.equal(C.resolveTotal('practice', 1, '已作答 0 / 150', null), 150);
  assert.equal(C.resolveTotal('book', 999, '0 / 68', null), 68);
  assert.equal(C.resolveTotal('practice', 1, null, 98), 98);
});

test('计时格式化与恢复', () => {
  assert.equal(C.formatDuration(0), '00:00:00');
  assert.equal(C.formatDuration(755), '00:12:35');
  assert.equal(C.formatDuration(3661), '01:01:01');
  assert.equal(C.elapsedSeconds(1000, 21000), 20);
  assert.equal(C.elapsedSeconds(null, 21000), 0);
});

test('内容指纹：同题稳定、异题不同、可读性无关', () => {
  const a = C.hashText('第一题：中华人民共和国成立于哪一年？#1949|1950|1951|1952');
  const b = C.hashText('第一题：中华人民共和国成立于哪一年？#1949|1950|1951|1952');
  const c = C.hashText('第二题：以下哪些属于社会主义核心价值观？#富强|民主|文明|和谐');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(/^[0-9a-z]+$/.test(a), true);
  assert.equal(C.hashText(''), C.hashText(null));
});

test('空格与 Enter 同为「确认并下一题」，单选多选一致', () => {
  assert.equal(C.classifyNavigationKey('Enter'), 'confirm');
  assert.equal(C.classifyNavigationKey(' '), 'confirm');
  assert.equal(C.classifyNavigationKey('Spacebar'), 'confirm'); // 旧版 Edge/Safari
  // 空格必须被拦截（阻止页面滚动 / 按钮默认激活），单选也一样
  assert.equal(C.shouldPreventDefault(' ', {}, 4), true);
  assert.equal(C.shouldPreventDefault('Enter', {}, 4), true);
  assert.equal(C.shouldPreventDefault(' ', { inEditable: true }, 4), false);
});

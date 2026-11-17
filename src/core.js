/*
 * yanbrick-immersive-exam — 纯逻辑核心
 * SPDX-License-Identifier: GPL-3.0-or-later
 * 无 DOM / 无网络依赖，可被 Node 直接 require 做单元测试。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ImmersiveCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OPTION_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  // ---------- 解析 ----------

  // 从 DOM 文本 / 接口字段判定题型。type==='multi' 或文本含"多选"即多选。
  function parseQuestionType(rawType, typeText) {
    if (rawType === 'multi' || rawType === 'multiple') return 'multi';
    if (typeof typeText === 'string' && /多选/.test(typeText)) return 'multi';
    return 'single';
  }

  // 分值只取真实字段或 "+N分" / "N分" 标签文本；取不到返回 null。禁止反推。
  function parseScore(rawScore, scoreText) {
    if (typeof rawScore === 'number' && isFinite(rawScore)) return rawScore;
    if (typeof rawScore === 'string' && /^\d+(\.\d+)?$/.test(rawScore.trim())) return Number(rawScore);
    if (typeof scoreText === 'string') {
      const m = scoreText.match(/(\d+(?:\.\d+)?)\s*分/);
      if (m) return Number(m[1]);
    }
    return null;
  }

  // 从 "全站均分 25 / 50" 之类文本抽取 { avg, full }；抽不到对应为 null。
  function parseAverage(text) {
    const out = { avg: null, full: null };
    if (typeof text !== 'string') return out;
    const m = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (m) { out.avg = Number(m[1]); out.full = Number(m[2]); return out; }
    const a = text.match(/(\d+(?:\.\d+)?)/);
    if (a) out.avg = Number(a[1]);
    return out;
  }

  // 从 "已作答 0 / 33" 抽分母作为 practice/book 的 total；抽不到返回 null。
  function parseTotalFromProgress(text) {
    if (typeof text !== 'string') return null;
    const m = text.match(/\/\s*(\d+)/);
    return m ? Number(m[1]) : null;
  }

  // 键盘字母/数字 → 选项 index。返回 -1 表示无效/超范围。
  function optionIndexFromKey(key, optionCount) {
    if (typeof key !== 'string') return -1;
    const k = key.toUpperCase();
    let idx = -1;
    if (/^[A-Z]$/.test(k) && k.length === 1) idx = OPTION_KEYS.indexOf(k);
    else if (/^[1-9]$/.test(key)) idx = Number(key) - 1;
    if (idx < 0 || idx >= optionCount) return -1;
    return idx;
  }

  // ---------- 键盘白名单 ----------

  // 当前是否处于"不应触发答题快捷键"的上下文。
  function isKeyboardBlocked(ctx) {
    ctx = ctx || {};
    return !!(ctx.inEditable || ctx.scratchActive || ctx.isComposing || ctx.repeat || ctx.modifier);
  }

  // 白名单：返回 'option' | 'confirm' | 'prev' | 'next' | 'esc' | null
  function classifyNavigationKey(key) {
    switch (key) {
      case 'Enter': return 'confirm';
      case 'ArrowLeft': return 'prev';
      case 'ArrowRight': return 'next';
      case 'Escape': return 'esc';
      default: return null;
    }
  }

  // 是否应 preventDefault：仅白名单内且上下文未阻断时为 true。
  function shouldPreventDefault(key, ctx, optionCount) {
    if (isKeyboardBlocked(ctx)) return false;
    if (classifyNavigationKey(key)) return true;
    return optionIndexFromKey(key, optionCount || 0) >= 0;
  }

  // ---------- 状态机（渲染镜像，不含答案真值） ----------

  function createMachine(total) {
    if (!Number.isInteger(total) || total < 0) throw new Error('invalid total');
    return { index: 0, total, transitioning: false, lastActionAt: 0 };
  }

  // 快速连按锁：间隔小于 minIntervalMs 的动作被拒绝（防跳题）。
  function canAct(machine, now, minIntervalMs) {
    if (machine.transitioning) return false;
    if (now - machine.lastActionAt < (minIntervalMs == null ? 120 : minIntervalMs)) return false;
    return true;
  }

  function markActed(machine, now) { machine.lastActionAt = now; }

  function goNext(machine) {
    if (machine.index >= machine.total - 1) return machine.index; // 末题不动
    machine.index += 1;
    return machine.index;
  }

  function goPrev(machine) {
    if (machine.index <= 0) return 0;
    machine.index -= 1;
    return machine.index;
  }

  function goTo(machine, i) {
    if (!Number.isInteger(i) || i < 0 || i >= machine.total) return machine.index;
    machine.index = i;
    return machine.index;
  }

  // 作答后是否应自动切题：单选立即切，多选不切（等 Enter）。
  function shouldAutoAdvance(type) { return type === 'single'; }

  // 多选选项切换：返回新的已选 key 集合（不可变）。
  function toggleChoice(pickedSet, key) {
    const set = new Set(pickedSet || []);
    if (set.has(key)) set.delete(key); else set.add(key);
    return Array.from(set);
  }

  // 已作答数量：仅统计有非空选择的题。
  function answeredCount(picked) {
    let n = 0;
    const obj = picked || {};
    for (const id of Object.keys(obj)) {
      const v = obj[id];
      if (Array.isArray(v) ? v.length > 0 : (v != null && v !== '')) n += 1;
    }
    return n;
  }

  // ---------- 草稿纸笔画栈 ----------

  function createStrokeStack() { return { strokes: [], redo: [] }; }

  function addStroke(stack, stroke) {
    stack.strokes.push(stroke);
    if (stack.redo.length) stack.redo.length = 0;
    return stack;
  }

  function undoStroke(stack) {
    if (!stack.strokes.length) return null;
    const s = stack.strokes.pop();
    stack.redo.push(s);
    return s;
  }

  function clearStrokes(stack) {
    const removed = stack.strokes.slice();
    stack.strokes = [];
    stack.redo = [];
    return removed; // 交回调用方，支持"清空也可撤销"
  }

  // 恢复笔画时按画布尺寸缩放坐标：返回新笔画数组，不改入参。
  function rescaleStrokes(strokes, from, to) {
    if (!from || !to || !from.w || !from.h || !to.w || !to.h) return strokes;
    const sx = to.w / from.w, sy = to.h / from.h;
    return strokes.map(st => ({
      tool: st.tool, color: st.color, width: st.width,
      points: (st.points || []).map(p => ({ x: p.x * sx, y: p.y * sy }))
    }));
  }

  // ---------- total 来源判定 ----------

  function resolveTotal(kind, apiLength, progressText, pageTotal) {
    if (kind === 'paper' || kind === 'mock') {
      if (Number.isInteger(pageTotal) && pageTotal > 0) return pageTotal;
      if (Number.isInteger(apiLength) && apiLength > 0) return apiLength;
    } else {
      const fromProgress = parseTotalFromProgress(progressText);
      if (Number.isInteger(fromProgress) && fromProgress > 0) return fromProgress;
      if (Number.isInteger(pageTotal) && pageTotal > 0) return pageTotal;
      if (Number.isInteger(apiLength) && apiLength > 0) return apiLength;
    }
    return 0;
  }

  // ---------- 计时 ----------

  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }

  function elapsedSeconds(startedAt, now) {
    if (typeof startedAt !== 'number') return 0;
    return Math.max(0, Math.floor(((now == null ? Date.now() : now) - startedAt) / 1000));
  }

  const api = {
    OPTION_KEYS,
    parseQuestionType, parseScore, parseAverage, parseTotalFromProgress,
    optionIndexFromKey,
    isKeyboardBlocked, classifyNavigationKey, shouldPreventDefault,
    createMachine, canAct, markActed, goNext, goPrev, goTo,
    shouldAutoAdvance, toggleChoice, answeredCount,
    createStrokeStack, addStroke, undoStroke, clearStrokes, rescaleStrokes,
    resolveTotal, formatDuration, elapsedSeconds
  };
  return api;
});

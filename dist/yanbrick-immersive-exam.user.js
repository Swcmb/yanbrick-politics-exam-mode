// ==UserScript==
// @name        政砖沉浸式考试模式 (Immersive Exam)
// @namespace    https://github.com/Swcmb/yanbrick-politics-exam-mode
// @version      0.3.0
// @description  把 yanbrick.com/politics 的选择题练习改造成一屏一题、键盘作答、答题卡、题面批注（草稿纸）的沉浸式考试界面。答案与交卷复用网站原生机制。
// @author       Swcmb
// @match        https://yanbrick.com/politics/*
// @grant        none
// @run-at       document-idle
// @license      GPL-3.0-or-later
// ==/UserScript==

/*
 * 政砖沉浸式考试模式
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * 架构：适配器（从原生题卡 DOM 读题目真值，API 仅补均分/卷名）→ 统一题目模型
 *       → Shadow DOM 呈现层（一屏一题 / 顶栏 / 答题卡 / 题面批注层）→ 写回驱动原生节点 click。
 * 不接管答案/计时/判分真值；脚本只持有渲染镜像状态。
 */
(function () {
  'use strict';

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

  // ---------- 内容指纹 ----------
  // 原生题卡没有任何 id 时（按科目练习页实测如此），用「题干 + 选项」的稳定指纹做题目身份，
  // 这样即使练习集重新排序，批注也不会挂到别的题上。非加密用途，只求稳定、低冲突。
  function hashText(input) {
    const s = String(input == null ? '' : input);
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x9e3779b1 >>> 0;
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = (Math.imul(h2 + c, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
    }
    return h1.toString(36) + h2.toString(36);
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
    createStrokeStack, addStroke, undoStroke, clearStrokes, rescaleStrokes, hashText,
    resolveTotal, formatDuration, elapsedSeconds
  };
  return api;
});


  const Core = globalThis.ImmersiveCore;
  if (!Core) { console.error('[immersive] core 未加载'); return; }

  const NS = 'yanbrick-immersive';
  const KEY_STATE = (id) => `pol:immersive-state:${id}`;
  const KEY_SCRATCH = (id) => `pol:immersive-scratch:${id}`; // 末尾再拼题目 id → 每题独立
  const LS_ANNOT = 'pol:immersive-annot';                        // 批注开关（记忆上次选择）
  const KEY_NATIVE = (mode, id) => `pol:paper-draft:${mode}:${id}`;

  // ---------- 工具 ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  // 站点在 window 上占用/覆盖了 CSS，导致 CSS.escape 不是函数（真实站点实测），这里自带兜底
  const cssEsc = (s) => {
    const v = String(s);
    try {
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(v);
    } catch (e) { /* 落到下面手写转义 */ }
    return v.replace(/[^A-Za-z0-9_-]/g, (c) => '\\' + c);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MODE_TAG = '[immersive]';

  function log(...a) { if (window.YANBRICK_IMMERSIVE_DEBUG) console.log(MODE_TAG, ...a); }
  function toast(host, msg, kind) {
    if (!host) { console.warn(MODE_TAG, msg); return; }
    const t = host.querySelector('.im-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `im-toast show ${kind || ''}`;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'im-toast'; }, 2600);
  }

  function safeGet(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { console.warn(MODE_TAG, '保存失败', key, e); return false; }
  }
  function safeJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }

  async function apiGet(path) {
    // 同源 GET，自动带登录 cookie；每次调用方负责"同 code 只调一次"
    try {
      const res = await fetch(`/api/politics${path}`, { credentials: 'same-origin' });
      if (res.status === 401) return { __unauthorized: true };
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  // ---------- 从原生题卡 DOM 抽取题目（真值同源） ----------
  // 整卷：题卡为 li#pb-pq-${id}；练习/习题：题卡为 .pb-card。统一按 .pb-card 容器抽取。
  function extractQuestionsFromDOM() {
    // 整卷 li#pb-pq-* 内嵌 .pb-card；练习模式 .pb-card 独立。用 li 优先，回退 .pb-card。
    let cards = $$('li[id^="pb-pq-"]');
    let inPaper = cards.length > 0;
    if (!inPaper) cards = $$('.pb-card');
    const questions = [];
    cards.forEach((card, i) => {
      const stemEl = $('.pb-stem', card);
      const optEls = $$('.pb-opts button.pb-opt', card);
      if (!stemEl || optEls.length === 0) return; // 不是有效题卡
      const hasOwnId = card.id.startsWith('pb-pq-') || !!card.getAttribute('data-id');
      const idAttr = card.id.startsWith('pb-pq-') ? card.id.slice(6) : (card.getAttribute('data-id') || String(i));
      const typeText = ($('.pb-type', card) || {}).textContent || '';
      const type = Core.parseQuestionType(
        ($('.pb-type', card) || {}).className?.match(/\b(multi|single)\b/)?.[1] || null,
        typeText
      );
      // 分值：卡头 area 找 "+N分"/"N分" 文本
      let scoreText = '';
      const head = $('.pb-card-head', card) || card;
      const smalls = $$('span,em,b', head);
      for (const s of smalls) { if (/分/.test(s.textContent || '')) { scoreText = s.textContent; break; } }
      const score = Core.parseScore(null, scoreText);
      const noText = ($('.pb-no', card) || {}).textContent || '';
      const noMatch = noText.match(/\d+/);
      const options = optEls.map((btn, idx) => ({
        key: (($('.pb-opt-let', btn) || {}).textContent || Core.OPTION_KEYS[idx] || String(idx + 1)).trim(),
        html: ($('.pb-opt-txt', btn) || btn).innerHTML,
        domIndex: idx,
        native: btn
      }));
      const stemText = String((stemEl.textContent || '')).replace(/\s+/g, ' ').trim().slice(0, 400);
      const optText = optEls.map((b) => String(b.textContent || '').replace(/\s+/g, '').slice(0, 40)).join('|');
      questions.push({
        id: String(idAttr),
        idFromPos: !hasOwnId, // 原生没给 id：用内容指纹做批注身份（见 ui 层）
        fingerprint: Core.hashText(stemText + '#' + optText),
        type,
        score,
        stemHTML: stemEl.innerHTML,
        options,
        no: noMatch ? Number(noMatch[0]) : i + 1,
        native: card,
        inPaper
      });
    });
    return { questions, inPaper };
  }

  function readNativePicked(q) {
    // 从原生选项节点的 .picked 状态回读，作为"答案真值"（与原生判分同源）
    const btns = $$('.pb-opts button.pb-opt', q.native);
    const out = [];
    btns.forEach((b, i) => { if (b.classList.contains('picked')) out.push(q.options[i]?.key ?? Core.OPTION_KEYS[i]); });
    return out;
  }

  function readNativeChrome() {
    // 从页面已有元素抓：均分、进度文本、计时（body 可能尚未就绪，判空）
    const avgText = ($('.pb-ave') || {}).textContent || '';
    const bodyText = (document.body && (document.body.innerText || document.body.textContent)) || '';
    const progressText = bodyText.match(/已作答\s*\d+\s*\/\s*\d+/)?.[0] || '';
    const timerText = bodyText.match(/\b\d{2}:\d{2}:\d{2}\b/)?.[0] || '';
    // 练习/习题册：原生进度形如「第 3 / 150 题 · 已做 12」
    const practiceProgress = bodyText.match(/第\s*(\d+)\s*\/\s*(\d+)\s*题/);
    const practiceDone = bodyText.match(/已做\s*(\d+)/);
    return {
      avgText,
      progressText,
      timerText,
      practiceCur: practiceProgress ? Number(practiceProgress[1]) : null,
      practiceTotal: practiceProgress ? Number(practiceProgress[2]) : null,
      practiceDone: practiceDone ? Number(practiceDone[1]) : null
    };
  }

  // 练习/习题册页：一屏一张题卡 + 原生完整答题卡（button.pb-cell，当前题带 .cur）
  function readNativeCells() {
    const cells = $$('.pb-cell');
    if (cells.length < 2) return null;
    const cur = cells.findIndex((c) => c.classList.contains('cur'));
    return { total: cells.length, index: cur < 0 ? 0 : cur, cells };
  }

  // ---------- 适配器 ----------
  function detectKind(path) {
    if (/\/paper\//.test(path)) return 'paper';
    if (/\/mixed\//.test(path)) return 'mock';
    if (/\/practice\//.test(path)) return 'practice';
    if (/\/book\/|\/bank\//.test(path)) return 'book';
    return null;
  }
  function isNonExamPath(path) {
    return /\/(analysis|review|wrong|favorites|leaderboard|wishpool|my-feedback)(\/|$)/.test(path) ||
      path === '/politics' || path === '/politics/' ||
      /^\/politics\/(exams|mocks|books)(\/|$)/.test(path);
  }
  function paperKeyFromPath(path) {
    const m = path.match(/\/(?:paper|mixed|practice|book|bank)\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : (path.replace(/^\/politics\//, '') || 'root');
  }

  async function loadModel(kind, path) {
    const { questions, inPaper } = extractQuestionsFromDOM();
    const chrome = readNativeChrome();
    const avg = Core.parseAverage(chrome.avgText);
    const key = paperKeyFromPath(path);
    const mode = /mock|mixed/.test(kind) || /^mock/.test(key) ? 'm' : 'p';

    // 计时起点：优先原生草稿键
    const nativeRaw = safeJSON(KEY_NATIVE(mode, key), null);
    let startedAt = nativeRaw && typeof nativeRaw.startedAt === 'number' ? nativeRaw.startedAt : null;
    if (!startedAt) {
      // 从页面计时文本反推（近似：页面显示 HH:MM:SS）
      const t = chrome.timerText.match(/(\d{2}):(\d{2}):(\d{2})/);
      if (t) startedAt = Date.now() - ((+t[1] * 3600) + (+t[2] * 60) + (+t[3])) * 1000;
      else startedAt = Date.now();
    }
    // 24h 过期：原生会作废，脚本不偷偷续命，提示重开
    const expired = Date.now() - startedAt > 24 * 36e5;

    // total：整卷用题卡数（实测全量铺开）；练习/习题册一屏一卡，用原生答题卡格数或进度分母
    const cells = readNativeCells();
    const singleCard = !inPaper && questions.length === 1 && !!(cells || (chrome.practiceTotal && chrome.practiceTotal > 1));
    let total = 0;
    if (singleCard) total = (cells && cells.total) || chrome.practiceTotal || questions.length;
    else if (kind === 'paper' || kind === 'mock') total = questions.length || Core.parseTotalFromProgress(chrome.progressText) || 0;
    else total = Core.resolveTotal(kind, questions.length, chrome.progressText, questions.length);

    if (!questions.length || !total) return null;

    // 已有作答：从原生 .picked 回读
    const picked = {};
    questions.forEach((q) => { const v = readNativePicked(q); if (v.length) picked[q.id] = v; });

    return {
      kind, key, mode, questions, total, expired, startedAt, picked,
      avgScore: avg.avg, fullScore: avg.full,
      progressText: chrome.progressText,
      // 一屏一卡模式（练习/习题册）：题目只保留当前一张，靠原生答题卡做翻页与定位
      singleCard,
      nativeIndex: cells ? cells.index : (chrome.practiceCur ? chrome.practiceCur - 1 : 0),
      nativeDone: chrome.practiceDone
    };
  }

  // 写回：驱动原生节点 click，重新 querySelector + isConnected + 回读判据（R-2）
  async function writeNativeChoice(q, keys) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const card = document.getElementById(`pb-pq-${q.id}`) || ($(`.pb-card[data-qid="${cssEsc(q.id)}"]`)) || q.native;
      if (card && card.isConnected) {
        const btns = $$('.pb-opts button.pb-opt', card);
        // 目标：让最终 picked 恰好等于 keys。先清掉多余的已选，再补缺失的。
        const current = new Set(btns.filter((b) => b.classList.contains('picked')).map((b) => btns.indexOf(b)));
        const want = new Set(keys.map((k) => {
          const i = q.options.findIndex((o) => o.key === k);
          return i >= 0 ? i : -1;
        }).filter((i) => i >= 0));
        // 取消多余
        for (const idx of Array.from(current)) {
          if (!want.has(idx) && btns[idx] && btns[idx].isConnected) { btns[idx].click(); await sleep(30); }
        }
        // 补选缺失
        for (const idx of Array.from(want)) {
          const nowPicked = btns[idx] && btns[idx].classList.contains('picked');
          if (!nowPicked && btns[idx] && btns[idx].isConnected) { btns[idx].click(); await sleep(30); }
        }
        // 回读判据
        const after = readNativePicked({ native: card, options: q.options });
        const ok = after.length === keys.length && keys.every((k) => after.includes(k));
        if (ok) return true;
      }
      await sleep(40);
    }
    return false;
  }

  function clickNativeSubmit() {
    const btn = $('.pb-submit');
    if (btn && btn.isConnected && !btn.disabled) { btn.click(); return true; }
    return false;
  }


  // ================= Shadow DOM UI =================
  const CSS = `
  :host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color-scheme:dark}
  *{box-sizing:border-box}
  .im-app{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#0e1116;color:#e8ecf1;font-size:16px}
  .im-top{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:12px 20px;background:#151a21;border-bottom:1px solid #262d37;box-shadow:0 2px 12px rgba(0,0,0,.35)}
  .im-brand{font-weight:700;letter-spacing:.5px;color:#7cc4ff}
  .im-stat{display:flex;flex-direction:column;line-height:1.25}
  .im-stat b{font-size:17px;font-variant-numeric:tabular-nums}
  .im-stat span{font-size:11px;color:#8b97a7}
  .im-spacer{flex:1}
  .im-btn{border:1px solid #333d4b;background:#1c2430;color:#e8ecf1;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer;transition:transform .12s,background .15s}
  .im-btn:hover{background:#243040}
  .im-btn:active{transform:scale(.96)}
  .im-btn.primary{background:#2f7de1;border-color:#2f7de1;color:#fff}
  .im-btn.danger{background:#b23b3b;border-color:#b23b3b;color:#fff}
  .im-btn:disabled{opacity:.45;cursor:not-allowed}
  .im-main{flex:1 1 auto;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;padding:24px 20px 96px}
  .im-card{position:relative;width:min(860px,100%);min-height:100%;max-height:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3a4759 transparent;background:#161c24;border:1px solid #2a323e;border-radius:14px;padding:26px 30px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
  /* 滚动条统一成细窄深色，不抢视觉；内容不溢出时不出现 */
  .im-card::-webkit-scrollbar,.im-panel-box::-webkit-scrollbar{width:8px;height:8px}
  .im-card::-webkit-scrollbar-track,.im-panel-box::-webkit-scrollbar-track{background:transparent}
  .im-card::-webkit-scrollbar-thumb,.im-panel-box::-webkit-scrollbar-thumb{background:#3a4759;border-radius:4px}
  .im-card::-webkit-scrollbar-thumb:hover,.im-panel-box::-webkit-scrollbar-thumb:hover{background:#4b5b73}
  .im-card-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}
  .im-type{font-size:13px;padding:3px 10px;border-radius:999px;background:#233a5a;color:#9ccbff}
  .im-type.multi{background:#4a3355;color:#e0a6ff}
  .im-score{font-size:13px;color:#f0c674}
  .im-no{font-size:13px;color:#8b97a7}
  .im-stem{font-size:18px;line-height:1.75;margin-bottom:22px}
  .im-stem img,.im-stem table{max-width:100%}
  .im-opts{display:flex;flex-direction:column;gap:12px}
  .im-opt{display:flex;gap:14px;align-items:flex-start;text-align:left;width:100%;padding:14px 16px;border:1px solid #333d4b;border-radius:10px;background:#1a212b;color:#e8ecf1;font-size:16px;cursor:pointer;transition:border-color .15s,background .15s,transform .1s}
  .im-opt:hover{background:#202a36;border-color:#415064}
  .im-opt:active{transform:scale(.995)}
  .im-opt .k{flex:0 0 28px;height:28px;border-radius:50%;background:#2b3543;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px}
  .im-opt .txt{flex:1;line-height:1.6}
  .im-opt .txt img,.im-opt .txt table{max-width:100%}
  .im-opt.picked{border-color:#2f7de1;background:#1b2c42}
  .im-opt.picked .k{background:#2f7de1;color:#fff}
  .im-opt.picked.multi{border-color:#a45bd6;background:#2c1f38}
  .im-opt.picked.multi .k{background:#a45bd6;color:#fff}
  .im-navbar{position:fixed;left:0;right:0;bottom:0;z-index:2;display:flex;gap:12px;align-items:center;justify-content:center;padding:14px 20px;background:linear-gradient(0deg,#0e1116 60%,transparent)}
  .im-hint{font-size:12px;color:#6f7c8d;margin-left:8px}
  .im-panel{position:fixed;inset:0;z-index:5;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}
  .im-panel.open{display:flex}
  .im-panel-box{width:min(560px,92vw);max-height:86vh;overflow:auto;scrollbar-width:thin;scrollbar-color:#3a4759 transparent;background:#151b23;border:1px solid #2f3946;border-radius:14px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
  .im-panel-box h3{margin:0 0 14px;font-size:18px}
  .im-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:10px}
  .im-cell{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid #333d4b;border-radius:9px;background:#1a212b;color:#cfd8e3;cursor:pointer;font-variant-numeric:tabular-nums}
  .im-cell:hover{border-color:#4a5a70}
  .im-cell.done{background:#1b3a2a;border-color:#2f7a52;color:#8ff0bd}
  .im-cell.current{outline:2px solid #2f7de1;outline-offset:1px}
  .im-cell .pick{font-size:11px;opacity:.8}
  .im-tools{display:none;align-items:center;gap:6px}
  .im-tools.on{display:flex}
  .im-tool{border:1px solid #38424f;background:#202935;color:#dbe4ef;border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer}
  .im-tool.on{background:#2f7de1;border-color:#2f7de1;color:#fff}
  .im-btn.on{background:#2f7de1;border-color:#2f7de1;color:#fff}
  .im-btn.has::after{content:"";display:inline-block;width:6px;height:6px;margin-left:7px;border-radius:50%;background:#ff6b6b;vertical-align:1px}
  /* 题面批注层：透明画布直接盖在题卡内容上，笔迹浮在文字之上；关闭时完全不拦指针 */
  .im-annot{position:absolute;left:0;top:0;z-index:3;display:block;pointer-events:none;touch-action:none;border-radius:12px}
  .im-card.annot-on .im-annot{pointer-events:auto}
  .im-card.annot-on{user-select:none;-webkit-user-select:none}
  .im-card.annot-on .im-annot{cursor:crosshair}
  .im-toast{position:fixed;left:50%;top:76px;transform:translateX(-50%) translateY(-20px);z-index:20;background:#243040;border:1px solid #3a4a5e;color:#e8ecf1;padding:10px 18px;border-radius:8px;opacity:0;pointer-events:none;transition:.25s;font-size:14px}
  .im-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  .im-toast.err{background:#5a2424;border-color:#8b3b3b}
  .im-slide-in{animation:imSlide .22s ease-out}
  @keyframes imSlide{from{opacity:0;transform:translateX(var(--dir,18px))}to{opacity:1;transform:translateX(0)}}
  .im-pop{animation:imPop .2s cubic-bezier(.34,1.56,.64,1)}
  @keyframes imPop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
  .im-press:active{transform:scale(.96)}
  @media (prefers-reduced-motion:reduce){.im-slide-in,.im-pop{animation:none}}
  .im-nomotion .im-slide-in,.im-nomotion .im-pop{animation:none}
  @media (max-width:600px){.im-card{padding:18px}.im-stem{font-size:16px}.im-top{gap:8px;padding:10px 12px}.im-stat b{font-size:15px}}
  `;

  function buildShadow(host) {
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const app = document.createElement('div');
    app.className = 'im-app';
    app.innerHTML = `
      <div class="im-top">
        <span class="im-brand">沉浸考试</span>
        <div class="im-stat"><b data-f="timer">00:00:00</b><span>考试时间</span></div>
        <div class="im-stat"><b data-f="progress">0 / 0</b><span>已作答</span></div>
        <div class="im-stat"><b data-f="avg">暂无数据</b><span>全站均分</span></div>
        <div class="im-stat"><b data-f="qmeta">—</b><span data-f="qno">第 0 / 0 题</span></div>
        <span class="im-spacer"></span>
        <button class="im-btn" data-a="card">答题卡</button>
        <button class="im-btn" data-a="annot" title="在题目上直接批注：打开后可直接在题卡上划，每题笔迹独立（Esc 退出）">草稿纸</button>
        <div class="im-tools" data-f="tools">
          <button class="im-tool on" data-tool="pen">笔</button>
          <button class="im-tool" data-tool="eraser">橡皮</button>
          <button class="im-tool" data-a="undo">撤销</button>
          <button class="im-tool" data-a="clear">清空</button>
        </div>
        <button class="im-btn" data-a="exit" title="退出沉浸模式，恢复原页面（不会自动再弹出；右下角可重新开启）">退出</button>
      </div>
      <div class="im-main"><div class="im-card" data-f="card"><div class="im-body" data-f="body"></div><canvas class="im-annot" data-f="annot"></canvas></div></div>
      <div class="im-navbar">
        <button class="im-btn" data-a="prev">上一题</button>
        <button class="im-btn" data-a="next">下一题</button>
        <button class="im-btn" data-a="nativeSubmit" style="display:none" title="调用网站原生「提交本题」（练习模式即时判分）">提交本题</button>
        <button class="im-btn danger" data-a="submit" style="display:none">交卷</button>
        <span class="im-hint" data-f="hint">A/B/C/D 或 1/2/3/4 选择 · Enter 确认 · 左右切题 · Esc 关闭</span>
      </div>
      <div class="im-panel" data-f="cardpanel">
        <div class="im-panel-box im-pop">
          <h3>答题卡 <span class="im-hint" data-f="cardstat"></span></h3>
          <div class="im-grid" data-f="grid"></div>
          <div style="margin-top:16px;text-align:right"><button class="im-btn" data-a="closecard">关闭 (Esc)</button></div>
        </div>
      </div>
      <div class="im-toast"></div>
    `;
    root.appendChild(style);
    root.appendChild(app);
    return root;
  }

  function renderQuestion(root, model, index, direction) {
    // 一屏一卡模式（练习/习题册）：模型里只有当前一张题卡，题号以原生位置为准
    const pos = model.singleCard ? model.nativeIndex : index;
    const q = model.questions[model.singleCard ? 0 : index];
    const body = root.querySelector('[data-f="body"]');
    const pickedSet = new Set(model.picked[q.id] || []);
    const isMulti = q.type === 'multi';
    body.innerHTML = `
      <div class="im-card-head ${model.motion ? 'im-slide-in' : ''}" style="--dir:${direction || 18}px">
        <span class="im-type ${isMulti ? 'multi' : ''}">${isMulti ? '多选题' : '单选题'}</span>
        <span class="im-score">${q.score == null ? '分值 —' : q.score + ' 分'}</span>
        <span class="im-no">第 ${pos + 1} / ${model.total} 题</span>
      </div>
      <div class="im-stem">${q.stemHTML}</div>
      <div class="im-opts">
        ${q.options.map((o, i) => `
          <button class="im-opt im-press ${pickedSet.has(o.key) ? 'picked' : ''} ${pickedSet.has(o.key) && isMulti ? 'multi' : ''}" data-opt="${i}">
            <span class="k">${esc(o.key)}</span><span class="txt">${o.html}</span>
          </button>`).join('')}
      </div>
    `;
    // 批注层按题目 id 归档；原生题卡没有 id 时用「题干+选项」内容指纹，
    // 这样练习集换序也不会把批注挂到别的题上；指纹也拿不到才退回位置键。
    const annotId = (q.id && !q.idFromPos)
      ? String(q.id)
      : (q.fingerprint ? `c${q.fingerprint}` : (model.singleCard ? `i${model.nativeIndex}` : `i${pos}`));
    if (currentScratch) currentScratch.attach(annotId);
    root.querySelector('[data-f="qmeta"]').textContent = `${isMulti ? '多选' : '单选'} · ${q.score == null ? '—' : q.score + ' 分'}`;
    root.querySelector('[data-f="qno"]').textContent = `第 ${pos + 1} / ${model.total} 题`;
    root.querySelector('[data-a="submit"]').style.display = (pos === model.total - 1 && !model.singleCard) ? '' : 'none';
    // 练习/习题册：保留原生「提交本题」入口（原生即时判分，脚本不代劳）
    const ns = root.querySelector('[data-a="nativeSubmit"]');
    if (ns) ns.style.display = model.singleCard ? '' : 'none';
    updateChrome(root, model);
  }

  function updateChrome(root, model) {
    const secs = Core.elapsedSeconds(model.startedAt, Date.now());
    root.querySelector('[data-f="timer"]').textContent = Core.formatDuration(secs);
    const done = model.singleCard && typeof model.nativeDone === 'number'
      ? model.nativeDone
      : Core.answeredCount(model.picked);
    root.querySelector('[data-f="progress"]').textContent = `${done} / ${model.total}`;
    root.querySelector('[data-f="avg"]').textContent = model.avgScore == null
      ? '暂无数据'
      : `${model.avgScore}${model.fullScore != null ? ' / ' + model.fullScore : ''}`;
  }

  function renderGrid(root, model) {
    const grid = root.querySelector('[data-f="grid"]');
    const pos = model.singleCard ? model.nativeIndex : model.state.index;
    const cells = [];
    for (let i = 0; i < model.total; i += 1) {
      const q = model.singleCard ? null : model.questions[i];
      const pick = q ? (model.picked[q.id] || []) : [];
      const cls = ['im-cell'];
      if (pick.length) cls.push('done');
      if (i === pos) cls.push('current');
      cells.push(
        `<div class="${cls.join(' ')}" data-jump="${i}" title="第 ${i + 1} 题">${String(i + 1).padStart(2, '0')}${pick.length ? `<span class="pick">${esc(pick.join(''))}</span>` : ''}</div>`
      );
    }
    grid.innerHTML = cells.join('');
    const done = model.singleCard && typeof model.nativeDone === 'number'
      ? model.nativeDone
      : Core.answeredCount(model.picked);
    root.querySelector('[data-f="cardstat"]').textContent = `已答 ${done} / ${model.total}`;
  }

  // ================= 题面批注（草稿纸） =================
  // 需求：草稿纸不再是独立浮层，而是直接覆盖在题卡上「就地划」；题目之间笔迹独立。
  // 实现：透明 canvas 绝对定位在题卡内容之上（随题卡滚动），pointer-events 由开关控制；
  //      坐标以画布左上角为原点；存储键以题目 id 结尾，翻题即整层切换，互不串写。
  const HINT_IDLE = 'A/B/C/D 或 1/2/3/4 选择 · Enter 确认 · 左右切题 · Esc 关闭';
  const HINT_ANNOT = '批注中：直接在题目上划 · Esc 退出（关闭批注后才能点选项）';

  let currentScratch = null;

  function initScratch(root, model) {
    const card = root.querySelector('[data-f="card"]');
    const canvas = root.querySelector('[data-f="annot"]');
    const btn = root.querySelector('[data-a="annot"]');
    const tools = root.querySelector('[data-f="tools"]');
    const hint = root.querySelector('[data-f="hint"]');
    const ctx = canvas.getContext('2d');
    const keyOf = (id) => `${KEY_SCRATCH(model.key)}:${id}`;

    let qid = null;
    let stack = Core.createStrokeStack();
    let basis = null; // 现有笔迹坐标对应的画布尺寸（缩放基准）
    let size = { w: 0, h: 0 };
    let tool = 'pen';
    let drawing = false;
    let current = null;
    let on = safeGet(LS_ANNOT, '0') === '1';
    let raf = 0;
    let saveTimer = null;

    const dpr = () => window.devicePixelRatio || 1;

    function drawStroke(context, s) {
      if (!s.points || s.points.length === 0) return;
      context.save();
      if (s.tool === 'eraser') {
        // 画布是透明的：橡皮必须用 destination-out 真擦，不能用背景色涂
        context.globalCompositeOperation = 'destination-out';
        context.strokeStyle = '#000';
      } else {
        context.strokeStyle = s.color || '#ff6b6b';
      }
      context.lineWidth = s.width || 3;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i += 1) context.lineTo(s.points[i].x, s.points[i].y);
      if (s.points.length === 1) context.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1);
      context.stroke();
      context.restore();
    }

    function redraw() {
      ctx.clearRect(0, 0, size.w, size.h);
      stack.strokes.forEach((s) => drawStroke(ctx, s));
    }

    function resize() {
      // 画布高度跟题卡内容走：长题干在卡内滚动时，笔迹跟着内容一起滚，不会错位
      const w = Math.max(1, Math.round(card.clientWidth));
      const h = Math.max(1, Math.round(Math.max(card.scrollHeight, card.clientHeight)));
      const bw = Math.round(w * dpr());
      const bh = Math.round(h * dpr());
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      if (basis && basis.w !== w && basis.w > 0 && stack.strokes.length) {
        // 只按宽度换算：题干里的图片/公式延迟加载会把高度撑大，
        // 若跟着高度缩放会把已有笔迹压扁；高度变化只扩画布，不动坐标。
        stack.strokes = Core.rescaleStrokes(stack.strokes, { w: basis.w, h: basis.h || h }, { w, h: basis.h || h });
        scheduleSave();
      }
      basis = { w, h };
      size = { w, h };
      redraw();
    }

    function requestResize() {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; resize(); });
    }

    function refreshBadge() {
      btn.classList.toggle('has', stack.strokes.length > 0);
    }

    function persistNow() {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!qid) return;
      if (!stack.strokes.length) {
        try { localStorage.removeItem(keyOf(qid)); } catch (e) { /* 忽略 */ }
        refreshBadge();
        return;
      }
      if (!safeSet(keyOf(qid), JSON.stringify({ size: basis || size, strokes: stack.strokes }))) {
        toast(root, '草稿纸保存失败', 'err');
      }
      refreshBadge();
    }
    function scheduleSave() {
      if (saveTimer) return;
      saveTimer = setTimeout(() => { saveTimer = null; persistNow(); }, 400);
    }

    function attach(id) {
      if (id === qid) { requestResize(); return; }
      drawing = false; // 万一换题时笔还没抬，丢弃半截笔画，别写到新题上
      current = null;
      qid = id;
      stack = Core.createStrokeStack();
      const saved = safeJSON(keyOf(id), null);
      if (saved && Array.isArray(saved.strokes)) stack.strokes = saved.strokes;
      basis = saved && saved.size && saved.size.w > 0 ? saved.size : null;
      refreshBadge();
      requestResize(); // 题卡内容刚重建，等一帧量到真实高度再定画布尺寸
    }

    function applyOn() {
      card.classList.toggle('annot-on', on);
      btn.classList.toggle('on', on);
      btn.textContent = on ? '草稿纸 · 开' : '草稿纸';
      tools.classList.toggle('on', on);
      hint.textContent = on ? HINT_ANNOT : HINT_IDLE;
    }

    function setOn(next) {
      on = !!next;
      applyOn();
      safeSet(LS_ANNOT, on ? '1' : '0');
      if (on) requestResize();
    }

    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (!on || e.button !== 0) return;
      e.preventDefault();
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 捕获失败不影响绘制 */ }
      current = { tool, color: '#ff6b6b', width: tool === 'eraser' ? 18 : 3, points: [point(e)] };
      drawStroke(ctx, current);
      model.scratchActive = true;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !current) return;
      const p = point(e);
      const last = current.points[current.points.length - 1];
      if (Math.abs(p.x - last.x) < 1 && Math.abs(p.y - last.y) < 1) return;
      current.points.push(p);
      drawStroke(ctx, current);
    });
    function endStroke() {
      if (drawing && current) {
        Core.addStroke(stack, current);
        current = null;
        persistNow(); // 每笔落盘：刷新/切题都不丢
      }
      drawing = false;
      model.scratchActive = false;
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    // 兜底：指针在画布外抬起也要收笔（setPointerCapture 可能失效）
    document.addEventListener('pointerup', endStroke, true);
    document.addEventListener('pointercancel', endStroke, true);
    window.addEventListener('blur', endStroke); // 切窗口丢 pointerup 时不至于一直「作画中」

    root.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        tool = b.getAttribute('data-tool');
        root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    root.querySelector('[data-a="undo"]').addEventListener('click', () => { Core.undoStroke(stack); redraw(); persistNow(); });
    root.querySelector('[data-a="clear"]').addEventListener('click', () => { Core.clearStrokes(stack); redraw(); persistNow(); });
    btn.addEventListener('click', () => setOn(!on));

    // 题卡尺寸变化（窗口缩放 / 题干长短不同 / 图片加载完）都会重排画布
    const ro = new ResizeObserver(() => requestResize());
    ro.observe(card);
    ro.observe(root.querySelector('[data-f="body"]'));

    applyOn();

    const ctl = {
      attach,
      setOn,
      isOn: () => on,
      teardown() {
        ro.disconnect();
        clearTimeout(saveTimer);
        if (raf) cancelAnimationFrame(raf);
        if (currentScratch === ctl) currentScratch = null;
      }
    };
    currentScratch = ctl;
    return ctl;
  }

  // ================= 右下角开关（关闭沉浸模式后唯一入口） =================
  const PILL_CSS = `
  :host{all:initial}
  button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;padding:9px 15px;border:1px solid #3a4a5e;border-radius:999px;background:#1c2430;color:#cfd8e3;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;cursor:pointer;box-shadow:0 6px 22px rgba(0,0,0,.45);transition:background .15s,border-color .15s,transform .12s}
  button:hover{background:#243040;border-color:#4d6079}
  button:active{transform:scale(.97)}
  .dot{width:7px;height:7px;border-radius:50%;background:#7d6a3a;flex:0 0 auto}
  .sep{opacity:.4}
  b{font-weight:600;color:#9ccbff}
  `;

  let pillHost = null;

  function showEntryPill(onEnable) {
    const host = document.createElement('div');
    host.id = `${NS}-pill`;
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482999;pointer-events:auto';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = PILL_CSS;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-a', 'enableMode');
    btn.title = '开启沉浸式考试模式（当前已关闭，不会自动弹出）';
    btn.innerHTML = '<span class="dot"></span><span>沉浸模式已关闭</span><span class="sep">·</span><b>开启</b>';
    btn.onclick = () => { try { onEnable && onEnable(); } catch (e) { log('enable pill failed', String(e)); } };
    root.appendChild(style);
    root.appendChild(btn);
    document.body.appendChild(host);
    return host;
  }

  function removeEntryPill() {
    if (pillHost && pillHost.parentNode) pillHost.parentNode.removeChild(pillHost);
    pillHost = null;
  }


  // ================= 答题流程与事件 =================
  function commitAnswer(root, model, keys, opts) {
    const q = model.questions[model.state.index];
    const prev = model.picked[q.id] || [];
    // 无变化不写
    if (prev.length === keys.length && keys.every((k) => prev.includes(k))) return Promise.resolve(false);
    return writeNativeChoice(q, keys).then((ok) => {
      if (ok) {
        // 回读真值更新镜像（以原生回读为准，不缓存答案）
        const real = readNativePicked({ native: document.getElementById(`pb-pq-${q.id}`) || q.native, options: q.options });
        if (real.length) model.picked[q.id] = real; else delete model.picked[q.id];
        updateChrome(root, model);
        return true;
      }
      toast(root, '作答未保存，请重试', 'err');
      return false;
    });
  }

  function selectOption(root, model, index, ctx) {
    if (!Core.canAct(model.machine, Date.now(), 130)) return;
    const q = model.questions[model.state.index];
    if (index < 0 || index >= q.options.length) return;
    const key = q.options[index].key;
    let keys;
    if (q.type === 'multi') {
      keys = Core.toggleChoice(model.picked[q.id] || [], key); // 多选：切换，不自动切题
    } else {
      keys = [key]; // 单选：替换
    }
    Core.markActed(model.machine, Date.now());
    // 练习模式即时判分、不可撤回 → 加 150ms 防抖确认
    const delay = model.kind === 'practice' ? 150 : 0;
    clearTimeout(model._pickTimer);
    model._pickTimer = setTimeout(() => {
      commitAnswer(root, model, keys).then((ok) => {
        if (!ok) { renderQuestion(root, model, model.state.index, 0); return; }
        if (!model.singleCard && Core.shouldAutoAdvance(q.type)) {
          // 单选自动切题：作答已过锁，这里直接切，不再经过 canAct（否则被自己的时间戳拒绝）
          const after = Core.goNext(model.machine);
          if (after !== model.state.index) {
            model.state.index = after;
            persistState(model);
          }
          renderQuestion(root, model, model.state.index, 18);
        } else {
          renderQuestion(root, model, model.state.index, 0); // 多选只刷新选中态
        }
      });
    }, delay);
  }

  function doAdvance(root, model, dir) {
    if (!Core.canAct(model.machine, Date.now(), 130)) return;
    Core.markActed(model.machine, Date.now());
    if (model.singleCard) { nativeGoto(root, model, model.nativeIndex + dir, dir > 0 ? 18 : -18); return; }
    const before = model.state.index;
    const after = dir > 0 ? Core.goNext(model.machine) : Core.goPrev(model.machine);
    if (after === before) return;
    model.state.index = after;
    persistState(model);
    renderQuestion(root, model, after, dir > 0 ? 18 : -18);
    if (model.cardPanelOpen) renderGrid(root, model);
  }

  // 一屏一卡模式（练习/习题册）：通过点击原生答题卡格子切题，再从新题卡回读内容
  function nativeGoto(root, model, target, dir) {
    const cells = $$('.pb-cell');
    if (!cells.length || target < 0 || target >= cells.length) return false;
    if (target === model.nativeIndex) return false;
    const prev = model.nativeIndex;
    cells[target].click();
    model.nativeIndex = target;
    if (model.cardPanelOpen) renderGrid(root, model);
    setTimeout(() => {
      const found = extractQuestionsFromDOM();
      if (found.questions.length) {
        model.questions = [found.questions[0]];
        const v = readNativePicked(model.questions[0]);
        if (v.length) model.picked[model.questions[0].id] = v;
        else delete model.picked[model.questions[0].id];
      }
      const chrome = readNativeChrome();
      if (typeof chrome.practiceDone === 'number') model.nativeDone = chrome.practiceDone;
      const now = readNativeCells(); // 以原生答题卡的实际当前格为准，避免与原生快捷键互相打架后错位
      if (now) model.nativeIndex = now.index;
      renderQuestion(root, model, 0, dir || (target > prev ? 18 : -18));
      if (model.cardPanelOpen) renderGrid(root, model);
    }, 260);
    return true;
  }

  function jumpTo(root, model, index) {
    if (index < 0 || index >= model.total) return;
    if (model.singleCard) { Core.goTo(model.machine, index); nativeGoto(root, model, index); return; }
    model.state.index = index;
    Core.goTo(model.machine, index);
    persistState(model);
    renderQuestion(root, model, index, 0);
    renderGrid(root, model);
  }

  function persistState(model) {
    safeSet(KEY_STATE(model.key), JSON.stringify({
      currentIndex: model.state.index,
      submitted: model.state.submitted,
      motion: model.motion
    }));
  }

  function showSubmitConfirm(root, model) {
    const answered = Core.answeredCount(model.picked);
    const unanswered = model.total - answered;
    const elapsed = Core.formatDuration(Core.elapsedSeconds(model.startedAt, Date.now()));
    const panel = root.querySelector('[data-f="cardpanel"]');
    const box = panel.querySelector('.im-panel-box');
    box.innerHTML = `
      <h3>交卷确认</h3>
      <div style="line-height:2;font-size:15px">
        <div>已作答：<b>${answered}</b> / ${model.total}</div>
        <div>未作答：<b style="color:${unanswered ? '#f0a35e' : '#8ff0bd'}">${unanswered}</b> 题</div>
        <div>考试用时：<b>${elapsed}</b></div>
        ${unanswered ? '<p style="color:#f0a35e;font-size:13px">还有未作答题目，确认提交吗？</p>' : ''}
      </div>
      <div style="margin-top:18px;text-align:right;display:flex;gap:10px;justify-content:flex-end">
        <button class="im-btn" data-a="cancelSubmit">再检查一下</button>
        <button class="im-btn danger" data-a="reallySubmit">确认交卷</button>
      </div>`;
    panel.classList.add('open');
    box.querySelector('[data-a="cancelSubmit"]').onclick = () => {
      panel.classList.remove('open');
      // 恢复答题卡内容
      box.innerHTML = `<h3>答题卡 <span class="im-hint" data-f="cardstat"></span></h3>
        <div class="im-grid" data-f="grid"></div>
        <div style="margin-top:16px;text-align:right"><button class="im-btn" data-a="closecard">关闭 (Esc)</button></div>`;
      box.querySelector('[data-a="closecard"]').onclick = () => panel.classList.remove('open');
      renderGrid(root, model);
    };
    box.querySelector('[data-a="reallySubmit"]').onclick = () => {
      if (model.state.submitted) return; // 幂等
      model.state.submitted = true;
      persistState(model);
      panel.classList.remove('open');
      // 让位原生弹窗：降低脚本层 z-index / 交出指针，避免遮挡原生确认框（R-5）
      const app = root.querySelector('.im-app');
      app.style.zIndex = '1';
      app.style.pointerEvents = 'none';
      const clicked = clickNativeSubmit();
      if (!clicked) {
        toast(root, '未找到原生交卷按钮，请在原页面交卷', 'err');
        app.style.zIndex = ''; app.style.pointerEvents = '';
        model.state.submitted = false; persistState(model);
      }
      // 不自行宣告成功：以原生结果态为准。监听原生判分结果出现后可选隐藏覆盖层。
    };
  }

  function bindEvents(root, model, scratch) {
    // 选项点击（委托）
    root.querySelector('[data-f="card"]').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-opt]');
      if (btn) selectOption(root, model, Number(btn.getAttribute('data-opt')), { source: 'click' });
    });
    root.querySelector('[data-a="prev"]').onclick = () => doAdvance(root, model, -1);
    root.querySelector('[data-a="next"]').onclick = () => doAdvance(root, model, 1);
    root.querySelector('[data-a="submit"]').onclick = () => showSubmitConfirm(root, model);
    const nsBtn = root.querySelector('[data-a="nativeSubmit"]');
    if (nsBtn) nsBtn.onclick = () => {
      const b = $('.pb-submit');
      if (b && !b.disabled) {
        b.click();
        setTimeout(() => {
          const chrome = readNativeChrome();
          if (typeof chrome.practiceDone === 'number') model.nativeDone = chrome.practiceDone;
          const found = extractQuestionsFromDOM();
          if (found.questions.length) {
            const v = readNativePicked(found.questions[0]);
            model.questions = [found.questions[0]];
            if (v.length) model.picked[found.questions[0].id] = v;
          }
          renderQuestion(root, model, 0, 0);
        }, 500);
      } else {
        toast(root, '原生提交按钮当前不可用（可能尚未选择答案）', 'err');
      }
    };

    const cardPanel = root.querySelector('[data-f="cardpanel"]');
    root.querySelector('[data-a="card"]').onclick = () => {
      model.cardPanelOpen = true;
      renderGrid(root, model);
      cardPanel.classList.add('open');
    };
    root.querySelector('[data-a="closecard"]').onclick = () => { model.cardPanelOpen = false; cardPanel.classList.remove('open'); };
    cardPanel.addEventListener('click', (e) => {
      const cell = e.target.closest('[data-jump]');
      if (cell) { jumpTo(root, model, Number(cell.getAttribute('data-jump'))); cardPanel.classList.remove('open'); model.cardPanelOpen = false; }
    });

    // 退出：持久关闭（写入偏好，不再自动挂载），恢复原页面，右下角留开关入口
    root.querySelector('[data-a="exit"]').onclick = () => {
      setModeEnabled(false);
      teardown(true);
      ensurePill();
    };

    // 键盘（仅白名单）。挂 document 捕获阶段：焦点可能不在 Shadow Root。
    // 命中白名单才拦截并阻止冒泡（避免与网站自身快捷键重复生效）；白名单外一律放行。
    document.addEventListener('keydown', (e) => {
      if (!currentModel || currentModel !== model) return; // 只服务当前实例
      const tgt = e.composedPath ? e.composedPath()[0] : e.target;
      const ctx = {
        inEditable: !!(tgt && tgt.closest && tgt.closest('input,textarea,[contenteditable="true"]')),
        scratchActive: !!model.scratchActive,
        isComposing: !!e.isComposing,
        repeat: !!e.repeat,
        modifier: !!(e.ctrlKey || e.metaKey || e.altKey)
      };
      if (Core.isKeyboardBlocked(ctx)) return;
      const q = model.questions[model.singleCard ? 0 : model.state.index];
      // 拦截后必须 stopPropagation：否则网站自己的方向键/字母快捷键会再执行一次，
      // 造成「按一次 → 跳过两题」（真实站点实测到的问题）
      const swallow = () => { e.preventDefault(); e.stopPropagation(); };
      const nav = Core.classifyNavigationKey(e.key);
      if (nav) {
        swallow();
        if (nav === 'confirm') {
          if (q.type === 'multi') doAdvance(root, model, 1);
        } else if (nav === 'prev') doAdvance(root, model, -1);
        else if (nav === 'next') doAdvance(root, model, 1);
        else if (nav === 'esc') {
          cardPanel.classList.remove('open');
          if (scratch.isOn()) scratch.setOn(false); // Esc 先退出题面批注
          model.cardPanelOpen = false;
        }
        return;
      }
      const idx = Core.optionIndexFromKey(e.key, q.options.length);
      if (idx >= 0) { swallow(); selectOption(root, model, idx, { source: 'key' }); }
      // 其余按键一律放行
    }, true);
    // 记录监听以便 teardown 清理
    model._keyHandler = true;

    // 每秒更新计时
    model.timerHandle = setInterval(() => updateChrome(root, model), 1000);
  }

  // ================= 生命周期 =================
  let currentHost = null;
  let currentModel = null;
  let observer = null;
  let observerTimer = null;
  let lastKey = null;

  // ================= 模式开关（持久） =================
  // 默认开启；用户点「退出」后写 '0'，此后不再自动挂载，只在右下角留一个开启入口。
  // 之前没有这个状态，teardown 只清了内存，MutationObserver / 兜底轮询 / 站点自身每秒的
  // DOM 变更会在几百毫秒内把覆盖层重新建起来 —— 这就是「退出几秒后又回去」的根因。
  const LS_MODE = 'pol:immersive-enabled';
  function isModeEnabled() {
    try { return localStorage.getItem(LS_MODE) !== '0'; } catch (e) { return true; }
  }
  function setModeEnabled(on) {
    try { localStorage.setItem(LS_MODE, on ? '1' : '0'); } catch (e) { /* localStorage 不可用时按会话内生效 */ }
  }

  // 关闭态下只在「可答题页面」显示开关入口；页面不是答题页就不留痕
  function ensurePill() {
    if (isModeEnabled()) { removeEntryPill(); return; }
    const path = location.pathname;
    if (isNonExamPath(path)) { removeEntryPill(); return; }
    const hasQuiz = !!detectKind(path) || $$('[id^="pb-pq-"], .pb-card').length > 0;
    if (!hasQuiz) { removeEntryPill(); return; }
    if (pillHost && pillHost.isConnected) return;
    pillHost = showEntryPill(() => {
      setModeEnabled(true);
      removeEntryPill();
      lastKey = null;
      boot();
    });
  }

  // 挂载期间锁住页面滚动：覆盖层是 fixed inset:0，但视口滚动条仍会画在最右侧
  let scrollLock = null;
  function lockScroll() {
    if (scrollLock) return;
    const de = document.documentElement;
    const b = document.body;
    const gap = window.innerWidth - de.clientWidth; // 滚动条占位宽度
    scrollLock = { deOverflow: de.style.overflow, bOverflow: b.style.overflow, bPadRight: b.style.paddingRight };
    de.style.overflow = 'hidden';
    b.style.overflow = 'hidden';
    if (gap > 0) b.style.paddingRight = gap + 'px'; // 补位，避免底层页面横向跳动
  }
  function unlockScroll() {
    if (!scrollLock) return;
    document.documentElement.style.overflow = scrollLock.deOverflow;
    document.body.style.overflow = scrollLock.bOverflow;
    document.body.style.paddingRight = scrollLock.bPadRight;
    scrollLock = null;
  }

  function teardown(restore) {
    if (model_timer()) clearInterval(model_timer());
    if (currentModel && currentModel.scratch) currentModel.scratch.teardown();
    unlockScroll();
    // 注意：不移除 MutationObserver——它还要负责关闭态下的开关入口维护
    if (currentHost && currentHost.parentNode) currentHost.parentNode.removeChild(currentHost);
    currentHost = null; currentModel = null;
    if (restore) log('已退出沉浸模式，恢复原页面');
  }
  function model_timer() { return currentModel && currentModel.timerHandle; }

  function startObserver() {
    if (observer) return; // 只装一次：SPA 首屏渲染晚于脚本注入时，靠它触发重试
    observer = new MutationObserver(() => {
      // 防抖 + 过滤自身节点
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        if (!isModeEnabled()) { ensurePill(); return; } // 关闭态：绝不自动挂载
        if (currentHost && currentHost.isConnected) return; // 已挂载，无需重试
        boot();
      }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // 重入保护：SPA 渲染期 MutationObserver 会高频触发，避免并发 loadModel
  let bootPromise = null;
  function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = bootOnce().catch((e) => { log('boot failed', String(e)); }).finally(() => { bootPromise = null; });
    return bootPromise;
  }

  async function bootOnce() {
    if (!isModeEnabled()) { if (currentHost) teardown(false); ensurePill(); return; }
    const path = location.pathname;
    if (isNonExamPath(path)) { if (currentHost) teardown(false); return; }
    const kind = detectKind(path);
    if (!kind) {
      // Fallback：识别通用题卡
      const found = extractQuestionsFromDOM();
      if (!found.questions.length) { if (currentHost) teardown(false); return; }
    }
    const key = paperKeyFromPath(path) + '|' + (kind || 'fallback');
    if (currentHost && lastKey === key) return; // 同卷不重建

    const model = await loadModel(kind || 'fallback', path);
    if (!model) { log('未识别到可答题界面，跳过'); if (currentHost) teardown(false); return; }
    if (model.__unauthorized) { log('登录态失效'); if (currentHost) teardown(false); return; }

    if (currentHost) teardown(false); // 换卷销毁旧实例
    lastKey = key;
    const savedState = safeJSON(KEY_STATE(model.key), null);
    model.state = {
      index: Number.isInteger(savedState?.currentIndex) ? Math.min(savedState.currentIndex, model.total - 1) : 0,
      submitted: !!(savedState && savedState.submitted)
    };
    model.machine = Core.createMachine(model.total);
    Core.goTo(model.machine, model.state.index);
    model.motion = savedState ? savedState.motion !== false : true;
    model.cardPanelOpen = false;
    model.scratchActive = false;

    // 挂载 Shadow Host：z-index 低于原生对话框（R-5）
    const host = document.createElement('div');
    host.id = `${NS}-host`;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none';
    document.body.appendChild(host);
    lockScroll();
    removeEntryPill();
    const root = buildShadow(host);
    root.querySelector('.im-app').style.pointerEvents = 'auto';
    if (!model.motion) root.querySelector('.im-app').classList.add('im-nomotion');

    const scratch = initScratch(root, model);
    model.scratch = scratch;
    bindEvents(root, model, scratch);
    renderQuestion(root, model, model.state.index, 0);
    currentHost = host; currentModel = model;

    if (model.expired) toast(root, '本次草稿已超过 24 小时，请在原页面重新开始', 'err');
    log('mounted', { kind, key, total: model.total, questions: model.questions.length });

    startObserver();
  }

  // history 拦截：SPA 路由切换也触发 boot
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  function hookHistory() {
    history.pushState = function (...a) { const r = origPush.apply(this, a); setTimeout(boot, 0); return r; };
    history.replaceState = function (...a) { const r = origReplace.apply(this, a); setTimeout(boot, 0); return r; };
    window.addEventListener('popstate', () => setTimeout(boot, 0));
  }
  window.addEventListener('beforeunload', () => { if (observer) observer.disconnect(); if (currentModel && currentModel.timerHandle) clearInterval(currentModel.timerHandle); });

  hookHistory();
  // 等 body 就绪（油猴 @run-at document-idle 下已就绪；测试注入于 document-start 时需等）
  function start() {
    startObserver(); // 先装观察器：SPA 首屏题卡渲染晚于脚本注入时，靠它重试挂载
    if (!isModeEnabled()) { ensurePill(); return; } // 关闭态：不挂载、不轮询，只留开关入口
    boot();
    // 兜底轮询：MutationObserver 偶发漏报（例如题卡在同一个微任务批次内替换）时仍能挂载
    let tries = 0;
    const poll = setInterval(() => {
      tries += 1;
      if (!isModeEnabled()) { clearInterval(poll); ensurePill(); return; }
      if ((currentHost && currentHost.isConnected) || tries > 90) { clearInterval(poll); return; }
      boot();
    }, 400);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

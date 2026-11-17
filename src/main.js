// ==UserScript==
// @name        政砖沉浸式考试模式 (Immersive Exam)
// @namespace    https://github.com/Swcmb/yanbrick-politics-exam-mode
// @version      0.1.0
// @description  把 yanbrick.com/politics 的选择题练习改造成一屏一题、键盘作答、答题卡、电子草稿纸的沉浸式考试界面。答案与交卷复用网站原生机制。
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
 *       → Shadow DOM 呈现层（一屏一题 / 顶栏 / 答题卡 / 草稿纸）→ 写回驱动原生节点 click。
 * 不接管答案/计时/判分真值；脚本只持有渲染镜像状态。
 */
(function () {
  'use strict';

  /* __CORE_INLINE__ */

  const Core = globalThis.ImmersiveCore;
  if (!Core) { console.error('[immersive] core 未加载'); return; }

  const NS = 'yanbrick-immersive';
  const KEY_STATE = (id) => `pol:immersive-state:${id}`;
  const KEY_SCRATCH = (id) => `pol:immersive-scratch:${id}`;
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
      questions.push({
        id: String(idAttr),
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

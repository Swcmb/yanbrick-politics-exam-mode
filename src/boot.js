
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

    root.querySelector('[data-a="scratch"]').onclick = () => {
      scratch.panel.classList.toggle('open');
      if (scratch.panel.classList.contains('open')) scratch.resizeCanvas(false);
    };
    root.querySelector('[data-a="closeScratch"]').onclick = () => scratch.panel.classList.remove('open');

    // 退出：销毁覆盖层，恢复原页面
    root.querySelector('[data-a="exit"]').onclick = () => teardown(true);

    // 草稿纸激活时，键盘不触发答题
    root.querySelector('[data-f="scratch"]').addEventListener('pointerdown', () => { model.scratchActive = true; });
    document.addEventListener('pointerup', () => { model.scratchActive = false; }, true);

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
          scratch.panel.classList.remove('open');
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

  function teardown(restore) {
    if (model_timer()) clearInterval(model_timer());
    // 注意：不移除 MutationObserver——SPA 内退出/切卷后仍需它触发重新挂载
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
    const root = buildShadow(host);
    root.querySelector('.im-app').style.pointerEvents = 'auto';
    if (!model.motion) root.querySelector('.im-app').classList.add('im-nomotion');

    const scratch = initScratch(root, model);
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
    boot();
    // 兜底轮询：MutationObserver 偶发漏报（例如题卡在同一个微任务批次内替换）时仍能挂载
    let tries = 0;
    const poll = setInterval(() => {
      tries += 1;
      if ((currentHost && currentHost.isConnected) || tries > 90) { clearInterval(poll); return; }
      boot();
    }, 400);
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

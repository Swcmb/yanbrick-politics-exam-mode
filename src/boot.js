
  // ================= 答题流程与事件 =================
  function commitAnswer(root, model, keys, opts) {
    const q = model.questions[model.state.index];
    const prev = model.picked[q.id] || [];
    // 无变化不写；但对用户来说「按了自己已经选的项」也是成功的一次作答
    // （返回 true 才会走自动切题，否则重按当前选项就卡在原地）
    if (prev.length === keys.length && keys.every((k) => prev.includes(k))) return Promise.resolve(true);
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
        return;
      }
      // 原生是同页异步出成绩：等到 .pb-score 出现就卸载覆盖层，把成绩直接让出来。
      // 判分失败/超时则恢复覆盖层并撤销 submitted，让用户能重试。
      let waited = 0;
      const scoreTimer = setInterval(() => {
        waited += 200;
        const score = $('.pb-score');
        if (score) {
          clearInterval(scoreTimer);
          markResultState(); // 卸载 + 记住结果态，防止站点每秒重渲染又把沉浸层挂回来
          try { score.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* 忽略不支持的浏览器 */ }
          return;
        }
        if (waited >= 20000) {
          clearInterval(scoreTimer);
          app.style.zIndex = ''; app.style.pointerEvents = '';
          model.state.submitted = false; persistState(model);
          toast(root, '未检测到成绩，请到原页面确认交卷结果', 'err');
        }
      }, 200);
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
        // Enter / 空格 = 确认并下一题（单选、多选一致；单选按字母已自动切题，
        // 这里给「回到某题想往前走」留一条确认键路径）
        if (nav === 'confirm') doAdvance(root, model, 1);
        else if (nav === 'prev') doAdvance(root, model, -1);
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
  let lastPath = null;
  let heartbeatTimer = null;
  // 已经确认进入结果态的试卷 key：同一次考试的「成绩 / 作答 / 答案」视图不再重挂
  let resultKey = null;

  // 结果态以原生 DOM 为准：成绩块或错题标记（回看/逐题解析）出现即为原生结果页。
  // 不能只看 .pb-score —— 切到「作答 / 答案」后它可能被移除，但页面仍是结果态。
  function isResultState() {
    if ($('.pb-score')) return true;
    if ($('li[id^="pb-pq-"] span.no, li[id^="pb-pq-"] .pb-paper-ana, li[id^="pb-pq-"] .pb-no-analysis')) return true;
    // 「作答 / 答案」视图：题卡还在，但题干/选项已被答案与解析替换，也没有交卷/答题卡入口
    const cards = $$('li[id^="pb-pq-"], .pb-card');
    if (cards.length && !$('.pb-submit') && !$('.pb-cell') && !$('.pb-opts button.pb-opt')) return true;
    return false;
  }

  function markResultState() {
    const key = paperKeyFromPath(location.pathname);
    const first = resultKey !== key;
    if (currentHost) teardown(false);
    resultKey = key;
    // 直接落地结果页时也要展开错题解析（正常入口由「看这次」点击监听负责）
    if (first && $('.pb-redo-btn')) watchReviewExpand();
  }

  // 站点重渲染可能把宿主节点从 DOM 摘掉，但闭包里的 currentHost 还在。
  // 不处理这个「脱离态」，bootOnce 的同卷守卫会一直认为已挂载 → 必须刷新才好。
  function reconcileHost() {
    if (currentHost && !currentHost.isConnected) { teardown(false); return true; }
    return false;
  }

  // 统一入口：返回 true 表示「本次事件已处理，不要再尝试挂载」
  function syncResultState() {
    if (!isModeEnabled()) { resultKey = null; if (currentHost) teardown(false); ensurePill(); return true; }
    if (isResultState()) { markResultState(); return true; }
    return false;
  }

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
      resultKey = null;
      arm();
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
    currentHost = null; currentModel = null; lastKey = null;
    if (restore) log('已退出沉浸模式，恢复原页面');
  }
  function model_timer() { return currentModel && currentModel.timerHandle; }

  function startObserver() {
    if (observer) return; // 只装一次
    observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        if (syncResultState()) return;
        if (reconcileHost()) { boot(); return; }
        if (!isModeEnabled()) { ensurePill(); return; }
        if (currentHost && currentHost.isConnected) return;
        boot();
      }, 200);
    });
    // 观察 document 而不是 document.body：站点可能整体替换 body，观察旧节点会永远失效。
    observer.observe(document, { childList: true, subtree: true });
  }

  // 心跳取代原先「90 次 × 400ms 后永久停止」的兜底轮询：
  // 注入晚、bfcache 恢复、SPA 切路由、宿主被重渲染摘掉，都能在下一次心跳自愈。
  function heartbeatTick() {
    if (syncResultState()) return;
    const path = location.pathname;
    if (path !== lastPath) { lastPath = path; resultKey = null; }
    // 结果 DOM 已被新试卷替换（重做 / SPA 换卷）：解除 latch，允许重新挂载
    if (resultKey && resultKey === paperKeyFromPath(path) && !isResultState()) resultKey = null;
    if (resultKey && resultKey === paperKeyFromPath(path)) return;
    if (reconcileHost()) { boot(); return; }
    if (currentHost && currentHost.isConnected) return;
    boot();
  }
  function ensureHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(heartbeatTick, 500);
  }

  // 幂等的重新武装入口：start / pageshow / visibilitychange / focus / SPA 路由都走这里
  function arm() {
    startObserver();
    if (!isModeEnabled()) { ensurePill(); return; }
    ensureHeartbeat();
    boot();
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
    if (path !== lastPath) { lastPath = path; resultKey = null; }
    if (!isModeEnabled()) { resultKey = null; if (currentHost) teardown(false); ensurePill(); return; }
    if (isNonExamPath(path)) { if (currentHost) teardown(false); return; }
    // 出成绩 / 回看历次成绩时让位原生页面，并记住这次考试：
    // 切到「作答 / 答案」后 .pb-score 可能消失，但仍是结果态，不能重挂。
    if (isResultState()) { markResultState(); return; }
    const paperKey = paperKeyFromPath(path);
    // 只有结果 DOM 仍在时才坚持 latch；换卷后旧结果节点被替换就要放行
    if (resultKey && resultKey === paperKey && isResultState()) return;
    if (resultKey && resultKey === paperKey) resultKey = null;
    const kind = detectKind(path);
    if (!kind) {
      // Fallback：识别通用题卡
      const found = extractQuestionsFromDOM();
      if (!found.questions.length) { if (currentHost) teardown(false); return; }
    }
    const key = paperKey + '|' + (kind || 'fallback');
    if (currentHost && currentHost.isConnected && lastKey === key) return; // 同卷不重建

    const model = await loadModel(kind || 'fallback', path);
    // await 期间站点可能已判分出成绩，或路由已切走：不能把覆盖层挂到结果页上
    if (isResultState() || (resultKey && resultKey === paperKey)
        || !isModeEnabled() || location.pathname !== path) {
      if (isResultState() || (resultKey && resultKey === paperKey)) markResultState();
      return;
    }
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

  // 回看历次成绩：原生把错题解析默认收起（button.pb-link「展开解析」），
  // 点「看这次」后把错题逐条展开；答对的题保持原状。
  function expandWrongAnalysisOnce() {
    let wrong = 0, opened = 0;
    $$('li[id^="pb-pq-"]').forEach((li) => {
      if (!li.querySelector('span.no')) return; // 原生错题标记：✗ 答案 X
      wrong++;
      const btn = $$('button.pb-link', li).find((b) => /展开解析/.test(b.textContent || ''));
      if (btn) { btn.click(); opened++; }
    });
    return { wrong, opened };
  }
  let reviewTimer = null;
  function watchReviewExpand() {
    let tries = 0;
    clearInterval(reviewTimer);
    reviewTimer = setInterval(() => {
      tries++;
      const r = expandWrongAnalysisOnce();
      const pending = $$('li[id^="pb-pq-"]').filter(
        (li) => li.querySelector('span.no')
          && !li.querySelector('.pb-paper-ana') && !li.querySelector('.pb-no-analysis')
      ).length;
      // 题库异步加载，最多等 6 秒；错题全部展开后立即停止，避免用户手动收起又被展开
      if ((r.wrong > 0 && pending === 0) || tries >= 40) {
        clearInterval(reviewTimer); reviewTimer = null;
      }
    }, 150);
  }
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('.pb-history .pb-redo-btn');
    if (btn && /看这次/.test(btn.textContent || '')) watchReviewExpand();
  }, true);

  // history 拦截：SPA 路由切换也重新武装（换卷要清掉旧试卷的结果 latch）
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  function hookHistory() {
    history.pushState = function (...a) { const r = origPush.apply(this, a); setTimeout(arm, 0); return r; };
    history.replaceState = function (...a) { const r = origReplace.apply(this, a); setTimeout(arm, 0); return r; };
    window.addEventListener('popstate', () => setTimeout(arm, 0));
  }

  // bfcache / 标签恢复：beforeunload 只清句柄，不永久停用守卫；pageshow 会重新装。
  window.addEventListener('beforeunload', () => {
    if (observer) { observer.disconnect(); observer = null; }
    if (observerTimer) { clearTimeout(observerTimer); observerTimer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (currentModel && currentModel.timerHandle) clearInterval(currentModel.timerHandle);
  });

  hookHistory();
  window.addEventListener('pageshow', arm);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); });
  window.addEventListener('focus', arm);
  window.addEventListener('load', arm);

  // 等 body 就绪（油猴 @run-at document-idle 下已就绪；测试注入于 document-start 时需等）
  if (document.body) arm();
  else document.addEventListener('DOMContentLoaded', arm, { once: true });
})();

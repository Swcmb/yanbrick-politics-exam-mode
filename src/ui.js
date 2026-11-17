
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
  .im-card{width:min(860px,100%);max-height:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#3a4759 transparent;background:#161c24;border:1px solid #2a323e;border-radius:14px;padding:26px 30px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
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
  .im-scratch{position:fixed;z-index:4;right:20px;bottom:80px;width:min(440px,92vw);height:min(340px,60vh);background:#11161d;border:1px solid #3a4554;border-radius:12px;display:none;flex-direction:column;box-shadow:0 14px 44px rgba(0,0,0,.55);overflow:hidden}
  .im-scratch.open{display:flex}
  .im-scratch-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1b222c;cursor:move;user-select:none}
  .im-scratch-head span{font-size:13px;color:#9fb0c4}
  .im-scratch-tools{display:flex;gap:6px;padding:6px 10px;background:#151b23;border-bottom:1px solid #2a323e}
  .im-tool{border:1px solid #38424f;background:#202935;color:#dbe4ef;border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer}
  .im-tool.on{background:#2f7de1;border-color:#2f7de1;color:#fff}
  .im-canvas-wrap{flex:1;position:relative;min-height:0}
  .im-canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair}
  .im-resize{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;background:repeating-linear-gradient(135deg,#5b6b80 0 2px,transparent 2px 4px)}
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
        <button class="im-btn" data-a="scratch">草稿纸</button>
        <button class="im-btn" data-a="exit" title="退出沉浸模式，恢复原页面（不会自动再弹出；右下角可重新开启）">退出</button>
      </div>
      <div class="im-main"><div class="im-card" data-f="card"></div></div>
      <div class="im-navbar">
        <button class="im-btn" data-a="prev">上一题</button>
        <button class="im-btn" data-a="next">下一题</button>
        <button class="im-btn" data-a="nativeSubmit" style="display:none" title="调用网站原生「提交本题」（练习模式即时判分）">提交本题</button>
        <button class="im-btn danger" data-a="submit" style="display:none">交卷</button>
        <span class="im-hint">A/B/C/D 或 1/2/3/4 选择 · Enter 确认 · 左右切题 · Esc 关闭</span>
      </div>
      <div class="im-panel" data-f="cardpanel">
        <div class="im-panel-box im-pop">
          <h3>答题卡 <span class="im-hint" data-f="cardstat"></span></h3>
          <div class="im-grid" data-f="grid"></div>
          <div style="margin-top:16px;text-align:right"><button class="im-btn" data-a="closecard">关闭 (Esc)</button></div>
        </div>
      </div>
      <div class="im-scratch" data-f="scratch">
        <div class="im-scratch-head" data-drag="1"><span>电子草稿纸（整套卷共享）</span><span class="im-spacer"></span><button class="im-tool" data-a="closeScratch">关</button></div>
        <div class="im-scratch-tools">
          <button class="im-tool on" data-tool="pen">画笔</button>
          <button class="im-tool" data-tool="eraser">橡皮</button>
          <button class="im-tool" data-a="undo">撤销</button>
          <button class="im-tool" data-a="clear">清空</button>
        </div>
        <div class="im-canvas-wrap"><canvas class="im-canvas"></canvas><div class="im-resize" data-resize="1"></div></div>
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
    const card = root.querySelector('[data-f="card"]');
    const pickedSet = new Set(model.picked[q.id] || []);
    const isMulti = q.type === 'multi';
    card.innerHTML = `
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

  // ================= 电子草稿纸 =================
  function initScratch(root, model) {
    const canvas = root.querySelector('.im-canvas');
    const wrap = root.querySelector('.im-canvas-wrap');
    const panel = root.querySelector('[data-f="scratch"]');
    const stack = Core.createStrokeStack();
    const saved = safeJSON(KEY_SCRATCH(model.key), { size: null, strokes: [] });
    let tool = 'pen';
    let drawing = false;
    let current = null;
    let size = { w: 0, h: 0 };
    let originalSize = saved.size || null;

    function dpr() { return window.devicePixelRatio || 1; }

    function resizeCanvas(preserve) {
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === size.w && h === size.h) return;
      let strokes = stack.strokes;
      if (preserve && originalSize && size.w) strokes = Core.rescaleStrokes(strokes, originalSize, { w, h });
      size = { w, h };
      canvas.width = Math.round(w * dpr());
      canvas.height = Math.round(h * dpr());
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
      originalSize = { w, h };
      stack.strokes = strokes;
      redraw();
    }

    function drawStroke(ctx, s) {
      if (!s.points || s.points.length === 0) return;
      ctx.save();
      ctx.strokeStyle = s.tool === 'eraser' ? '#11161d' : (s.color || '#7cc4ff');
      ctx.lineWidth = s.width || (s.tool === 'eraser' ? 16 : 2.5);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
      if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1);
      ctx.stroke();
      ctx.restore();
    }
    function redraw() {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = '#11161d'; ctx.fillRect(0, 0, size.w, size.h);
      stack.strokes.forEach((s) => drawStroke(ctx, s));
    }
    function persist() {
      if (!safeSet(KEY_SCRATCH(model.key), JSON.stringify({ size: originalSize, strokes: stack.strokes }))) {
        toast(root, '草稿纸保存失败', 'err');
      }
    }
    function point(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 捕获失败不影响绘制 */ }
      current = { tool, color: '#7cc4ff', width: tool === 'eraser' ? 16 : 2.5, points: [point(e)] };
      drawStroke(canvas.getContext('2d'), current);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !current) return;
      current.points.push(point(e));
      drawStroke(canvas.getContext('2d'), current);
    });
    const end = () => { if (drawing && current) { Core.addStroke(stack, current); current = null; persist(); } drawing = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    // 兜底：指针在 canvas 外抬起也要结束笔画（capture 可能失效）
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);

    root.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        tool = b.getAttribute('data-tool');
        root.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    root.querySelector('[data-a="undo"]').addEventListener('click', () => { Core.undoStroke(stack); redraw(); persist(); });
    root.querySelector('[data-a="clear"]').addEventListener('click', () => { Core.clearStrokes(stack); redraw(); persist(); });

    // 拖动面板
    const head = root.querySelector('[data-drag]');
    let drag = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      panel.style.left = (e.clientX - drag.dx) + 'px';
      panel.style.top = (e.clientY - drag.dy) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    head.addEventListener('pointerup', () => { drag = null; });

    // 缩放面板：调整尺寸后重绘旧内容（不丢）
    const grip = root.querySelector('[data-resize]');
    let resizing = null;
    grip.addEventListener('pointerdown', (e) => {
      const r = panel.getBoundingClientRect();
      resizing = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      grip.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!resizing) return;
      panel.style.width = Math.max(260, resizing.w + e.clientX - resizing.x) + 'px';
      panel.style.height = Math.max(200, resizing.h + e.clientY - resizing.y) + 'px';
      resizeCanvas(true);
    });
    grip.addEventListener('pointerup', () => { resizing = null; persist(); });

    // 恢复已存笔画
    if (saved.strokes && saved.strokes.length) stack.strokes = saved.strokes;
    const ro = new ResizeObserver(() => { if (panel.classList.contains('open')) resizeCanvas(true); });
    ro.observe(wrap);
    panel.addEventListener('transitionend', () => {});

    return { panel, resizeCanvas, teardown() { ro.disconnect(); } };
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

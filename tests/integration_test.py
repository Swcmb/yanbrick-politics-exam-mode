"""
L2 集成测试：Playwright + 本地 fixture + API mock（无需登录态）
运行：D:/ProgramFiles/deeplearning/python.exe tests/integration_test.py
SPDX-License-Identifier: GPL-3.0-or-later
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "paper.html").read_text(encoding="utf-8")
SCRIPT = (ROOT / "dist" / "yanbrick-immersive-exam.user.js").read_text(encoding="utf-8")
URL = "https://yanbrick.com/politics/paper/fixture"

results = []
def check(name, cond, detail=""):
    ok = bool(cond)
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), name, ("- " + str(detail)[:70] if detail else ""))

# 所有 DOM 操作统一走 page.evaluate（含 Shadow DOM）
JS = {
    "host": "() => !!document.getElementById('yanbrick-immersive-host')",
    "text": "(sel) => { const h=document.getElementById('yanbrick-immersive-host'); const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); return e?(e.innerText||e.textContent||'').trim():null; }",
    "count": "(sel) => { const h=document.getElementById('yanbrick-immersive-host'); return h&&h.shadowRoot?h.shadowRoot.querySelectorAll(sel).length:-1; }",
    "click": "(sel) => { const h=document.getElementById('yanbrick-immersive-host'); const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); if(e){e.click();return true;} return false; }",
    "display": "(sel) => { const h=document.getElementById('yanbrick-immersive-host'); const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); return e?getComputedStyle(e).display:'missing'; }",
    "scratchOpen": "() => { const h=document.getElementById('yanbrick-immersive-host'); const e=h&&h.shadowRoot&&h.shadowRoot.querySelector('[data-f=scratch]'); return e?e.classList.contains('open'):false; }",
    "nativePicked": "(id) => Array.from(document.querySelectorAll('#'+id+' .pb-opt')).map(b=>b.classList.contains('picked'))",
    "nativeKeys": "(id) => Array.from(document.querySelectorAll('#'+id+' .pb-opt')).map((b,i)=>b.classList.contains('picked')?['A','B','C','D'][i]:null).filter(Boolean)",
    "ls": "(k) => localStorage.getItem(k)",
    "annotOn": "() => { const h=document.getElementById('yanbrick-immersive-host'); const r=h&&h.shadowRoot; const c=r&&r.querySelector('.im-card'); return !!(c&&c.classList.contains('annot-on')); }",
    "annotBox": """() => { const h=document.getElementById('yanbrick-immersive-host');
        const c=h&&h.shadowRoot&&h.shadowRoot.querySelector('.im-annot'); if(!c) return null;
        const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }""",
    "annotInk": """() => { const h=document.getElementById('yanbrick-immersive-host');
        const c=h&&h.shadowRoot&&h.shadowRoot.querySelector('.im-annot'); if(!c) return -1;
        const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0;
        for(let i=3;i<d.length;i+=4){ if(d[i]>0) n++; } return n; }""",
    "stemFmt": """() => { const h=document.getElementById('yanbrick-immersive-host'); const r=h.shadowRoot;
        const e=r.querySelector('.im-stem'); const n=document.querySelector('#pb-pq-101 .pb-stem');
        const cs=getComputedStyle(e); const card=r.querySelector('[data-f="card"]');
        const t=e.innerText||'';
        return {ws:cs.whiteSpace, fs:cs.fontSize, lh:cs.lineHeight,
                nl:(()=>{const NL=String.fromCharCode(10);return (t.split(NL).length-1);})(), nativeNL:(()=>{const NL=String.fromCharCode(10);return ((n?n.textContent:'').split(NL).length-1);})(),
                h:Math.round(e.getBoundingClientRect().height), split:card.classList.contains('split'),
                text:t, nativeText:n?n.textContent:null}; }""",
    "splitInfo": """() => { const h=document.getElementById('yanbrick-immersive-host'); const r=h.shadowRoot;
        const card=r.querySelector('[data-f="card"]');
        const s=r.querySelector('.im-stem').getBoundingClientRect();
        const o=r.querySelector('.im-opts').getBoundingClientRect();
        const c=card.getBoundingClientRect();
        return {split:card.classList.contains('split'), stemRight:Math.round(s.right), optsLeft:Math.round(o.left),
                stemTop:Math.round(s.top), optsTop:Math.round(o.top), stemW:Math.round(s.width),
                optsW:Math.round(o.width), optsBottom:Math.round(o.bottom), cardBottom:Math.round(c.bottom),
                cardH:card.clientHeight, stemH:Math.round(s.height)}; }""",
    "optBox": """i => { const h=document.getElementById('yanbrick-immersive-host');
        const e=h&&h.shadowRoot&&h.shadowRoot.querySelector('.im-opt[data-opt="'+i+'"]'); if(!e) return null;
        const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }""",
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:200]))

    page.route("**/politics/paper/fixture", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    page.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.add_init_script(SCRIPT)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(800)

    t = lambda sel: page.evaluate(JS["text"], sel)
    c = lambda sel: page.evaluate(JS["count"], sel)
    clk = lambda sel: page.evaluate(JS["click"], sel)

    def draw_card(dx=60, dy=60):
        box = page.evaluate(JS["annotBox"])
        if not box or box["w"] < 30:
            return False
        x, y = box["x"] + dx, box["y"] + dy
        page.mouse.move(x, y); page.mouse.down()
        page.mouse.move(x + 140, y + 90, steps=6)
        page.mouse.move(x + 60, y + 150, steps=4)
        page.mouse.up(); page.wait_for_timeout(300)
        return True

    check("脚本挂载 Shadow Host", page.evaluate(JS["host"]))
    stem = t(".im-stem")
    check("一屏只展示第一题", stem and "第一题" in stem and "第二题" not in stem, stem)
    check("题号正确 (1/3)", t('[data-f="qno"]') and "1 / 3" in t('[data-f="qno"]'), t('[data-f="qno"]'))
    check("全站均分来自页面真实值 25/50", "25 / 50" in (t('[data-f="avg"]') or ""), t('[data-f="avg"]'))
    check("进度初始 0/3", (t('[data-f="progress"]') or "").strip() == "0 / 3", t('[data-f="progress"]'))
    qmeta = t('[data-f="qmeta"]') or ""
    check("题型分值显示 单选·1分", "单选" in qmeta and "1 分" in qmeta, qmeta)
    check("第一题不显示交卷按钮", page.evaluate(JS["display"], '[data-a="submit"]') == "none")

    # 键盘单选 A
    page.keyboard.press("a"); page.wait_for_timeout(450)
    check("单选 A 写入原生节点", page.evaluate(JS["nativePicked"], "pb-pq-101")[0] is True)
    check("单选后自动切到第二题", "第二题" in (t(".im-stem") or ""), t(".im-stem"))
    qmeta2 = t('[data-f="qmeta"]') or ""
    check("第二题为多选·2分", "多选" in qmeta2 and "2 分" in qmeta2, qmeta2)

    # 多选连续 A、C
    page.keyboard.press("a"); page.wait_for_timeout(250)
    page.keyboard.press("c"); page.wait_for_timeout(350)
    keys2 = page.evaluate(JS["nativeKeys"], "pb-pq-102")
    check("多选连续选 A+C 写入原生", keys2 == ["A", "C"], keys2)
    check("多选不自动切题", "第二题" in (t(".im-stem") or ""), t(".im-stem"))

    # Enter 切题
    page.keyboard.press("Enter"); page.wait_for_timeout(300)
    check("多选 Enter 后切到第三题", "第三题" in (t(".im-stem") or ""), t(".im-stem"))
    check("最后一题显示交卷按钮", page.evaluate(JS["display"], '[data-a="submit"]') != "none")

    # 答题卡
    clk('[data-a="card"]'); page.wait_for_timeout(200)
    check("答题卡显示全部 3 题", c(".im-cell") == 3, c(".im-cell"))
    check("已作答 2 题标记为 done", c(".im-cell.done") == 2, c(".im-cell.done"))
    clk('[data-jump="0"]'); page.wait_for_timeout(250)
    check("答题卡跳转到第一题", "第一题" in (t(".im-stem") or ""), t(".im-stem"))
    check("跳转后恢复第一题答案 A", c(".im-opt.picked") == 1 and "1949" in (t(".im-opt.picked") or ""), t(".im-opt.picked"))

    # 重按自己已经选过的选项：也要算一次有效作答并自动切题（不能卡在原地）
    page.keyboard.press("A"); page.wait_for_timeout(600)
    check("重按已选项：单选仍自动切到第二题", "第二题" in (t(".im-stem") or ""), t(".im-stem"))
    clk('[data-a="card"]'); page.wait_for_timeout(250)
    clk('[data-jump="0"]'); page.wait_for_timeout(450)
    check("重按已选项后：回到第一题答案仍在", page.evaluate(JS["nativeKeys"], "pb-pq-101") == ["A"],
          page.evaluate(JS["nativeKeys"], "pb-pq-101"))

    # Tab 放行
    before = t(".im-stem")
    page.keyboard.press("Tab"); page.wait_for_timeout(150)
    check("Tab 不触发切题", t(".im-stem") == before)

    # 题干格式：必须与网站原生排版一致（原生 .pb-stem 是 pre-wrap 纯文本，换行即分段）
    fmt = page.evaluate(JS["stemFmt"])
    check("格式：题干 white-space=pre-wrap（同原生）", fmt["ws"] == "pre-wrap", fmt["ws"])
    check("格式：题干字号/行高同原生 15px / 26.25px",
          fmt["fs"] == "15px" and fmt["lh"].startswith("26.2"), f"{fmt['fs']} / {fmt['lh']}")
    check("格式：①②③④ 逐行显示（换行数同原生）", fmt["nl"] == fmt["nativeNL"] > 0,
          f"{fmt['nl']} vs {fmt['nativeNL']}")
    check("格式：题干按多行铺开（没被压成一段）", fmt["h"] >= 5 * 20, fmt["h"])
    check("格式：短题干不分栏", not fmt["split"], fmt["split"])

    # 长题干：自动分栏（一栏题干、一栏选项）
    clk('[data-a="card"]'); page.wait_for_timeout(250)
    clk('[data-jump="2"]'); page.wait_for_timeout(500)
    sp = page.evaluate(JS["splitInfo"])
    check("长题干：自动分栏", sp["split"], sp)
    check("长题干：题干与选项左右并排",
          sp["optsLeft"] > sp["stemRight"] - 1 and abs(sp["stemTop"] - sp["optsTop"]) <= 4, sp)
    check("长题干：选项栏仍在视野内（没被顶下去）",
          sp["optsBottom"] <= sp["cardBottom"] + 1, sp)
    clk('[data-a="card"]'); page.wait_for_timeout(250)
    clk('[data-jump="0"]'); page.wait_for_timeout(500)
    check("回到第一题：分栏撤销", not page.evaluate(JS["splitInfo"])["split"])

    # 草稿纸 = 题面批注：直接盖在题卡上划，且每题独立
    clk('[data-a="annot"]'); page.wait_for_timeout(300)
    check("批注：开关打开", page.evaluate(JS["annotOn"]))
    check("批注：初始无笔迹", page.evaluate(JS["annotInk"]) == 0, page.evaluate(JS["annotInk"]))

    opt_box = page.evaluate(JS["optBox"], 1)
    if opt_box:
        page.mouse.click(opt_box["x"] + opt_box["w"] / 2, opt_box["y"] + opt_box["h"] / 2)
        page.wait_for_timeout(300)
    check("批注开启：点击落在画布上，不改答案",
          page.evaluate(JS["nativeKeys"], "pb-pq-101") == ["A"], page.evaluate(JS["nativeKeys"], "pb-pq-101"))
    clk('[data-a="undo"]'); page.wait_for_timeout(200)
    check("批注：撤销清掉误点的点迹", page.evaluate(JS["annotInk"]) == 0, page.evaluate(JS["annotInk"]))

    check("批注：能在题卡上画出笔迹", draw_card())
    saved = page.evaluate(JS["ls"], "pol:immersive-scratch:fixture:101")
    check("批注：笔迹按题目 id 持久化", saved and '"strokes"' in saved and '"points"' in saved, (saved or "")[:60])
    check("批注：画布上确有笔迹", page.evaluate(JS["annotInk"]) > 0, page.evaluate(JS["annotInk"]))

    page.keyboard.press("ArrowRight"); page.wait_for_timeout(400)
    check("批注：切到第二题笔迹清空（每题独立）", page.evaluate(JS["annotInk"]) == 0, page.evaluate(JS["annotInk"]))
    check("批注：第二题无笔迹存储", page.evaluate(JS["ls"], "pol:immersive-scratch:fixture:102") is None)
    page.keyboard.press("ArrowLeft"); page.wait_for_timeout(400)
    check("批注：切回第一题笔迹恢复", page.evaluate(JS["annotInk"]) > 0, page.evaluate(JS["annotInk"]))
    clk('[data-a="clear"]'); page.wait_for_timeout(200)
    check("批注：清空后画布与存储都不残留",
          page.evaluate(JS["annotInk"]) == 0 and page.evaluate(JS["ls"], "pol:immersive-scratch:fixture:101") is None)

    clk('[data-a="annot"]'); page.wait_for_timeout(250)
    check("批注：关闭后工具条收起", page.evaluate(JS["display"], '[data-f="tools"]') == "none")
    if opt_box:
        page.mouse.click(opt_box["x"] + opt_box["w"] / 2, opt_box["y"] + opt_box["h"] / 2)
        page.wait_for_timeout(500)
    check("批注关闭：点选项恢复作答", page.evaluate(JS["nativeKeys"], "pb-pq-101") == ["B"],
          page.evaluate(JS["nativeKeys"], "pb-pq-101"))
    page.keyboard.press("ArrowLeft"); page.wait_for_timeout(400)  # 单选点击后自动切题，回第一题
    # 交卷
    clk('[data-a="submit"]'); page.wait_for_timeout(200)
    check("交卷前显示确认面板", "交卷确认" in (t(".im-panel-box h3") or ""), t(".im-panel-box h3"))
    clk('[data-a="reallySubmit"]'); page.wait_for_timeout(250)
    sub1 = page.evaluate("window.__submitted||0")
    check("确认交卷驱动原生按钮一次", sub1 == 1, sub1)

    # 刷新恢复
    page.reload(wait_until="domcontentloaded"); page.wait_for_timeout(800)
    stem6 = t(".im-stem") or ""
    check("刷新后恢复到有效题目", any(x in stem6 for x in ["第一题", "第二题", "第三题"]), stem6)
    timer = t('[data-f="timer"]') or ""
    check("刷新后计时器运行", ":" in timer, timer)

    browser.close()

passed = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f"\n=== L2 集成测试: {passed}/{total} PASS ===")
sys.exit(0 if passed == total else 1)

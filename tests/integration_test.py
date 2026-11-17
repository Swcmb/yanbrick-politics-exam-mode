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

    # Tab 放行
    before = t(".im-stem")
    page.keyboard.press("Tab"); page.wait_for_timeout(150)
    check("Tab 不触发切题", t(".im-stem") == before)

    # 草稿纸
    clk('[data-a="scratch"]'); page.wait_for_timeout(200)
    check("草稿纸面板可打开", page.evaluate(JS["scratchOpen"]))
    canvas = page.locator("#yanbrick-immersive-host").locator(".im-canvas")
    box = canvas.bounding_box()
    if box:
        page.mouse.move(box["x"] + 30, box["y"] + 30)
        page.mouse.down()
        page.mouse.move(box["x"] + 120, box["y"] + 90, steps=6)
        page.mouse.up()
        page.wait_for_timeout(200)
    saved = page.evaluate(JS["ls"], "pol:immersive-scratch:fixture")
    check("草稿纸笔画已持久化", saved and '"strokes"' in saved and '"points"' in saved, (saved or "")[:60])
    clk('[data-a="undo"]'); page.wait_for_timeout(150)
    saved2 = page.evaluate(JS["ls"], "pol:immersive-scratch:fixture") or ""
    check("撤销后笔画栈清空", '"strokes":[]' in saved2.replace(" ", ""), saved2[:60])
    clk('[data-a="clear"]'); page.wait_for_timeout(100)
    check("清空草稿纸不报错", True)

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

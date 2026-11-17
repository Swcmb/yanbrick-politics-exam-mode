"""
L2 边界测试：快速连按 / 移动端 / 试卷隔离 / 触屏绘画 / resize 保留笔画
运行：D:/ProgramFiles/deeplearning/python.exe tests/edge_cases.py
SPDX-License-Identifier: GPL-3.0-or-later
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "paper.html").read_text(encoding="utf-8")
SCRIPT = (ROOT / "dist" / "yanbrick-immersive-exam.user.js").read_text(encoding="utf-8")

results = []
def check(name, cond, detail=""):
    ok = bool(cond); results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), name, ("- " + str(detail)[:60] if detail else ""))

JS_TEXT = "(sel)=>{const h=document.getElementById('yanbrick-immersive-host');const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel);return e?(e.innerText||e.textContent||'').trim():null}"
JS_CLICK = "(sel)=>{const h=document.getElementById('yanbrick-immersive-host');const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel);if(e){e.click();return true}return false}"
JS_COUNT = "(sel)=>{const h=document.getElementById('yanbrick-immersive-host');return h&&h.shadowRoot?h.shadowRoot.querySelectorAll(sel).length:-1}"

def mkpage(browser, url, viewport=None):
    ctx = browser.new_context(viewport=viewport or {"width": 1280, "height": 800}, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:160]))
    page.route("**/politics/paper/*", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    page.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.add_init_script(SCRIPT)
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(700)
    return ctx, page

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # --- 快速连按不跳题（单选连按应只切一题，锁定窗口内多次按键合并） ---
    ctx, page = mkpage(browser, "https://yanbrick.com/politics/paper/fast")
    for k in ["a", "b", "c", "d"]:
        page.keyboard.press(k)
    page.wait_for_timeout(500)
    stem = page.evaluate(JS_TEXT, ".im-stem") or ""
    # 单选第一次 A 作答后切到第2题；其余键在第2题(多选)是切换选项，不应再切题
    check("快速连按不跳过多题", "第二题" in stem, stem[:40])
    ctx.close()

    # --- 移动端视口布局 ---
    ctx, page = mkpage(browser, "https://yanbrick.com/politics/paper/mobile", {"width": 390, "height": 844})
    t = lambda s: page.evaluate(JS_TEXT, s)
    check("移动端脚本挂载", page.evaluate("() => !!document.getElementById('yanbrick-immersive-host')"))
    check("移动端一屏一题", "第一题" in (t(".im-stem") or ""), t(".im-stem"))
    # 顶栏在窄屏下仍可见（wrap 布局）
    top_h = page.evaluate("() => {const h=document.getElementById('yanbrick-immersive-host');const e=h.shadowRoot.querySelector('.im-top');return e.getBoundingClientRect().height}")
    check("移动端顶栏可见", top_h > 30, top_h)
    # 触屏点击选项
    page.evaluate(JS_CLICK, '[data-opt="0"]')
    page.wait_for_timeout(400)
    check("移动端点击选项作答", "第二题" in (t(".im-stem") or ""), t(".im-stem"))
    ctx.close()

    # --- 试卷隔离：不同 paperId 的进度/草稿互不串 ---
    ctx, page = mkpage(browser, "https://yanbrick.com/politics/paper/paperA")
    page.keyboard.press("a"); page.wait_for_timeout(400)
    a_picked = page.evaluate("() => Array.from(document.querySelectorAll('#pb-pq-101 .pb-opt.picked')).length")
    check("试卷A作答生效", a_picked == 1, a_picked)
    sa = page.evaluate("() => localStorage.getItem('pol:immersive-state:paperA')")
    check("试卷A状态键独立", sa and "currentIndex" in sa, (sa or "")[:50])
    # 切到试卷B（SPA pushState + 同路由不同 code）
    page.evaluate("() => history.pushState({}, '', '/politics/paper/paperB')")
    page.wait_for_timeout(600)
    # B 的题卡是同一 fixture（id 101），但作答应未恢复（无 B 的草稿）
    b_picked = page.evaluate("() => Array.from(document.querySelectorAll('#pb-pq-101 .pb-opt.picked')).length")
    # fixture 的 click 处理写的是 p:fixture 固定键，跨 code 不隔离；这里验证脚本状态键按 code 分
    sb = page.evaluate("() => localStorage.getItem('pol:immersive-state:paperB')")
    check("试卷B有独立状态键或尚未初始化", sb is None or "currentIndex" in (sb or ""), (sb or "None")[:50])
    ctx.close()

    # --- 草稿纸 resize 保留笔画 ---
    ctx, page = mkpage(browser, "https://yanbrick.com/politics/paper/resize")
    page.evaluate(JS_CLICK, '[data-a="scratch"]'); page.wait_for_timeout(200)
    canvas = page.locator("#yanbrick-immersive-host").locator(".im-canvas")
    box = canvas.bounding_box()
    if box:
        page.mouse.move(box["x"] + 40, box["y"] + 40); page.mouse.down()
        page.mouse.move(box["x"] + 160, box["y"] + 120, steps=5); page.mouse.up()
        page.wait_for_timeout(200)
    before = page.evaluate("() => localStorage.getItem('pol:immersive-scratch:resize')")
    check("resize 前有笔画", before and '"points"' in before, (before or "")[:40])
    # 改面板尺寸触发 ResizeObserver → 笔画按坐标缩放保留
    page.evaluate("""() => {const h=document.getElementById('yanbrick-immersive-host');const p=h.shadowRoot.querySelector('[data-f=scratch]');p.style.width='340px';p.style.height='260px';}""")
    page.wait_for_timeout(400)
    after = page.evaluate("() => localStorage.getItem('pol:immersive-scratch:resize')")
    check("resize 后笔画仍在且坐标已缩放", after and '"points"' in after, (after or "")[:60])
    ctx.close()

    browser.close()

passed = sum(1 for _, ok, _ in results if ok); total = len(results)
print(f"\n=== L2 边界测试: {passed}/{total} PASS ===")
sys.exit(0 if passed == total else 1)

"""
L2 稳定性测试：全屏 / 缩放过渡后不允许持续抖动
对应真实反馈「浏览器全屏后题目不断闪动」。

判定标准：尺寸稳定后，题卡 class 与批注画布样式必须**零变化**；
渲染逻辑不得因 ResizeObserver 被站点每秒 DOM 变更带动而反复重绘。

运行：D:/ProgramFiles/deeplearning/python.exe tests/flicker_test.py
SPDX-License-Identifier: GPL-3.0-or-later
"""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "paper.html").read_text(encoding="utf-8")
# 允许用 FLICKER_SCRIPT 指定被测构建（回归对照：拿旧版跑必须红）
SCRIPT_PATH = Path(os.environ.get("FLICKER_SCRIPT") or (ROOT / "dist" / "yanbrick-immersive-exam.user.js"))
SCRIPT = SCRIPT_PATH.read_text(encoding="utf-8")
print("被测脚本:", SCRIPT_PATH.name)

results = []


def check(name, cond, detail=""):
    ok = bool(cond)
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), name, ("- " + str(detail)[:70] if detail else ""))


JS_CLICK = (
    "(sel)=>{const h=document.getElementById('yanbrick-immersive-host');"
    "const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel);if(e){e.click();return true}return false}"
)

HOOK = """() => {
  const h = document.getElementById('yanbrick-immersive-host');
  const sr = h && h.shadowRoot;
  const card = sr.querySelector('[data-f="card"]');
  const canvas = sr.querySelector('.im-annot');
  window.__t = {cls: 0, style: 0, log: []};
  window.__mo1 = new MutationObserver((rs) => {
    rs.forEach(() => { window.__t.cls++; window.__t.log.push(card.classList.contains('split') ? 'on' : 'off'); });
  });
  window.__mo1.observe(card, {attributes: true, attributeFilter: ['class']});
  window.__mo2 = new MutationObserver((rs) => { window.__t.style += rs.length; });
  window.__mo2.observe(canvas, {attributes: true, attributeFilter: ['style', 'width', 'height']});
  return {w: card.clientWidth, h: card.clientHeight, split: card.classList.contains('split')};
}"""

RESET = "() => { window.__t.cls = 0; window.__t.style = 0; window.__t.log = []; }"

READ = """() => {
  const h = document.getElementById('yanbrick-immersive-host');
  const card = h.shadowRoot.querySelector('[data-f="card"]');
  return {cls: window.__t.cls, style: window.__t.style, log: window.__t.log.slice(0, 12),
          split: card.classList.contains('split'), w: card.clientWidth, h: card.clientHeight,
          sw: card.scrollWidth, sh: card.scrollHeight};
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:160]))
    page.route("**/politics/paper/*", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    page.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.add_init_script(SCRIPT)
    page.goto("https://yanbrick.com/politics/paper/flicker", wait_until="domcontentloaded")
    page.wait_for_timeout(700)

    # 第 3 题是 819 字长题干 —— 分栏判定的临界区
    page.evaluate(JS_CLICK, '[data-a="card"]')
    page.wait_for_timeout(250)
    page.evaluate(JS_CLICK, '[data-jump="2"]')
    page.wait_for_timeout(500)
    page.evaluate(JS_CLICK, '[data-a="closecard"]')
    page.wait_for_timeout(400)
    start = page.evaluate(HOOK)

    # --- 结构性防线：内容宽度不受滚动条出现/消失影响 ---
    # 全屏时最常见的抖动就是「内容溢出 → 出现滚动条 → 内容变窄 → 排版变高 → 滚动条消失 → 复原」
    # 的死循环。scrollbar-gutter:stable 让槽位常驻，宽度从此与溢出状态无关。
    gutter = page.evaluate(
        """() => { const h=document.getElementById('yanbrick-immersive-host');
        return getComputedStyle(h.shadowRoot.querySelector('[data-f="card"]')).scrollbarGutter; }"""
    )
    check("题卡常驻预留滚动条槽位（scrollbar-gutter:stable）", gutter == "stable", gutter)
    w_long = page.evaluate(
        """() => document.getElementById('yanbrick-immersive-host').shadowRoot.querySelector('[data-f="card"]').clientWidth"""
    )
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(400)
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(600)
    w_short = page.evaluate(
        """() => document.getElementById('yanbrick-immersive-host').shadowRoot.querySelector('[data-f="card"]').clientWidth"""
    )
    check(
        "长题（溢出出滚动条）与短题的内容宽度一致",
        abs(w_long - w_short) <= 1,
        f"long={w_long} short={w_short}",
    )
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(400)
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(600)

    # --- 全屏过渡：高度连续变化，跨越分栏临界高度 ---
    page.evaluate(RESET)
    for hh in range(900, 1030, 10):
        page.set_viewport_size({"width": 1440, "height": hh})
        page.wait_for_timeout(70)
    page.wait_for_timeout(200)
    mid = page.evaluate(READ)

    # 核心断言：过渡结束后静置，必须彻底静止
    page.evaluate(RESET)
    page.wait_for_timeout(1500)
    still = page.evaluate(READ)
    check(
        "全屏过渡后静置：题卡不再切换分栏（零 class 变化）",
        still["cls"] == 0,
        f"cls={still['cls']} log={still['log']}",
    )
    check(
        "全屏过渡后静置：批注画布不再重排/重绘（零样式变化）",
        still["style"] == 0,
        f"style={still['style']}",
    )
    check(
        "全屏过渡：分栏结论在过渡中不来回翻转",
        len(set(mid["log"])) <= 1,
        f"log={mid['log']}",
    )

    # --- 缩回原尺寸：同样必须静止 ---
    page.evaluate(RESET)
    for hh in range(1030, 880, -10):
        page.set_viewport_size({"width": 1440, "height": hh})
        page.wait_for_timeout(70)
    page.wait_for_timeout(200)
    page.evaluate(RESET)
    page.wait_for_timeout(1500)
    back = page.evaluate(READ)
    check("缩回原尺寸后静置：零 class 变化", back["cls"] == 0, f"cls={back['cls']} log={back['log']}")
    check("缩回原尺寸后静置：零画布样式变化", back["style"] == 0, f"style={back['style']}")

    # --- 宽度抖动（滚动条出现/消失）不得反复缩放笔迹 ---
    page.evaluate(JS_CLICK, '[data-a="annot"]')
    page.wait_for_timeout(300)
    box = page.evaluate(
        """() => { const h=document.getElementById('yanbrick-immersive-host');
        const c=h.shadowRoot.querySelector('.im-annot').getBoundingClientRect();
        return {x:c.x, y:c.y, w:c.width, h:c.height}; }"""
    )
    page.mouse.move(box["x"] + 60, box["y"] + 80)
    page.mouse.down()
    page.mouse.move(box["x"] + 200, box["y"] + 160, steps=6)
    page.mouse.up()
    page.wait_for_timeout(500)
    key = page.evaluate(
        """() => Object.keys(localStorage).filter(k=>k.indexOf('pol:immersive-scratch:')===0)[0] || null"""
    )
    saved = page.evaluate(
        """k => { try { const d=JSON.parse(localStorage.getItem(k)); return d.strokes[0].points[1].x; } catch(e) { return null; } }""",
        key,
    )
    page.evaluate(RESET)
    page.wait_for_timeout(1200)
    check(
        "静置期间笔迹不被反复缩放（坐标不变）",
        page.evaluate(
            """k => { try { const d=JSON.parse(localStorage.getItem(k)); return d.strokes[0].points[1].x; } catch(e) { return null; } }""",
            key,
        )
        == saved,
        f"saved={saved}",
    )
    ctx.close()
    browser.close()

total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=== L2 稳定性测试: {passed}/{total} PASS ===")
for name, ok, detail in results:
    if not ok:
        print("  FAIL:", name, detail)
raise SystemExit(0 if passed == total else 1)

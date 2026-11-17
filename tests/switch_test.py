"""
L2 回归测试：模式开关 + 退出后不再自动挂载 + 页面滚动锁
运行：D:/ProgramFiles/deeplearning/python.exe tests/switch_test.py
SPDX-License-Identifier: GPL-3.0-or-later
"""
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
    print(("PASS" if ok else "FAIL"), name, ("- " + str(detail)[:80] if detail else ""))


JS = {
    "host": "() => !!document.getElementById('yanbrick-immersive-host')",
    "pill": "() => !!document.getElementById('yanbrick-immersive-pill')",
    "pillText": "() => { const h=document.getElementById('yanbrick-immersive-pill'); const b=h&&h.shadowRoot&&h.shadowRoot.querySelector('button'); return b?b.innerText.trim():null; }",
    "pillClick": "() => { const h=document.getElementById('yanbrick-immersive-pill'); const b=h&&h.shadowRoot&&h.shadowRoot.querySelector('button'); if(b){b.click();return true;} return false; }",
    "exit": "() => { const h=document.getElementById('yanbrick-immersive-host'); const b=h&&h.shadowRoot&&h.shadowRoot.querySelector('[data-a=exit]'); if(b){b.click();return true;} return false; }",
    "qno": "() => { const h=document.getElementById('yanbrick-immersive-host'); const e=h&&h.shadowRoot&&h.shadowRoot.querySelector('[data-f=qno]'); return e?e.textContent.trim():null; }",
    "htmlOverflow": "() => document.documentElement.style.overflow",
    "bodyOverflow": "() => document.body.style.overflow",
    "bodyPadRight": "() => document.body.style.paddingRight",
    "mode": "() => localStorage.getItem('pol:immersive-enabled')",
    "cardScrollbar": "() => { const h=document.getElementById('yanbrick-immersive-host'); const e=h&&h.shadowRoot&&h.shadowRoot.querySelector('.im-card'); if(!e) return null; const cs=getComputedStyle(e); return {overflowY:cs.overflowY, thin:cs.scrollbarWidth||''}; }",
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:200]))

    page.route("**/politics/paper/fixture", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    page.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.add_init_script(SCRIPT)

    def goto():
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_timeout(900)

    def j(key, *args):
        return page.evaluate(JS[key], *args) if args else page.evaluate(JS[key])

    goto()

    # ---------- 基线：默认开启 ----------
    check("默认挂载（开关默认开）", j("host"))
    check("默认开关值为开或未设置", j("mode") in (None, "1"), j("mode"))
    check("挂载时锁住页面滚动", j("htmlOverflow") == "hidden" and j("bodyOverflow") == "hidden",
          f"html='{j('htmlOverflow')}' body='{j('bodyOverflow')}'")
    check("题目卡片自身仍可滚动且为细滚动条",
          (j("cardScrollbar") or {}).get("overflowY") == "auto",
          j("cardScrollbar"))

    # ---------- 退出：持久关闭，且绝不能被重新挂载 ----------
    check("点击退出成功", j("exit"))
    page.wait_for_timeout(400)
    check("退出后覆盖层已移除", not j("host"))
    check("退出后滚动锁已还原",
          j("htmlOverflow") == "" and j("bodyOverflow") == "" and j("bodyPadRight") == "",
          f"html='{j('htmlOverflow')}' pad='{j('bodyPadRight')}'")
    check("退出后写入持久关闭状态", j("mode") == "0", j("mode"))
    check("退出后出现右下角开关入口", j("pill"), j("pillText"))
    check("开关文案表明可重新开启", "开启" in (j("pillText") or ""), j("pillText"))

    # 关键回归：站点自身每秒都在改 DOM，旧实现会在 250~650ms 内重新挂载
    page.wait_for_timeout(2600)
    check("退出 3 秒后仍未被自动重新挂载", not j("host"))
    page.wait_for_timeout(2000)
    check("退出 5 秒后仍未被自动重新挂载", not j("host"))

    # ---------- 刷新：关闭态应保持关闭 ----------
    goto()
    page.wait_for_timeout(1200)
    check("关闭态下刷新页面不会自动挂载", not j("host"))
    check("关闭态刷新后仍保留开关入口", j("pill"), j("pillText"))

    # ---------- 通过开关重新开启 ----------
    check("点击开关入口成功", j("pillClick"))
    page.wait_for_timeout(900)
    check("开启后重新挂载", j("host"), j("qno"))
    check("开启后开关值为开", j("mode") == "1", j("mode"))
    check("开启后开关入口消失", not j("pill"))
    check("开启后重新锁住页面滚动", j("htmlOverflow") == "hidden")
    check("重新开启后题号仍正确", "1 / 3" in (j("qno") or ""), j("qno"))

    # ---------- 再退出一次，确认可反复开关 ----------
    j("exit")
    page.wait_for_timeout(1500)
    check("二次退出后仍不自动挂载", not j("host"))
    check("二次退出后开关入口再次出现", j("pill"))

    check("全流程无页面异常", not errs, errs[:2])

    ctx.close()
    browser.close()

total = len(results)
passed = sum(1 for _, ok, _ in results if ok)
print(f"\n结果：{passed}/{total} PASS")
raise SystemExit(0 if passed == total else 1)

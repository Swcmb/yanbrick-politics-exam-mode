"""
L2 集成测试：挂载生命周期与原生结果态让位（v0.3.6 回归）

覆盖用户反馈「每次要刷新一下才生效」：
1. 打开考试页时要自动挂载（含题卡晚于脚本渲染、宿主节点被站点重渲染移除）；
2. bfcache / 后台标签恢复（pageshow / visibilitychange）后要补挂；
3. 原生直接出现 .pb-score（不经脚本确认交卷）时立即让位，切「作答 / 答案」也不重挂；
4. 换到另一套试卷后要恢复挂载；持久关闭态不能被事件重新挂上。

运行：D:/ProgramFiles/deeplearning/python.exe tests/lifecycle_test.py
SPDX-License-Identifier: GPL-3.0-or-later
"""
import json
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "paper.html").read_text(encoding="utf-8")
SCRIPT = (ROOT / "dist" / "yanbrick-immersive-exam.user.js").read_text(encoding="utf-8")
URL = "https://yanbrick.com/politics/paper/lifecycle"

results = []


def check(name, cond, detail=""):
    ok = bool(cond)
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), name, ("- " + str(detail)[:100] if detail else ""))


HOST = "() => !!document.getElementById('yanbrick-immersive-host')"
REMOVE_HOST = """() => { const h=document.getElementById('yanbrick-immersive-host'); if(h) h.remove(); }"""
SCROLL_UNLOCKED = """() => getComputedStyle(document.documentElement).overflow !== 'hidden'
  && getComputedStyle(document.body).overflow !== 'hidden'"""

# 构造「题卡晚于脚本 1.8 秒才渲染」的页面：从 fixture 里搬走题卡列表，延后再插回。
ol_match = re.search(r"<ol>.*?</ol>", FIXTURE, re.S)
assert ol_match, "fixture 缺少题卡列表"
OL_HTML = ol_match.group(0)
LATE_HTML = FIXTURE.replace(OL_HTML, '<div id="late-slot"></div>')
late_inject = (
    "setTimeout(function(){var s=document.getElementById('late-slot');"
    "if(s){s.outerHTML=" + json.dumps(OL_HTML, ensure_ascii=False) + ";}}, 1800);\n"
)
last_script = LATE_HTML.rfind("</script>")
LATE_HTML = LATE_HTML[:last_script] + late_inject + LATE_HTML[last_script:]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:200]))
    page.route("**/politics/paper/**", lambda r: r.fulfill(
        status=200, content_type="text/html", body=FIXTURE))
    page.route("**/api/politics/**", lambda r: r.fulfill(
        status=200, content_type="application/json", body="{}"))
    page.add_init_script(SCRIPT)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    check("打开考试页：沉浸层自动挂载", page.evaluate(HOST))

    # 站点重渲染把宿主节点摘掉：不能靠刷新，必须在 pageshow 时补挂
    page.evaluate(REMOVE_HOST)
    page.evaluate("() => window.dispatchEvent(new Event('pageshow'))")
    page.wait_for_timeout(450)
    check("宿主被移除后：pageshow 自动补挂", page.evaluate(HOST))

    page.evaluate(REMOVE_HOST)
    page.evaluate("() => document.dispatchEvent(new Event('visibilitychange'))")
    page.wait_for_timeout(450)
    check("宿主被移除后：visibilitychange 自动补挂", page.evaluate(HOST))

    # 原生自己判分出成绩（不经脚本「确认交卷」路径）
    # 重新载入以获得一个干净的已挂载状态，避免上面的负例影响后续断言
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    check("重载后：沉浸层仍在（关闭态未被误写）", page.evaluate(HOST))
    page.evaluate("() => window.__showScore()")
    page.wait_for_timeout(1100)
    check("原生直接出现成绩：覆盖层自动让位", not page.evaluate(HOST))
    check("原生出成绩后：滚动锁已还原", page.evaluate(SCROLL_UNLOCKED))

    # 成绩页切到「作答 / 答案」：.pb-score 被移除，但仍是结果态
    page.evaluate("""() => {
      const s=document.querySelector('.pb-score'); if(s) s.remove();
      document.getElementById('pb-review-slot').innerHTML =
        '<ol><li id="pb-pq-301"><div class="pb-card"><span class="no">✗ 答案 A</span></div></li></ol>';
    }""")
    page.wait_for_timeout(1100)
    check("切到作答/答案视图：不重新挂载", not page.evaluate(HOST))

    # 换到另一套试卷：站点替换掉旧结果 DOM，旧结果 latch 必须失效，恢复挂载
    page.evaluate("() => { document.getElementById('pb-review-slot').innerHTML = ''; }")
    page.evaluate("() => history.pushState({}, '', '/politics/paper/lifecycle-2')")
    page.wait_for_timeout(1100)
    check("换到新试卷后：恢复自动挂载", page.evaluate(HOST))

    ctx.close()

    # 持久关闭态：生命周期事件不能把沉浸层挂回来
    ctx_off = browser.new_context(viewport={"width": 1280, "height": 800})
    off = ctx_off.new_page()
    off.route("**/politics/paper/**", lambda r: r.fulfill(
        status=200, content_type="text/html", body=FIXTURE))
    off.route("**/api/politics/**", lambda r: r.fulfill(
        status=200, content_type="application/json", body="{}"))
    off.add_init_script("try{localStorage.setItem('pol:immersive-enabled','0')}catch(e){}")
    off.add_init_script(SCRIPT)
    off.goto(URL, wait_until="domcontentloaded")
    off.wait_for_timeout(700)
    off.evaluate("() => window.dispatchEvent(new Event('pageshow'))")
    off.wait_for_timeout(600)
    check("关闭态：pageshow 不重新挂载", not off.evaluate(HOST))
    check("关闭态：保留右下角开启入口", off.evaluate(
        "() => !!document.getElementById('yanbrick-immersive-pill')"))
    ctx_off.close()

    # 题卡晚于脚本渲染：不能要求用户刷新
    ctx_late = browser.new_context(viewport={"width": 1280, "height": 800})
    late = ctx_late.new_page()
    late.on("pageerror", lambda e: print("PAGEERROR(late):", str(e)[:200]))
    late.route("**/politics/paper/**", lambda r: r.fulfill(
        status=200, content_type="text/html", body=LATE_HTML))
    late.route("**/api/politics/**", lambda r: r.fulfill(
        status=200, content_type="application/json", body="{}"))
    late.add_init_script(SCRIPT)
    late.goto(URL, wait_until="domcontentloaded")
    late.wait_for_timeout(700)
    check("晚渲染：题卡出现前不误挂", not late.evaluate(HOST))
    late.wait_for_timeout(2400)
    check("晚渲染：题卡出现后自动挂载（无需刷新）", late.evaluate(HOST))
    ctx_late.close()

    browser.close()

passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=== L2 生命周期测试: {passed}/{len(results)} PASS ===")
for name, ok, detail in results:
    if not ok:
        print("  FAIL:", name, detail)
raise SystemExit(0 if passed == len(results) else 1)

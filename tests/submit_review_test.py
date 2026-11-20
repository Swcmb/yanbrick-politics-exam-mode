"""
L2 集成测试：交卷后自动退出展示成绩 + 历次成绩回看默认展开错题解析

运行：D:/ProgramFiles/deeplearning/python.exe tests/submit_review_test.py
SPDX-License-Identifier: GPL-3.0-or-later
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "paper.html").read_text(encoding="utf-8")
SCRIPT = (ROOT / "dist" / "yanbrick-immersive-exam.user.js").read_text(encoding="utf-8")
URL = "https://yanbrick.com/politics/paper/submit-review"

results = []


def check(name, cond, detail=""):
    ok = bool(cond)
    results.append((name, ok, detail))
    print(("PASS" if ok else "FAIL"), name, ("- " + str(detail)[:80] if detail else ""))


CLICK_SHADOW = """sel => { const h=document.getElementById('yanbrick-immersive-host');
  const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); if(e){e.click();return true;} return false; }"""
HOST = "() => !!document.getElementById('yanbrick-immersive-host')"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.on("pageerror", lambda e: print("PAGEERROR:", str(e)[:200]))
    page.route("**/politics/paper/submit-review", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    page.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page.add_init_script(SCRIPT)
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    check("沉浸层已挂载", page.evaluate(HOST))

    # 最后一题才有交卷按钮
    page.evaluate(CLICK_SHADOW, '[data-a="card"]')
    page.wait_for_timeout(200)
    page.evaluate(CLICK_SHADOW, '[data-jump="2"]')
    page.wait_for_timeout(350)
    page.evaluate(CLICK_SHADOW, '[data-a="closecard"]')
    page.wait_for_timeout(250)
    page.evaluate(CLICK_SHADOW, '[data-a="submit"]')
    page.wait_for_timeout(200)
    page.evaluate(CLICK_SHADOW, '[data-a="reallySubmit"]')
    page.wait_for_timeout(350)
    check("确认交卷驱动原生按钮一次", page.evaluate("window.__submitted||0") == 1,
          page.evaluate("window.__submitted||0"))

    # 原生异步判分结束：出现 .pb-score
    page.evaluate("window.__showScore()")
    page.wait_for_timeout(1200)
    check("出成绩后：沉浸层自动卸载", not page.evaluate(HOST))
    check("出成绩后：原生成绩块可见", page.evaluate(
        "() => { const s=document.querySelector('.pb-score'); return !!s && s.getBoundingClientRect().width>0; }"))
    check("出成绩后：页面滚动锁已还原", page.evaluate(
        "() => getComputedStyle(document.documentElement).overflow !== 'hidden' && getComputedStyle(document.body).overflow !== 'hidden'"))

    # 站点每秒 DOM 变更不得把覆盖层重新挂回来
    page.wait_for_timeout(2600)
    check("出成绩 3 秒后：未被重新挂载", not page.evaluate(HOST))

    # 历次成绩 → 看这次：错题解析默认展开，答对的题保持收起
    page.evaluate("() => document.querySelector('#pb-history .pb-redo-btn').click()")
    page.wait_for_timeout(1500)
    review = page.evaluate("""() => ({
      wrongExpanded: !!document.querySelector('#pb-pq-201 .pb-paper-ana'),
      wrongBtn: !!document.querySelector('#pb-pq-201 button.pb-link'),
      rightExpanded: !!document.querySelector('#pb-pq-202 .pb-paper-ana'),
      rightBtn: !!document.querySelector('#pb-pq-202 button.pb-link'),
      host: !!document.getElementById('yanbrick-immersive-host')
    })""")
    check("回看历次成绩：错题解析默认展开", review["wrongExpanded"] and not review["wrongBtn"], review)
    check("回看历次成绩：答对的题解析保持收起", not review["rightExpanded"] and review["rightBtn"], review)
    check("回看历次成绩：不被沉浸层遮挡", not review["host"])

    # 交卷失败兜底：原生按钮不存在时覆盖层要留在原地，用户还能重试
    # 独立 context：避免上一次成功交卷持久化的 submitted 状态让确认按钮变成幂等空操作
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
    page2 = ctx2.new_page()
    page2.route("**/politics/paper/submit-review", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    page2.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    page2.add_init_script(SCRIPT)
    page2.goto(URL, wait_until="domcontentloaded")
    page2.wait_for_timeout(900)
    page2.evaluate("() => { const b=document.querySelector('.pb-submit'); if(b) b.remove(); }")
    page2.evaluate(CLICK_SHADOW, '[data-a="card"]')
    page2.wait_for_timeout(200)
    page2.evaluate(CLICK_SHADOW, '[data-jump="2"]')
    page2.wait_for_timeout(350)
    page2.evaluate(CLICK_SHADOW, '[data-a="closecard"]')
    page2.wait_for_timeout(250)
    page2.evaluate(CLICK_SHADOW, '[data-a="submit"]')
    page2.wait_for_timeout(200)
    page2.evaluate(CLICK_SHADOW, '[data-a="reallySubmit"]')
    page2.wait_for_timeout(500)
    fail_state = page2.evaluate("""() => {
      const h=document.getElementById('yanbrick-immersive-host');
      const q=s=>h&&h.shadowRoot&&h.shadowRoot.querySelector(s);
      return {host:!!h, toast:q('.im-toast')?q('.im-toast').textContent:'',
              panelOpen:q('[data-f="cardpanel"]')?q('[data-f="cardpanel"]').classList.contains('open'):null,
              submitDisplay:q('[data-a="submit"]')?getComputedStyle(q('[data-a="submit"]')).display:null,
              nativeBtn:!!document.querySelector('.pb-submit')};
    }""")
    check("原生交卷按钮缺失：覆盖层保留并提示重试", fail_state["host"] and "未找到原生交卷按钮" in fail_state["toast"], fail_state)

    ctx2.close()
    ctx.close()
    browser.close()

passed = sum(1 for _, ok, _ in results if ok)
print(f"\n=== L2 交卷与回看测试: {passed}/{len(results)} PASS ===")
for name, ok, detail in results:
    if not ok:
        print("  FAIL:", name, detail)
raise SystemExit(0 if passed == len(results) else 1)

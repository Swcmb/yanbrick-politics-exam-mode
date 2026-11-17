#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
L3 真实站点端到端测试（需要登录态）

设计要点：
1. 用持久化 profile 保存登录态（首次运行需人工扫码一次，之后复用）。
2. 注入构建好的油猴脚本到真实页面（Playwright add_init_script，不校验 @match）。
3. 每个断言都与"网站原生 DOM / 原生 localStorage"对账，验证脚本没有自己编数据。
4. 绝不真正交卷：只验证交卷按钮与确认弹窗，然后取消；并监听网络确保没有 POST /submit。

用法:
  python tests/e2e_real.py            # 有登录态直接跑；没有则打开窗口等登录
  python tests/e2e_real.py --fresh    # 忽略已有 profile，重新登录
"""
import json
import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = (ROOT / "dist" / "yanbrick-immersive-exam.user.js").read_text(encoding="utf-8")
PROFILE_DIR = ROOT / ".e2e-browser-profile"
REPORT = ROOT / "project-context" / "research" / "artifacts" / "l3-report.json"

PAPER_URL = "https://yanbrick.com/politics/paper/real-2026"
PRACTICE_URL = "https://yanbrick.com/politics/practice/realsub-%E9%A9%AC%E5%8E%9F"

results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS  " if ok else "FAIL  ") + name + ("   [" + str(detail)[:160] + "]" if detail else ""))
    return ok


# ---------------- Shadow DOM 访问助手（全部走 page.evaluate） ----------------
JS = {
    "mounted": "() => !!document.getElementById('yanbrick-immersive-host')",
    "text": """sel => { const h=document.getElementById('yanbrick-immersive-host');
        const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); return e?e.innerText:null; }""",
    "html": """sel => { const h=document.getElementById('yanbrick-immersive-host');
        const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); return e?e.innerHTML:null; }""",
    "click": """sel => { const h=document.getElementById('yanbrick-immersive-host');
        const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(sel); if(e){e.click();return true;} return false; }""",
    "count": """sel => { const h=document.getElementById('yanbrick-immersive-host');
        return h&&h.shadowRoot?h.shadowRoot.querySelectorAll(sel).length:-1; }""",
    "cls": """arg => { const h=document.getElementById('yanbrick-immersive-host');
        const e=h&&h.shadowRoot&&h.shadowRoot.querySelector(arg.sel); return e?e.classList.contains(arg.c):false; }""",
}


def mounted(page):
    return page.evaluate(JS["mounted"])


def txt(page, sel):
    return page.evaluate(JS["text"], sel)


def click(page, sel):
    return page.evaluate(JS["click"], sel)


def count(page, sel):
    return page.evaluate(JS["count"], sel)


def wait_mounted(page, timeout=15000):
    try:
        page.wait_for_function(
            "() => !!document.getElementById('yanbrick-immersive-host')", timeout=timeout
        )
        return True
    except Exception:
        return False


def native_state(page):
    """读取网站原生的真实状态，作为对账基准。"""
    return page.evaluate(
        """() => {
        const cards = Array.from(document.querySelectorAll('li[id^="pb-pq-"]'));
        const body = document.body.innerText || '';
        const m = body.match(/已作答\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
        return {
            cardCount: cards.length,
            cardIds: cards.map(c => c.id.replace('pb-pq-','')),
            answered: m ? +m[1] : null,
            total: m ? +m[2] : null,
            avgText: (document.querySelector('.pb-ave')||{}).textContent || '',
            hasSubmit: !!document.querySelector('.pb-submit'),
            submitText: (document.querySelector('.pb-submit')||{}).textContent || '',
            pickedCount: document.querySelectorAll('button.pb-opt.picked').length,
            draftKeys: Object.keys(localStorage).filter(k=>k.indexOf('pol:paper-draft')===0)
        };
    }"""
    )


def card_facts(page, idx):
    """第 idx 张原生题卡的真实字段。"""
    return page.evaluate(
        """i => {
        const cards = Array.from(document.querySelectorAll('li[id^="pb-pq-"]'));
        const c = cards[i]; if(!c) return null;
        const opts = Array.from(c.querySelectorAll('button.pb-opt'));
        return {
            id: c.id.replace('pb-pq-',''),
            no: (c.querySelector('.pb-no')||{}).textContent || '',
            type: (c.querySelector('.pb-type')||{}).textContent || '',
            stemLen: ((c.querySelector('.pb-stem')||{}).innerHTML || '').length,
            stemHead: ((c.querySelector('.pb-stem')||{}).innerHTML || '').slice(0,60),
            optionCount: opts.length,
            optionLets: opts.map(o => ((o.querySelector('.pb-opt-let')||o).textContent||'').trim().slice(0,1)),
            headText: (c.querySelector('.pb-card-head')||{}).innerText || ''
        };
    }""",
        idx,
    )


def overlay_facts(page):
    return page.evaluate(
        """() => {
        const h = document.getElementById('yanbrick-immersive-host');
        const r = h && h.shadowRoot; if(!r) return null;
        const q = s => r.querySelector(s);
        return {
            qno: (q('[data-f="qno"]')||{}).textContent||'',
            qmeta: (q('[data-f="qmeta"]')||{}).textContent||'',
            progress: (q('[data-f="progress"]')||{}).textContent||'',
            avg: (q('[data-f="avg"]')||{}).textContent||'',
            stemLen: ((q('.im-stem')||{}).innerHTML||'').length,
            stemHead: ((q('.im-stem')||{}).innerHTML||'').slice(0,60),
            optCount: r.querySelectorAll('.im-opt').length,
            pickedLets: Array.from(r.querySelectorAll('.im-opt.picked .k')).map(e=>e.textContent.trim()),
            submitVisible: !!(q('[data-a="submit"]') && q('[data-a="submit"]').offsetParent !== null)
        };
    }"""
    )


def open_page(ctx, url, page_errors, console_errors):
    page = ctx.new_page()
    page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
    page.on("console", lambda m: console_errors.append(m.text[:200]) if m.type == "error" else None)
    page.add_init_script(SCRIPT)
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    return page


def main():
    fresh = "--fresh" in sys.argv
    if fresh and PROFILE_DIR.exists():
        import shutil

        shutil.rmtree(PROFILE_DIR, ignore_errors=True)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    page_errors, console_errors = [], []

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=("--headed" not in sys.argv),
            viewport={"width": 1440, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.new_page()
        page.goto(PAPER_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3000)

        # -------- 阶段 1：等待登录 --------
        deadline = time.time() + 600
        logged = False
        while time.time() < deadline:
            n = page.evaluate("() => document.querySelectorAll('li[id^=\"pb-pq-\"]').length")
            if n > 0:
                logged = True
                break
            time.sleep(2)
        if not logged:
            print("LOGIN_TIMEOUT 未能检测到登录态（10 分钟内没有出现题卡）")
            ctx.close()
            report(ctx=None, ok=False, note="login timeout")
            return 1
        print("已检测到登录态，开始真实站点测试")
        ctx.storage_state(path=str(ROOT / ".e2e-storage-state.json"))

        # 记录原始草稿，测试结束后还原，避免污染用户的真实作答
        draft_before = page.evaluate(
            "() => Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.indexOf('pol:paper-draft')===0))"
        )

        # -------- 阶段 2：整卷页 E2E --------
        page.close()
        page = open_page(ctx, PAPER_URL, page_errors, console_errors)
        check("整卷页：脚本成功挂载", wait_mounted(page))

        # 脚本会记忆上次停留位置（预期行为）。为了让断言可重复，先清掉位置记忆回到第 1 题。
        page.evaluate(
            "() => Object.keys(localStorage).filter(k=>k.indexOf('pol:immersive-state:')===0).forEach(k=>localStorage.removeItem(k))"
        )
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        ov_first = overlay_facts(page)
        check(
            "整卷页：清除位置记忆后从第 1 题开始",
            ov_first is not None and ov_first["qno"].replace(" ", "").startswith("第1/"),
            f"qno='{ov_first and ov_first['qno']}'",
        )
        nat = native_state(page)
        ov = overlay_facts(page)
        print("  native:", {k: nat[k] for k in ("cardCount", "answered", "total", "avgText", "submitText")})
        print("  overlay:", ov and {k: ov[k] for k in ("qno", "qmeta", "progress", "avg", "optCount")})

        check(
            "整卷页：题目总数与原生题卡数一致",
            ov and nat["cardCount"] > 0 and f"/ {nat['cardCount']} 题" in ov["qno"],
            f"native {nat['cardCount']} vs overlay '{ov and ov['qno']}'",
        )
        check(
            "整卷页：已作答计数与原生一致",
            ov and ov["progress"].replace(" ", "") == f"{nat['answered']}/{nat['total']}",
            f"native {nat['answered']}/{nat['total']} vs overlay '{ov and ov['progress']}'",
        )
        nat_avg = ""
        import re as _re

        _m = _re.search(r"(\d+)\s*/\s*(\d+)", nat["avgText"])
        if _m:
            nat_avg = f"{_m.group(1)}/{_m.group(2)}"
        check(
            "整卷页：全站均分与原生一致（不伪造）",
            bool(nat_avg) and ov is not None and ov["avg"].replace(" ", "") == nat_avg,
            f"native '{nat['avgText'].strip()}' -> {nat_avg} vs overlay '{ov and ov['avg']}'",
        )

        f0 = card_facts(page, 0)

        def norm(s):
            return (s or "").replace(" ", "").replace("·", "").replace("\n", "")

        type_ok = (
            f0 is not None
            and ov is not None
            and ("多选" in norm(f0["type"])) == ("多选" in norm(ov["qmeta"]))
            and ("多选" in norm(ov["qmeta"])) == ("多选" in norm(ov["qmeta"]))
        )
        score_nat = _re.search(r"(\d+)\s*分", f0["type"]) if f0 else None
        score_ov = _re.search(r"(\d+)\s*分", ov["qmeta"]) if ov else None
        score_ok = (
            score_nat is not None
            and score_ov is not None
            and score_nat.group(1) == score_ov.group(1)
        )
        check(
            "整卷页：第1题题型/分值/题号解析正确",
            type_ok and score_ok and f0["no"] in ov["qno"],
            f"native type='{f0 and f0['type']}' no='{f0 and f0['no']}' vs overlay qmeta='{ov and ov['qmeta']}' qno='{ov and ov['qno']}'",
        )
        check(
            "整卷页：题干 HTML 与原生一致（富文本不丢失）",
            ov and f0 and abs(ov["stemLen"] - f0["stemLen"]) <= 2 and ov["stemHead"][:30] == f0["stemHead"][:30],
            f"native len={f0 and f0['stemLen']} head='{(f0 or {}).get('stemHead','')[:30]}' vs overlay len={ov and ov['stemLen']}",
        )
        check(
            "整卷页：选项数量与原生一致",
            ov and f0 and ov["optCount"] == f0["optionCount"],
            f"native {f0 and f0['optionCount']} vs overlay {ov and ov['optCount']}",
        )

        # 键盘答题 -> 验证写回原生 DOM
        page.keyboard.press("b")
        page.wait_for_timeout(900)
        nat2 = native_state(page)
        ov2 = overlay_facts(page)
        check(
            "键盘答题：按键 B 成功写入网站原生选项（.pb-opt.picked）",
            nat2["pickedCount"] >= 1,
            f"native picked={nat2['pickedCount']}",
        )
        check(
            "键盘答题：单选答完自动切到第 2 题",
            ov2 is not None and ov2["qno"].replace(" ", "").startswith("第2/"),
            f"overlay qno='{ov2 and ov2['qno']}'",
        )
        check(
            "键盘答题：已作答计数随原生增长",
            ov2 and ov2["progress"].replace(" ", "") == f"{nat2['answered']}/{nat2['total']}",
            f"native {nat2['answered']}/{nat2['total']} vs overlay '{ov2 and ov2['progress']}'",
        )

        # 答题卡
        click(page, '[data-a="card"]')
        page.wait_for_timeout(350)
        cells = count(page, ".im-cell")
        check("答题卡：格子数量等于总题数", cells == nat["cardCount"], f"{cells} vs {nat['cardCount']}")
        click(page, '[data-jump="0"]')
        page.wait_for_timeout(500)
        ov3 = overlay_facts(page)
        check(
            "答题卡跳转：回到第 1 题并恢复已选答案",
            ov3 and ov3["qno"].startswith("第 1") and len(ov3["pickedLets"]) >= 1,
            f"qno='{ov3 and ov3['qno']}' picked={ov3 and ov3['pickedLets']}",
        )

        # 位置记忆：跳到第 10 题后刷新，应回到第 10 题
        click(page, '[data-a="card"]')
        page.wait_for_timeout(300)
        click(page, '[data-jump="9"]')
        page.wait_for_timeout(400)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        ov_resume = overlay_facts(page)
        check(
            "刷新后：恢复到上次停留的第 10 题",
            ov_resume is not None and ov_resume["qno"].replace(" ", "").startswith("第10/"),
            f"qno='{ov_resume and ov_resume['qno']}'",
        )

        # 草稿纸
        click(page, '[data-a="scratch"]')
        page.wait_for_timeout(400)
        box = page.evaluate(
            """() => { const h=document.getElementById('yanbrick-immersive-host');
            const c=h.shadowRoot.querySelector('.im-canvas'); const r=c.getBoundingClientRect();
            return {x:r.x,y:r.y,w:r.width,h:r.height}; }"""
        )
        if box["w"] > 10:
            page.mouse.move(box["x"] + 40, box["y"] + 40)
            page.mouse.down()
            for i in range(1, 8):
                page.mouse.move(box["x"] + 40 + i * 22, box["y"] + 40 + i * 12)
            page.mouse.up()
            page.wait_for_timeout(500)
        strokes = page.evaluate(
            """() => { const k=Object.keys(localStorage).filter(k=>k.indexOf('pol:immersive-scratch:')===0);
            if(!k.length) return 0; try{ return JSON.parse(localStorage.getItem(k[0])).strokes.length }catch(e){ return -1 } }"""
        )
        check("草稿纸：真实鼠标绘制后笔画已持久化", strokes >= 1, f"strokes={strokes}")

        # 刷新：验证恢复（答案 + 草稿纸）
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(3000)
        check("刷新后：脚本重新挂载", wait_mounted(page))
        ov4 = overlay_facts(page)
        strokes2 = page.evaluate(
            """() => { const k=Object.keys(localStorage).filter(k=>k.indexOf('pol:immersive-scratch:')===0);
            if(!k.length) return 0; try{ return JSON.parse(localStorage.getItem(k[0])).strokes.length }catch(e){ return -1 } }"""
        )
        check("刷新后：草稿纸笔画恢复", strokes2 >= 1, f"strokes={strokes2}")

        # 最后一题：交卷按钮可见性
        total = nat["cardCount"]
        click(page, '[data-a="card"]')
        page.wait_for_timeout(300)
        click(page, f'[data-jump="{total-1}"]')
        page.wait_for_timeout(500)
        ov_last = overlay_facts(page)
        check("最后一题：出现交卷按钮", ov_last and ov_last["submitVisible"], f"visible={ov_last and ov_last['submitVisible']}")
        check(
            "最后一题：题号正确",
            ov_last and f"第 {total} / {total}" in ov_last["qno"],
            f"qno='{ov_last and ov_last['qno']}' expect 第 {total} / {total}",
        )

        # 中间题不应有交卷按钮
        click(page, '[data-a="card"]')
        page.wait_for_timeout(300)
        click(page, '[data-jump="0"]')
        page.wait_for_timeout(400)
        ov_mid = overlay_facts(page)
        check("中间题：不显示交卷按钮", ov_mid and not ov_mid["submitVisible"], f"visible={ov_mid and ov_mid['submitVisible']}")

        # ---- 交卷确认弹窗：只验证存在，绝不提交 ----
        submitted = {"hit": False}
        page.on(
            "request",
            lambda r: submitted.update(hit=True)
            if "/submit" in r.url and r.method == "POST"
            else None,
        )
        page.evaluate(
            """() => { window.__confirmSeen = null;
            const _c = window.confirm; window.confirm = function(m){ window.__confirmSeen = m; return false; };
            }"""
        )
        click(page, '[data-a="card"]')
        page.wait_for_timeout(300)
        click(page, f'[data-jump="{total-1}"]')
        page.wait_for_timeout(400)
        click(page, '[data-a="submit"]')
        page.wait_for_timeout(600)
        confirm_txt = txt(page, '[data-f="cardpanel"] .im-panel-box')
        has_cancel = page.evaluate(
            """() => { const h=document.getElementById('yanbrick-immersive-host');
            return !!(h.shadowRoot.querySelector('[data-a="cancelSubmit"]')); }"""
        )
        check(
            "交卷：弹出确认界面并展示已作答/未作答统计",
            bool(confirm_txt) and "已作答" in confirm_txt and "未作答" in confirm_txt and has_cancel,
            (confirm_txt or "").replace("\n", " ")[:110],
        )
        # 取消（绝不真正交卷）
        click(page, '[data-a="cancelSubmit"]')
        page.wait_for_timeout(400)
        still_open = page.evaluate(
            """() => { const h=document.getElementById('yanbrick-immersive-host');
            const p=h.shadowRoot.querySelector('[data-f="cardpanel"]'); return p.classList.contains('open'); }"""
        )
        check("交卷：取消后确认框关闭", not still_open, f"open={still_open}")
        check("交卷：取消后没有发出 POST /submit 请求", not submitted["hit"], f"hit={submitted['hit']}")

        # ---- 移动端布局 ----
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(600)
        mob = page.evaluate(
            """() => { const h=document.getElementById('yanbrick-immersive-host');
            const app=h.shadowRoot.querySelector('.im-app'); const r=app.getBoundingClientRect();
            const opt=h.shadowRoot.querySelector('.im-opt');
            return {w:r.width, overlayW:window.innerWidth, optW: opt?opt.getBoundingClientRect().width:0,
                    scrollW: app.scrollWidth}; }"""
        )
        check(
            "移动端：覆盖层铺满且无横向溢出",
            mob["w"] == mob["overlayW"] and mob["scrollW"] <= mob["overlayW"] + 2,
            mob,
        )
        page.set_viewport_size({"width": 1440, "height": 900})
        page.close()

        # -------- 阶段 3：其他答题界面 --------
        pr = open_page(ctx, PRACTICE_URL, page_errors, console_errors)
        pr_mounted = wait_mounted(pr)
        pr_ov = overlay_facts(pr)
        pr_meta = pr.evaluate(
            """() => {
            const cells=[...document.querySelectorAll('.pb-cell')];
            const m=(document.body.innerText||'').match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*题/);
            return {cells:cells.length, cur:cells.findIndex(c=>c.classList.contains('cur')),
                    curText:m?+m[1]:null, totalText:m?+m[2]:null};
        }"""
        )
        check("按科目练习页：脚本挂载并识别界面", pr_mounted and pr_ov is not None, pr_meta)
        check(
            "按科目练习页：总题数取原生答题卡格数（不误判为 1 题）",
            pr_ov is not None and str(pr_meta["cells"]) in pr_ov["qno"] and pr_meta["cells"] > 1,
            f"cells={pr_meta['cells']} overlay='{pr_ov and pr_ov['qno']}'",
        )
        check(
            "按科目练习页：当前位置与原生答题卡 .cur 一致",
            pr_ov is not None and pr_meta["cur"] >= 0 and pr_ov["qno"].replace(" ", "").startswith(f"第{pr_meta['cur']+1}/"),
            f"cur={pr_meta['cur']} overlay='{pr_ov and pr_ov['qno']}'",
        )
        if pr_ov:
            check(
                "按科目练习页：题干与选项正常渲染",
                pr_ov["stemLen"] > 0 and pr_ov["optCount"] > 0,
                f"stemLen={pr_ov['stemLen']} optCount={pr_ov['optCount']}",
            )

        # 按键翻页：必须只前进一题（真实站点原生也有方向键，容易双跳）
        cur_before = pr_meta["cur"]
        pr.keyboard.press("ArrowRight")
        pr.wait_for_timeout(1200)
        pr_cur = pr.evaluate(
            "() => [...document.querySelectorAll('.pb-cell')].findIndex(c=>c.classList.contains('cur'))"
        )
        pr_ov2 = overlay_facts(pr)
        check(
            "按科目练习页：按一次 → 只前进一题（不与原生快捷键双跳）",
            pr_cur == cur_before + 1,
            f"native cur {cur_before} -> {pr_cur}",
        )
        check(
            "按科目练习页：翻页后覆盖层题号同步",
            pr_ov2 is not None and pr_ov2["qno"].replace(" ", "").startswith(f"第{pr_cur+1}/"),
            f"cur={pr_cur} overlay='{pr_ov2 and pr_ov2['qno']}'",
        )

        # 答题卡跳转：驱动原生 .cur
        click(pr, '[data-a="card"]')
        pr.wait_for_timeout(400)
        pr_cells = count(pr, ".im-cell")
        click(pr, '[data-jump="9"]')
        pr.wait_for_timeout(1200)
        pr_cur9 = pr.evaluate(
            "() => [...document.querySelectorAll('.pb-cell')].findIndex(c=>c.classList.contains('cur'))"
        )
        check("按科目练习页：答题卡格子数等于总题数", pr_cells == pr_meta["cells"], f"{pr_cells} vs {pr_meta['cells']}")
        check("按科目练习页：答题卡跳转驱动原生切到第 10 题", pr_cur9 == 9, f"native cur={pr_cur9}")

        # 选项写回（只选不提交，不产生真实判分）
        pr.evaluate(
            """() => { const h=document.getElementById('yanbrick-immersive-host');
            const o=h.shadowRoot.querySelectorAll('.im-opt')[1]; if(o) o.click(); }"""
        )
        pr.wait_for_timeout(900)
        pr_picked = pr.evaluate("() => document.querySelectorAll('.pb-card button.pb-opt.picked').length")
        check("按科目练习页：选项写回网站原生选中态", pr_picked >= 1, f"native picked={pr_picked}")
        pr.close()

        # 错题页 / 习题册页（若存在）
        for name, url in [
            ("习题册列表页", "https://yanbrick.com/politics/books"),
            ("模拟题页", "https://yanbrick.com/politics/mocks"),
        ]:
            try:
                pg = open_page(ctx, url, page_errors, console_errors)
                pg.wait_for_timeout(1200)
                has_cards = pg.evaluate("() => document.querySelectorAll('li[id^=\"pb-pq-\"]').length")
                m = mounted(pg)
                # 列表页无题卡时脚本不应挂载（避免污染列表页）
                check(f"{name}：无题卡时不误挂载", (not m) if has_cards == 0 else m, f"cards={has_cards} mounted={m}")
                pg.close()
            except Exception as e:
                check(f"{name}：访问失败", False, str(e)[:120])

        # -------- 阶段 4：清理，避免污染用户真实作答 --------
        restored = ctx.new_page()
        restored.add_init_script(SCRIPT)
        restored.goto(PAPER_URL, wait_until="domcontentloaded", timeout=60000)
        restored.wait_for_timeout(2500)
        restored.evaluate(
            """(before) => {
            Object.keys(localStorage).filter(k=>k.indexOf('pol:paper-draft')===0).forEach(k=>localStorage.removeItem(k));
            Object.entries(before).forEach(([k,v])=>localStorage.setItem(k,v));
        }""",
            draft_before,
        )
        restored.close()

        check("脚本运行期间无未捕获异常", len(page_errors) == 0, "; ".join(page_errors[:2]))
        ctx.close()

    ok = all(r["ok"] for r in results) and len(results) > 0
    report(ctx=None, ok=ok)
    return 0 if ok else 2


def report(ctx, ok, note=""):
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    passed = sum(1 for r in results if r["ok"])
    data = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "url": PAPER_URL,
        "ok": ok,
        "note": note,
        "passed": passed,
        "total": len(results),
        "checks": results,
    }
    REPORT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n=== L3 真实站点：{passed}/{len(results)} 通过 → {REPORT} ===")


if __name__ == "__main__":
    sys.exit(main())

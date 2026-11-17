#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成验收截图（存到 project-context/research/artifacts/，随仓库一起提交）。"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "project-context" / "research" / "artifacts"
SCRIPT = (ROOT / "dist" / "yanbrick-immersive-exam.user.js").read_text(encoding="utf-8")
PROFILE_DIR = ROOT / ".e2e-browser-profile"
URL = "https://yanbrick.com/politics/paper/real-2026"
FIXTURE = (ROOT / "tests" / "fixtures" / "paper.html").read_text(encoding="utf-8")

CLOSE_PANEL = """() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
    const p=r.querySelector('[data-f="cardpanel"]'); const b=r.querySelector('[data-a="closecard"]');
    if(p && p.classList.contains('open') && b) b.click(); }"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ① 真实站点第 1 题：多行题干（①②③④ 各占一行）
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900}, storage_state=str(ROOT / ".e2e-storage-state.json")
    )
    page = ctx.new_page()
    page.add_init_script(SCRIPT)
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4500)
    page.evaluate("""() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
        if(r.querySelector('.im-card').classList.contains('annot-on')) r.querySelector('[data-a="annot"]').click(); }""")
    page.evaluate("""() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
        r.querySelector('[data-a="card"]').click(); }""")
    page.wait_for_timeout(400)
    page.evaluate("""() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
        const b=r.querySelector('[data-jump="0"]'); if(b) b.click(); }""")
    page.wait_for_timeout(700)
    page.evaluate(CLOSE_PANEL)
    page.wait_for_timeout(500)
    page.evaluate(CLOSE_PANEL)
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "shot-stem-format.png"))
    print("real qno:", page.evaluate("""() => document.getElementById('yanbrick-immersive-host')
        .shadowRoot.querySelector('[data-f="qno"]').textContent"""))
    ctx.close()

    # ② fixture 819 字长题干：左右分栏
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
    pg = ctx2.new_page()
    pg.route("**/politics/paper/fixture", lambda r: r.fulfill(status=200, content_type="text/html", body=FIXTURE))
    pg.route("**/api/politics/**", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    pg.add_init_script(SCRIPT)
    pg.goto("https://yanbrick.com/politics/paper/fixture", wait_until="domcontentloaded")
    pg.wait_for_timeout(1500)
    pg.evaluate("""() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
        r.querySelector('[data-a="card"]').click(); }""")
    pg.wait_for_timeout(350)
    pg.evaluate("""() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
        const b=r.querySelector('[data-jump="2"]'); if(b) b.click(); }""")
    pg.wait_for_timeout(700)
    pg.evaluate(CLOSE_PANEL)
    pg.wait_for_timeout(500)
    pg.evaluate(CLOSE_PANEL)
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(OUT / "shot-split-layout.png"))
    print("split:", pg.evaluate("""() => { const r=document.getElementById('yanbrick-immersive-host').shadowRoot;
        return r.querySelector('[data-f="card"]').classList.contains('split'); }"""))
    ctx2.close()
    browser.close()

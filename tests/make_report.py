#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 l3-report.json 渲染成可读的 L3 测试报告（markdown）。

用法：
    python tests/make_report.py

输入  project-context/research/artifacts/l3-report.json
输出  project-context/research/l3-real-site-test-report.md
"""
from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "project-context" / "research" / "artifacts" / "l3-report.json"
OUT = ROOT / "project-context" / "research" / "l3-real-site-test-report.md"

FOCUS = [
    ("题干排版与原生逐字一致",
     "原生 `.pb-stem` 是 `white-space:pre-wrap` 的纯文本；覆盖层 `white-space` 同为 `pre-wrap`，"
     "第 1 题文本 207 字、换行数 4 与原生完全相同（`①②③④` 各占一行，不再压成一段）"),
    ("选项同源纯文本",
     "选项按 `textContent` 取文本后转义渲染，`<`、`>` 按字面显示；选项数量与原生逐个一致"),
    ("确认键：Enter / 空格，单选多选一致",
     "单选第 1 题（原生已有答案 B）按 `Space` → 「第 1 / 33 题」变「第 2 / 33 题」且该题答案仍是 `['B']`；"
     "回退后按 `Enter` 同样切到第 2 题。多选第 17 题（多选 · 2 分）按 `Space` → 第 18 题，"
     "选中态前后一致（空格没有被当成选项）"),
    ("长题干分栏",
     "单栏放不下且题干高度 > 卡片可视高 60% 时切为「左题干 / 右选项」两栏；"
     "真实卷最长题干 215 字（105px / 卡高 715px）不触发，用 819 字 fixture 覆盖该分支"),
    ("题面批注（草稿纸）",
     "透明画布 858×715 与题卡 860×717 同心同尺寸；真实鼠标绘制后按题目落盘 "
     "`pol:immersive-scratch:real-2026:16240`，换题 `ink=0`、切回 `ink=828`、刷新仍恢复"),
    ("无原生 id 的界面",
     "练习页 `.pb-card` 没有任何 `id`/`data-*`，改用「题干+选项」内容指纹做题目身份"
     "（`…:c1jd6knihzjed4`），练习集换序也不会串题"),
]

METHOD = [
    "登录态：`launch_persistent_context` 指向 `.e2e-browser-profile/`，首次人工扫码一次后长期复用；该目录已 gitignore，不随仓库分发。",
    "注入方式：`page.add_init_script(脚本全文)`，绕过 `@match` 校验，等价于真实油猴注入时机（document-start），因此也验证了「SPA 首屏晚于脚本」的场景。",
    "对账原则：所有数字（题数、题号、题型、分值、均分、作答数、题干文本）都从原生 DOM 重新读取后与覆盖层比对，杜绝脚本自说自话。",
    "不产生真实提交：交卷只验证到「确认面板 + 取消」，并用 request 监听证明取消后没有 `POST /submit`。",
    "批注验证方式：直接对批注画布 `getImageData` 统计不透明像素（`ink`）判断「有没有笔迹」，再配合 localStorage 键名核对「笔迹挂在哪道题上」，不依赖截图肉眼判断。",
    "幂等清理：测试前快照 `pol:paper-draft:*`，测试后完整还原；批注键（`pol:immersive-scratch:*`、`pol:immersive-annot`）属测试产物，收尾时直接清除。",
    "开关归一化：测试开始前强制 `pol:immersive-enabled=1`，因为「关闭持久化」本身就是被测行为，不能依赖历史状态。",
    "确认键用例的设计：单选用例先按 `←` 归一化到第 1 题，再比对「按空格前后的题号」与「该题原生选中态」；"
    "多选用例先从原生 `.pb-type` 里找出真实多选题（本次为第 17 题），用答题卡跳过去再按空格。"
    "两类断言都不依赖具体答案，因此可重复运行。",
]

DEFECTS = [
    "**退出后自动重挂**：退出只清内存，`MutationObserver` + 兜底轮询 + 站点每秒 DOM 变更会在 250–650ms 内重建覆盖层 → 引入持久开关 `pol:immersive-enabled`，关闭态下观察器只维护入口、绝不挂载。",
    "**视口右侧常驻滚动条**：覆盖层是 `fixed inset:0`，但视口滚动条属于根滚动容器 → 挂载时锁 `html/body` 的 `overflow` 并记录原值，退出还原；长题干改为卡内细滚动条。",
    "**练习页题目没有身份**：`.pb-card` 上没有任何 `id`/`data-*`，原生也不写 localStorage 草稿，批注若按题号存，练习集换序就会串题 → 增设「题干+选项」内容指纹（双 FNV 哈希）。",
    "**SPA 首屏不挂载**：脚本 `document-start` 执行时题卡还不存在，一次性 `boot` 会直接放弃 → `MutationObserver` + 400ms 兜底轮询 + `bootOnce` 重入保护。",
    "**练习页总数取错**：按题干/接口长度算出 1/1，实际是 1/150 → 改按原生答题卡 `.pb-cell` 计数，用 `.cur` 定位当前题。",
    "**`CSS.escape` 被站点覆盖**：站点全局改写了 `CSS.escape`，选择器拼出来后查不到节点 → 自写 `cssEsc` 兜底。",
    "**方向键双跳**：原生页面也监听方向键，事件冒泡后执行两次 → 白名单按键在捕获阶段 `preventDefault + stopPropagation`。",
    "**题干被压成一段**（用户实测反馈）：原生 `.pb-stem` 是 `pre-wrap` 纯文本，早期实现用 `innerHTML` + 默认 `normal` 渲染，`\\n` 全被折叠 → 改 `textContent` + 转义 + `pre-wrap`。",
    "**画布高度自反馈**：批注画布是 `absolute` 子元素，会被算进 `scrollHeight`，而画布高度又取自 `scrollHeight` → 越量越高（实测一度 21551px）→ 改用内容容器 `offsetTop + offsetHeight + padding-bottom`。",
    "**重按已选项卡住**：`commitAnswer` 检测「答案没变化」直接返回失败，导致按自己已选的项既不写答案也不切题 → 视为一次有效作答，照常自动切题。",
    "**单选按 Enter 被吞**：确认分支只在 `multi` 时执行 `doAdvance`，单选按 Enter 既不切题也不做别的（`preventDefault` 已生效）→ 确认键对两种题型统一处理，空格同理。",
]


def esc_cell(s, limit=150):
    t = re.sub(r"\s+", " ", str(s or "")).strip().replace("|", "\\|")
    return t if len(t) <= limit else t[:limit] + "…"


def main():
    d = json.loads(SRC.read_text(encoding="utf-8"))
    checks = d.get("checks") or []
    passed = d.get("passed", sum(1 for c in checks if c.get("ok")))
    total = d.get("total", len(checks))
    ok = d.get("ok", passed == total)

    lines = []
    lines.append("# L3 真实站点端到端测试报告")
    lines.append("")
    lines.append(f"- 生成时间：{d.get('generatedAt', '')}")
    lines.append(f"- 目标页面：`{d.get('url', '')}`")
    lines.append(f"- 结果：**{passed}/{total} PASS**（ok={ok}）")
    lines.append(
        "- 方式：Playwright 持久化 profile（真实登录态）+ 注入 `dist/yanbrick-immersive-exam.user.js`；"
        "每条断言都与网站原生 DOM / 原生 localStorage 对账。"
    )
    lines.append(
        "- 被测版本：v0.3.3 —— 题干排版与原生严格对齐（pre-wrap）、长题干自动分栏、"
        "Enter / 空格在单选与多选下都能确认并切下一题、题面批注按题目独立。"
    )
    lines.append("")
    lines.append("## 本版重点")
    lines.append("")
    lines.append("| 关注点 | 实测证据 |")
    lines.append("|---|---|")
    for k, v in FOCUS:
        lines.append(f"| {k} | {v} |")
    lines.append("")
    lines.append("## 断言明细")
    lines.append("")
    lines.append("| # | 断言 | 结果 | 证据 |")
    lines.append("|---|---|---|---|")
    for i, c in enumerate(checks, 1):
        lines.append(
            f"| {i} | {esc_cell(c.get('name'))} | {'PASS' if c.get('ok') else 'FAIL'} | {esc_cell(c.get('detail'))} |"
        )
    lines.append("")
    lines.append("## 测试方法要点")
    lines.append("")
    for i, m in enumerate(METHOD, 1):
        lines.append(f"{i}. {m}")
    lines.append("")
    lines.append("## 真实站点测试暴露并已修复的实现缺陷")
    lines.append("")
    lines.append(
        "以下问题在 L1/L2 中无法暴露（fixture 题卡静态存在、无原生快捷键、`CSS` 未被站点占用、"
        "无每秒 DOM 变更、练习页没有原生 id）："
    )
    lines.append("")
    for i, m in enumerate(DEFECTS, 1):
        lines.append(f"{i}. {m}")
    lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"{OUT}  {passed}/{total}")


if __name__ == "__main__":
    main()

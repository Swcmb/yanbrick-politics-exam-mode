# DEVNOTES: yanbrick-politics-exam-mode

> Developer notes. Not part of the published documentation.
> Snapshot: 2026-11-17 | branch master | commit HEAD | OS Windows 11 (Git Bash) | Node 22 / Python 3.13 (deeplearning 环境含 Playwright 1.65.1)

## 1. Local setup

- 依赖：Node（构建/单测，零 npm 依赖）；Python + Playwright（集成测试，复用 `D:\ProgramFiles\deeplearning\python.exe`，已装 chromium）。
- 构建：`node build.js` → `dist/yanbrick-immersive-exam.user.js`。
- 单测：`node --test tests/core.test.js`。
- 集成：`D:/ProgramFiles/deeplearning/python.exe tests/integration_test.py` 与 `tests/edge_cases.py`。
- 前置：集成测试用本地 fixture + `page.route` mock API，无需登录态。

## 2. Environment

| 变量 | 用途 | 本地来源 | 是否必需 |
|---|---|---|---|
| 浏览器登录态 | 真实站点刷题 | yanbrick.com 微信扫码 | 仅 L3 真实测试需要 |

## 3. Architecture notes

- 脚本为单文件油猴脚本（`@grant none`，无 CSP 头，注入无障碍）。
- 源码分 4 段，构建按 core → main → ui → boot 顺序拼接（函数声明提升保证引用可见）：
  - `core.js`：纯逻辑，UMD，Node 可 require 单测。
  - `main.js`：工具 + DOM 抽取 + 4 适配器 + 原生写回。
  - `ui.js`：Shadow DOM 模板 + 渲染 + 题面批注层。
  - `boot.js`：答题流程 + 键盘 + 交卷 + 生命周期。
- 题目真值优先从原生题卡 DOM 读（`#pb-pq-${id}`、`.pb-opt.picked`），与原生判分同源，规避组卷会话不一致。API 仅补均分/卷名，且同 code 只读一次。
- 写回：驱动原生 `button.pb-opt.click()`，每次重新 querySelector + isConnected 校验，回读 picked 作成功判据；交卷点 `.pb-submit`。

## 4. Decisions

| 日期 | 决定 | 备选 | 理由 | 复查 |
|---|---|---|---|---|
| 2026-11-17 | 油猴脚本 + 复用原生状态层 | 浏览器扩展 / 独立网页 / 重造状态机 | 最小改动、不改服务端、数据真实 | 已定 |
| 2026-11-17 | 题目以 DOM 为真值、API 补全 | 纯 API 驱动 | 避免组卷会话不一致（审查 R-3） | 已定 |
| 2026-11-17 | 草稿纸独立键 | 复用原生草稿 | 原生草稿形状不含笔画 | 已定 |
| 2026-11-17 | 草稿纸改为**题面批注层**（透明 canvas 盖在题卡上，每题一个键） | 独立浮层面板 / 整套卷共享 | 用户实测反馈：要在界面上直接划、题目之间要独立；独立面板还要拖动缩放，交互成本高 | 已改 v0.3.0 |
| 2026-11-17 | 键盘挂 document 捕获白名单 | 挂 Shadow Root | 焦点常在页面而非 shadow，实测挂载后键盘不响应 | 已修 |

## 5. Experiments and failures

| 日期 | 尝试 | 结果 | 失败原因 | 下一步 |
|---|---|---|---|---|
| 2026-11-17 | 键盘监听挂 Shadow Root | 失败 | 焦点不在 shadow，收不到 document 键盘 | 改挂 document 捕获 + 白名单 |
| 2026-11-17 | 单选作答后自动切题 | 失败（不切） | doAdvance 被 selectOption 的 canAct 时间戳锁拒绝 | 自动切题绕过二次锁 |
| 2026-11-17 | 草稿纸画笔持久化 | 失败 | 测试读错 localStorage key（多了 `paper\|` 前缀）；另 setPointerCapture 在 shadow 抛错 | try/catch capture + document 兜底 pointerup + 修正测试 key |
| 2026-11-17 | add_init_script 注入 | 失败 | document-start 时 body 未就绪 + MAINJS_EOF 残留混入 ui.js | boot 等 DOMContentLoaded + 删残留 |

## 6. Known issues

| 症状 | 可能原因 | 临时处理 | 相关链接 |
|---|---|---|---|
| L3 登录态 | 微信扫码，cookie 库被 WorkBuddy/Edge 常驻进程独占，无法复制 | 用持久化 profile `.e2e-browser-profile/`，首次带窗口扫码一次后无头复用；目录已 gitignore | `tests/e2e_real.py` |
| 随机组卷幂等性 | 服务端行为未完全坐实 | 同 code 只读一次，绝不二次调组卷接口；失败降级 DOM 驱动 | spec §2.7 R-3 |
| 键盘 listener 轻微泄漏 | teardown 未清理 document listener | 用 currentModel 守卫隔离，实例有限可接受 | — |

## 7. TODO

- [x] L3 真实站点端到端已跑通 36/36（登录态、原生交互真生效、均分逐字符一致）。
- [ ] 交卷真成功未验证（会真实记分），仅验证到确认面板 + 取消零提交。
- [ ] 真实含公式题目验证 Shadow DOM 公式样式（预案：cloneNode 保留已渲染节点 / adoptedStyleSheets）。

## 8. Links

- 设计规格：`project-context/specs/2026-11-17-immersive-exam-mode-design.md`
- 审查报告：`project-context/research/spec-review-{1,2,3}.md`
- bundle 证据：`project-context/research/artifacts/`

## 9. Local change log

- 2026-11-17: 初版实现 + 三轮规格审查 + L1/L2 测试全通过。
- 2026-11-17: L3 真实站点 36/36 通过；修复 4 个仅真实环境可暴露的缺陷（SPA 首屏未挂载、练习页总数、`CSS.escape` 被覆盖、方向键双跳）。
- 2026-11-17: v0.2.0 — 新增持久模式开关（`pol:immersive-enabled`）：退出后不再自动重挂，右下角保留开启入口；挂载期间锁定页面滚动、滚动条改为细深色卡内滚动。L2 开关回归 23/23、L3 扩到 50/50。
- 2026-11-17: v0.3.0 — 草稿纸重做为「题面批注」：透明 canvas 直接覆盖题卡（就地划），开关控制 `pointer-events`；笔画按题目 id 独立存储（`pol:immersive-scratch:{paperId}:{qid}`）；坐标锚定题卡内容，随题干滚动；题卡改为 `min-height:100%`，让整块题面都能当草稿区。橡皮改 `destination-out`。

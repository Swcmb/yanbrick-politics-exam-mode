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
| 2026-11-17 | 题干按原生 `pre-wrap` 纯文本渲染（15px/1.75，`esc` 后插入） | `innerHTML` 直插 / 默认 `white-space:normal` | 用户截图反馈①：原版 ①②③④ 各占一行，沉浸模式压成一段。实测原生 `.pb-stem` 无子元素、无 `<br>`、`white-space:pre-wrap`，就是纯文本 + `\n` | 已改 v0.3.1 |
| 2026-11-17 | 长题干自动分栏（左题干 / 右选项） | 单栏一律滚动 | 用户要求②：长题干分栏展示。真实整卷最长题干仅 215 字（105px / 卡高 715px）不触发，用 819 字 fixture 覆盖 | 已改 v0.3.1 |
| 2026-11-17 | 画布高度改用「内容真实高度」而非 `card.scrollHeight` | 继续读 scrollHeight | 画布是 absolute 子元素，会被算进滚动区域 → 越量越高，实测一度撑到 21551px | 已改 v0.3.1 |
| 2026-11-17 | 重按已选项也返回「成功」，照常自动切题 | 无变化直接 return false | L3 实测暴露：第 1 题已有答案 B 时按 B，答案没变但也不切题，用户会以为按键失灵 | 已改 v0.3.1 |
| 2026-11-17 | 空格 = 确认（与 Enter 等价），单选/多选一致 | 只在 Enter 上做确认；v0.3.2 一度让单选下空格放行 | 用户要求③④：先要多选加空格，再要求单选也可以。单选虽按键即切，但「回到某题想往前走」仍需确认键；空格一律拦截（否则会滚动页面/激活按钮），未作答时等同「下一题」 | 已改 v0.3.3 |
| 2026-11-17 | 题卡常驻预留滚动条槽位（`scrollbar-gutter:stable`）；分栏判定只加不减；画布尺寸未变不重绘 | 只在 resize 时重算 / resize 无条件 `clearRect` 重绘 | 用户反馈④：浏览器全屏后题目不断闪动。复现链条：内容刚好溢出 → `.im-card` 出现 thin 滚动条 → 内容宽度 859→849 → 排版变高 → 尺寸变化再触发 `layoutCard` 的 remove→测量→add → `[data-f=body]` 高度又变 → 循环。三处独立加固后实测全屏静置 0 次 class 变化、0 次画布样式变化 | 已改 v0.3.4 |
| 2026-11-17 | 键盘挂 document 捕获白名单 | 挂 Shadow Root | 焦点常在页面而非 shadow，实测挂载后键盘不响应 | 已修 |

## 5. Experiments and failures

| 日期 | 尝试 | 结果 | 失败原因 | 下一步 |
|---|---|---|---|---|
| 2026-11-17 | 用 `set_viewport_size` 模拟 F11 全屏 | 部分复现 | 视口模拟不改真实窗口，滚动条行为与真实 resize 有差异；小屏上永远到不了 1920 CSS 宽 | 改用 `--remote-debugging-port` 直连 + `Browser.setWindowBounds` 改真实窗口；屏幕不够大时用 `--force-device-scale-factor` 把全屏 CSS 宽度调到 1921（实测 1921×1088），逐题采样几何变化与逐帧像素差 |
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
* 2026-11-17: v0.3.4 — 修「浏览器全屏后题目不断闪动」。三条独立加固：①`.im-card` 加 `scrollbar-gutter:stable`，滚动条出现/消失不再改变内容宽度（859↔849 的死循环从根上断掉）；②`layoutCard` 在非强制路径下**只加不减**，不再 remove→测量→add 自激；③`resize()` 尺寸无变化直接返回，站点的每秒 DOM 变更不会让批注画布反复重绘；另加 `.im-app{transform:translateZ(0)}` 让固定层独立合成。验证：真实窗口 resize 到 1921×1088 全屏，逐题采样 0 次 class / 0 次画布变化，逐帧像素差只有计时器数字；新增 `tests/flicker_test.py`（8/8，旧构建 7/8 会红）。L1 18/18、L2 55/55 + 15/15 + 23/23 + 8/8、L3 67/67。
- 2026-11-17: v0.3.3 — 确认键统一：`Enter` / 空格在**单选与多选**下都「确认并切下一题」。删掉 v0.3.2 的 `isSpaceConfirmOnly()`（当时把单选下的空格放行），改为白名单一律拦截并走 `doAdvance(+1)`；顺带修掉「单选按 Enter 被吞但什么都不做」。底部提示「Enter / 空格 确认」。L1 18/18、L2 55/55 + 15/15 + 23/23、L3 真实站点 67/67。
- 2026-11-17: v0.3.2 — 多选确认支持空格：`classifyNavigationKey` 把 `' '`/`'Spacebar'` 归为 confirm，当时为「避免按空格没反应」让单选下空格放行（v0.3.3 已统一放开）。L2 51/51 + 15/15 + 23/23、L3 真实站点 63/63。
- 2026-11-17: v0.3.1 — 题干格式与原生严格对齐：原生 `.pb-stem` 是 `white-space:pre-wrap` 的纯文本，改为 `textContent` 取原文 + `esc()` 转义 + `pre-wrap` 渲染（15px / 1.75），`①②③④` 恢复逐行；选项同样纯文本化。长题干自动分栏（`grid` 左题干右选项，窄屏不分栏）。画布高度改取「内容真实高度」修掉 `scrollHeight` 自反馈（曾把画布撑到 21551px）。重按已选项不再卡住、照常自动切题。L2 集成 47/47、L3 60/60。
- 2026-11-17: v0.3.0 — 草稿纸重做为「题面批注」：透明 canvas 直接覆盖题卡（就地划），开关控制 `pointer-events`；笔画按题目 id 独立存储（`pol:immersive-scratch:{paperId}:{qid}`）；坐标锚定题卡内容，随题干滚动；题卡改为 `min-height:100%`，让整块题面都能当草稿区。橡皮改 `destination-out`。

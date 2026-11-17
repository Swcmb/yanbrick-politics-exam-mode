# 政砖沉浸式考试模式

把 [yanbrick.com/politics](https://yanbrick.com/politics) 的选择题练习改造成类似正式计算机考试的沉浸式答题界面：**一屏一题、键盘作答、答题卡、电子草稿纸、实时信息栏、最后一题交卷**。

以油猴脚本（Tampermonkey userscript）实现，答案、计时、交卷全部复用网站原生机制，不伪造任何数据。

## 功能

- **一屏一题**：只显示当前题，长题干在题目区内滚动，支持单选/多选。
- **顶栏信息**：实时计时（刷新不重置）、已作答 X/N、全站均分、题型·分值、当前题号。数字均来自页面真实数据，取不到显示占位。
- **键盘答题**：`A/B/C/D` 或 `1/2/3/4` 选择；单选按键即答即切下一题，多选可连续选择、`Enter` 确认切题；`←/→` 切题，`Esc` 关面板。
- **答题卡**：网格显示全部题号，未答/已答/当前三态，点击任意题号跳转并恢复答案。
- **电子草稿纸**：Canvas + Pointer Events，鼠标/触屏/触控笔统一；画笔、橡皮、撤销、清空；面板可拖动、可缩放，缩放不丢内容，整套卷共享、刷新恢复。
- **交卷**：仅最后一题显示，确认面板展示已答/未答/用时，确认后驱动网站原生交卷流程，不重复提交、不自行宣告成功。
- **兼容所有答题界面**：整卷 `/paper/*`、模拟/混合卷 `/mixed/*`、按科目练习 `/practice/*`、习题册 `/book/*`、`/bank/*`。非答题页自动不注入。
- **开关与退出**：顶栏「退出」会**持久关闭**沉浸模式并恢复原页面，之后不会自动弹出；答题页右下角保留一个「开启」入口，随时可重新进入。开关状态存在本地，刷新、切卷、重开浏览器都保持。
- **无多余滚动条**：挂载时锁住页面滚动，视口滚动条不再出现；长题干改为在题目卡内部滚动，滚动条收窄为细深色样式。
- **样式隔离**：全部 UI 在 Shadow DOM，不污染原站 CSS。动效克制且可关闭，遵循 `prefers-reduced-motion`。

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）。
2. 打开脚本文件 [`dist/yanbrick-immersive-exam.user.js`](dist/yanbrick-immersive-exam.user.js)，CTRL+A 全选复制。
3. 在 Tampermonkey 面板「添加新脚本」中粘贴并保存。
4. 登录 yanbrick.com，进入任一答题页即自动启用。顶栏「退出」会持久关闭并在右下角留一个「开启」入口，不会自动再弹出。

> 仅匹配 `https://yanbrick.com/politics/*`，不影响其他站点。

## 快捷键

| 按键 | 操作 |
|---|---|
| `A`/`1`、`B`/`2`、`C`/`3`、`D`/`4` | 选择对应选项（按真实选项数动态映射） |
| `Enter` | 多选题确认并切下一题 |
| `←` / `→` | 上一题 / 下一题 |
| `Esc` | 关闭答题卡 / 草稿纸面板 |

输入框、草稿纸操作、输入法组合、长按时不触发答题快捷键；`Tab`、`Ctrl/Cmd+R`、`F12` 等一律放行。所有操作都有鼠标等价方式。

## 数据保存与恢复

| 数据 | 存储 | 说明 |
|---|---|---|
| 答案、计时起点 | 网站原生 `pol:paper-draft:{p\|m}:{paperId}` 的 `startedAt` / `picked` | 只经原生选项节点 click 写回，答案真值由网站持有；脚本不直接改答案字段 |
| 当前位置、提交状态、动效开关 | `pol:immersive-state:{paperId}` | 脚本自有键，与原生键职责分离 |
| 草稿纸笔画 | `pol:immersive-scratch:{paperId}` | 结构化笔画，缩放时坐标重映射 |

所有键按 `paperId` 隔离，不同试卷互不干扰；24 小时原生草稿过期不偷偷续命，提示重开。保存失败明确提示，不谎称已保存。

## 草稿纸实现

原生 `<canvas>` + Pointer Events（`pointerdown/move/up/cancel`）统一鼠标、触摸、触控笔。按设备像素比适配；面板尺寸变化时把旧笔画坐标按比例重绘，不清空。撤销采用操作栈，清空交回可撤销记录。

## 运行与使用

- 浏览器：Chrome / Edge + Tampermonkey / Violentmonkey。
- 开发构建：`node build.js`，把 `src/` 下模块拼成单文件到 `dist/`。
- 单测：`node --test tests/core.test.js`。
- 集成测试：`D:/ProgramFiles/deeplearning/python.exe tests/integration_test.py`、`tests/edge_cases.py`（Playwright + 本地 fixture，无需登录态）。
- 真实站点端到端：`python tests/e2e_real.py`（首次会打开窗口，人工扫码登录一次；之后无头复用 `.e2e-browser-profile/`）。

## 项目结构

```
src/          源码（core 纯逻辑 / main 适配器 / ui 渲染与草稿纸 / boot 事件与生命周期）
dist/         构建产物（单文件油猴脚本，可直接安装）
tests/        Node 单测 + Playwright 集成/边界测试 + DOM fixture
project-context/specs/      设计规格
project-context/research/   三轮审查报告 + bundle 证据快照
project-context/plans|docs|designs|artifacts/  预留
```

## 测试状态

- ✅ **L1 单元测试** 16/16 通过（`node --test`）。
- ✅ **L2 集成测试** 27/27 通过（Playwright + fixture + API mock）。
- ✅ **L2 边界测试** 10/10 通过（快速连按、移动端、试卷隔离、草稿纸缩放保留）。
- ✅ **L2 开关回归** 23/23 通过（退出持久化、3/5 秒后不自动重挂、刷新保持、开关回开、滚动锁与还原）。
- ✅ **L3 真实站点端到端** 50/50 通过（真实登录态、真实页面；含退出 3/6/10 秒不重挂）。明细见 `project-context/research/l3-real-site-test-report.md`，原始结果 `project-context/research/artifacts/l3-report.json`。

L3 关键实测数字：整卷 33 题、全站均分 25 / 50、题干 HTML 长度与原生完全相同（213）、按 B 后原生 `.pb-opt.picked` 真的被选中、交卷取消后**零 `POST /submit`**；练习页总数取原生答题卡 150 格、按一次方向键只前进一题。

> 真实站点测试不是走过场：它抓出 4 个 L1/L2 抓不到的实现缺陷（SPA 首屏时序未挂载、练习页总数误判为 1、`CSS.escape` 被站点覆盖导致写回失败、方向键被原生与脚本各处理一次导致跳两题），均已修复并回归。

## License

GPL-3.0-or-later。详见 [LICENSE](LICENSE)。

脚本为第三方网站的用户侧增强，与 yanbrick.com 无关联；请遵守目标网站的服务条款。

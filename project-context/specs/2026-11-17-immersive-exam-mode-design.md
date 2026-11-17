# 设计规格：yanbrick.com/politics 沉浸式单题考试模式（油猴脚本）

- **日期**：2026-11-17
- **状态**：Draft（待子代理审查 + 用户复核）
- **目标站点**：`https://yanbrick.com/politics`（政砖 · 考研政治）
- **交付形态**：Tampermonkey 用户脚本（`.user.js`）
- **许可**：GPL-3.0-or-later

## 1. 背景与结论

任务要求把目标站的选择题练习改造成"类似正式计算机考试"的沉浸式答题界面：一屏一题、键盘作答、答题卡、电子草稿纸、实时信息栏、最后交卷。任务文件明确要求：实现 + 测试 + 验证，数字不硬编码，答案/分值/均分不伪造，优先复用网站原生机制，兼容多种答题界面。

**核心工程判断**：目标站是成熟的 React SPA，原生已经具备答案存储、计时起点、交卷判分、全站均分、答题卡跳转等完整状态机。因此本脚本**不重造状态层**，而是：

1. 通过适配器层读取网站真实数据（题目、题型、分值、题干/图片/表格、均分），归一化为统一题目模型；
2. 用 Shadow DOM 覆盖一层沉浸式呈现界面；
3. 答案与交卷写入网站原生存储/接口，复用其判分流程。

这同时满足"数据真实""复用原生""兼容所有界面"三条硬约束。

## 2. 调研证据（已实测）

### 2.1 站点技术栈
- SPA，`index.html` 仅 `<div id="root">` + 单个入口 bundle `assets/index-*.js`。
- 政治模块懒加载 chunk：`PoliticsApp-*.js`，题目相关：`Practice-*.js` / `Paper-*.js` / `Bank-*.js` / `Book-*.js` / `QuestionCard-*.js`，草稿：`draft-*.js` / `ScratchPad-*.js`。
- 需要登录态；题库与解析登录后可见。用户已确认登录态可用。

### 2.2 已发现的答题界面（路由）
| 类型 | 路由模式 | 说明 |
|---|---|---|
| 整卷 | `/politics/paper/real-YYYY`、`/politics/paper/*` | 33 题 / 50 分场景，含计时、已作答、全站均分、交卷 |
| 模拟题 | `/politics/paper/` 下的 mock 类（如 `mock27-xiao8-\d`） | 与整卷共用 Paper 组件，mock 标记区分 |
| 按科目练习 | `/politics/practice/realsub-<科目>`、`/politics/practice/*` | 逐题流，含草稿纸入口、上一题/下一题、单选/多选筛选 |
| 习题册/章节 | `/politics/books`、`/politics/book/*`、`/politics/bank/*` | 按书本章节推进 |

> 说明：任务文件以"33 题 / 50 分"为当前场景。所有数量与分值必须在运行时从页面数据读取，不得硬编码。

### 2.3 数据接口（来自 bundle 实测，非杜撰）
- 政治模块前缀 `/api/politics`，封装 `n(path, fallback)` = GET，`c(path, method, body, fallback)` = JSON 写。
- 关键路径：`/banks`、`/banks/{code}`、`/real-subjects`、`/chapters/{bank}`、`/chapters/{bank}/answers`、`/questions/{id}/answer`、`/questions/{id}/answer/log`、`/search`、`/custom` 等。
- 全局状态：`/api/state` 返回 `answers[]`、`choiceToday/choiceLimit`；答题写入 `/api/answer`（body 含 `questionId, chosen, correct, secs, paperAttemptId`）。
- 题目字段（来自组件与接口）：`id`、`type`（`multi` = 多选，否则单选）、`stem`（题干 HTML）、`options[]`、`no`（题号）、`subject`、`fullScore`（整卷满分）；单题分值可能来自题目自身 `score` 或由整卷满分/题型推导，**以页面实际渲染为准**，取不到就显示占位。
- 全站均分：Paper 组件渲染 `全站均分 N / 50`（class `pb-ave`），由服务端数据驱动；也有 `最高 best / fullScore` 等字段。

### 2.4 原生持久化（可复用）
- 整卷草稿键：`pol:paper-draft:${mode}:${paperId}`，`mode` 为 `p`（真题）/`m`（模拟），值形如 `{ startedAt: number, picked: {...}, ... }`，24h 过期（`Date.now() - startedAt < 24*36e5`）。
- 计时起点来自 `startedAt`；交卷时把 `picked` 归一化为 `{id, choice[]}` 提交。
- DOM 命名约定：题目卡 `pb-pq-${id}`、答题卡 `pb-*`、顶部信息条含 `已作答 n / N`、`全站均分 N / 50`、题型标签 `${type==="multi"?"多选":"单选"}`。

## 3. 架构

```
用户可见层（Shadow DOM，独立命名空间）
├─ 顶栏：计时 / 已作答 X/N / 全站均分 / 题型·分值 / 第 n/N 题 / 答题卡入口 / 草稿纸入口
├─ 题目区：一屏一题，题干 innerHTML 原样注入（图片/表格/公式保留），选项单选/多选
├─ 底部：上一题 / 下一题 / （最后一题）交卷
├─ 答题卡抽屉：网格、三态、点击跳转
├─ 草稿纸浮层：Canvas + Pointer Events，画笔/橡皮/撤销/清空，可缩放
└─ 动效层（motion-lab）：切题滑入、选项反馈、面板开合、交卷确认，可一键关闭

脚本核心层
├─ 路由/界面识别器：依据 location.pathname + DOM 特征判定界面类型
├─ 适配器（4 类）：把各界面数据 → 统一题目模型
├─ 统一状态机：currentIndex、answers、startedAt、submitted、scratch(独立键)
├─ 持久化：答案/计时复用原生键；草稿纸用独立键（界面被替换，原生草稿形状不通用）
└─ 事件层：键盘（含安全过滤）、点击、SPA 路由变化、MutationObserver

网站原生层（复用，不重造）
├─ /api/politics/* 与 /api/state、/api/answer
├─ pol:paper-draft:* 原生草稿键
└─ 原生交卷/判分流程
```

## 4. 统一题目模型

```ts
interface Question {
  id: string | number;      // 稳定标识，来自页面数据，不用 DOM 下标
  type: "single" | "multi"; // 由 type === "multi" 判定，不硬编码题号映射
  score: number;            // 来自真实数据；取不到则显示占位，不臆造
  stemHTML: string;         // 题干，原样保留图片/表格/公式
  options: { key: "A"|"B"|"C"|"D"; html: string }[];
  no: number;               // 题号
}

interface ExamModel {
  kind: "paper" | "mock" | "practice" | "book";
  paperId: string;          // 隔离键
  questions: Question[];
  total: number;            // = questions.length，动态
  avgScore: number | null;  // 全站均分，取不到为 null（显示占位）
  fullScore: number | null; // 试卷满分，取不到为 null
  startedAt: number;        // 计时起点
  picked: Record<id, string[]>; // 已有作答
  submitted: boolean;
}
```

## 5. 适配器职责

每个适配器实现 `detect(): boolean` 与 `load(): Promise<ExamModel | null>`：

1. **PaperAdapter**（整卷/模拟）：读取整卷题目列表、均分、满分、原生草稿键；交卷走原生提交接口。
2. **PracticeAdapter**（按科目练习）：读取练习题流；答案写入复用该页面自身的作答路径（其原生 POST `/questions/{id}/answer` 会即时判分，脚本只复用同一写路径，不自行改变判分语义）。
3. **BookAdapter**（习题册/章节）：读取章节题目；按章节隔离。
4. **FallbackAdapter**（兜底）：当无法识别但页面存在可识别题目容器时，尽力从 DOM 抽取题干/选项/题型/分值；仍失败则显示"当前页面暂不支持沉浸式模式"，不破坏原页面。

适配优先级：专用适配器 > FallbackAdapter > 明确提示不支持。

## 6. 关键行为规格

### 6.1 一屏一题与切题
- 主区仅渲染当前 `Question`；超长题干在题目区内部滚动。
- 单选：按 A/B/C/D 或 1/2/3/4 → 立即写入答案 → 平滑切下一题（motion-lab `slide-in-left`，~220ms）。
- 多选：按键切换选中态 → 每次变化即写入 → **不自动切题**；Enter 确认后切下一题。
- 快速连按加锁（`transitioning` 标志 + 时间戳节流），防止跳题；切题动画期间拒绝新输入或排队到最后一张。

### 6.2 顶栏信息
- 计时：`floor((Date.now()-startedAt)/1000)`，每秒刷新，从原生 `startedAt` 恢复，刷新不重置。
- 已作答：`Object.keys(picked).filter(有非空选择).length / total`，答案变化即时更新。
- 全站均分：`avgScore ?? "暂无数据"`；满分同理；**不本地计算分数冒充均分**。
- 题型·分值：`${type==="multi"?"多选题":"单选题"} · ${score} 分`，分值取不到显示"—"。

### 6.3 键盘安全
- 焦点在 `input/textarea/[contenteditable]`、草稿纸面板激活、组合输入（`isComposing`）、`event.repeat` 长按 → 不触发答题快捷键。
- 与网站快捷键冲突时脚本优先（捕获阶段），但放行无关键盘组合（如 Ctrl/Cmd+R、F12）。
- 所有键盘操作有鼠标/触屏等价入口。

### 6.4 持久化与隔离
- 答案、当前位置、开始时间、提交状态 → 复用原生 `pol:paper-draft:*` 键，按 `paperId` 隔离。
- 草稿纸笔画 → 独立键 `pol:immersive-scratch:${paperId}`，IndexedDB 仅当 localStorage 容量不足时再引入（当前先用 localStorage）。
- 页面加载时读取一次，不创建重复记录；写失败 toast 明确提示。

### 6.5 答题卡
- 网格展示 `1..total`；状态：未作答 / 已作答（显示所选字母）/ 当前（高亮）。
- 点击：保存当前 → 跳转 → 恢复该题答案 → 更新高亮 → Esc/关闭按钮返回。

### 6.6 电子草稿纸
- Canvas + Pointer Events（`pointerdown/move/up/cancel`），统一鼠标/触摸/触控笔。
- 工具：画笔、橡皮擦、撤销（操作栈）、清空；面板可拖拽、可缩放。
- 设备像素比适配；resize 时把旧画布内容重绘到新尺寸，不清空。
- 整卷共享，切题不清空；刷新从独立键恢复。

### 6.7 交卷
- 仅最后一题显示交卷按钮；未作答也允许主动交卷。
- 确认面板显示：已作答数、未作答数、当前用时、是否确认。
- 确认后：写全部答案 → 调用**网站原生交卷流程**（不自行判分、不伪造提交成功）。
- 防重复：`submitted` 标志 + 按钮禁用 + 幂等提交。

### 6.8 样式隔离与降级
- 全部 UI 在 Shadow DOM，独立命名空间，不污染原站 CSS。
- 动效遵循 `prefers-reduced-motion: reduce` 降级；提供"关闭动效"开关。
- 桌面键盘优先，移动端支持触屏答题与草稿纸绘画。

## 7. 动效选型（motion-lab）
- `slide-in-left` / `slide-in-right`：切题（方向按前进/后退），~220ms。
- `button-press` / `ripple-click-material`：选项按下反馈。
- `fade-in-up`：题干入场；`scale-in`：交卷确认弹窗。
- `accordion-smooth` 思路：答题卡抽屉开合。
- 全部提供关闭开关；遵守 reduced-motion。

## 8. 测试与验收

### 8.1 单元/逻辑测试（Node，`node --test`）
- 解析器：题干/选项/题型/分值/均分抽取，覆盖单/多选、缺字段、图片题干。
- 状态机：单选自动切题、多选不自动切、Enter 确认、快速连按不跳题、边界（首/末题）。
- 持久化：读写原生键、按 paperId 隔离、写失败提示、刷新恢复。
- 键盘安全：输入框/草稿纸/组合输入/repeat 过滤。
- 草稿纸：笔画栈、撤销、清空、resize 不丢内容。

### 8.2 真实浏览器测试（Playwright，复用 deeplearning 环境）
- 四种答题界面各加载一次，验证脚本识别 + 一屏一题 + 信息栏数字与页面真实值一致。
- 键盘答题：A/B/C/D、1/2/3/4、Enter、←/→、Esc；连续快按不跳题。
- 刷新恢复：答案/计时/草稿纸。
- 答题卡跳转与答案恢复。
- 草稿纸鼠标绘画、触屏（Playwright touch）、撤销、清空、缩放保留。
- 交卷：前面题目无交卷按钮、最后一题有、二次确认、未作答统计、不重复提交。
- 桌面 + 移动视口布局。

### 8.3 验收清单
以任务文件第十一节清单为准，逐项标记 PASS / FAIL / NOT RUN；未执行项必须写明原因。

## 9. 明确不做的边界
- 不伪造题目、答案、分值、均分、提交结果。
- 不绕过登录、权限或访问控制。
- 不破坏原网站原有题目数据与提交逻辑。
- 不硬编码 33 题 / 50 分 / 固定题号映射。
- 不引入大型 UI 框架。

## 10. 交付物
1. 修改/新增文件清单。
2. 核心方案与技术选型。
3. 键盘快捷键说明。
4. 保存与恢复机制。
5. 草稿纸实现。
6. 运行/安装方式（Tampermonkey）。
7. 实际执行的测试命令。
8. 测试结果与未覆盖场景（区分已实现/已测试/未验证）。

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
3. 答案与交卷通过**驱动原生 DOM 节点**写回，答案真值仍由网站原生状态机持有；脚本只维护一份"渲染用镜像状态"（当前位置、面板开关、草稿纸），不接管答案真值。

这同时满足"数据真实""复用原生""兼容所有界面"三条硬约束。"不重造状态层"特指**不接管答案/计时/判分的真值**，与脚本持有渲染镜像状态不矛盾。

## 2. 调研证据（已实测）

### 2.1 站点技术栈
- SPA，`index.html` 仅 `<div id="root">` + 单个入口 bundle `assets/index-*.js`。
- 政治模块懒加载 chunk：`PoliticsApp-*.js`，题目相关：`Practice-*.js` / `Paper-*.js` / `Bank-*.js` / `Book-*.js` / `QuestionCard-*.js`，草稿：`draft-*.js` / `ScratchPad-*.js`。
- 需要登录态；题库与解析登录后可见。L3 用持久化 profile（`.e2e-browser-profile/`）保存登录态，首次运行人工扫码一次即可；该目录与 `storageState` 均不入库（见 §8）。

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
- 题目字段（来自组件与接口）：`id`、`type`（`multi` = 多选，否则单选）、`stem`（题干 HTML）、`options[]`、`no`（题号）、`subject`、`fullScore`（整卷满分）。**单题分值只取自真实字段或 DOM 的 `+N分` 标签**（实测整卷第 1 题为"单选 1分"、第 33 题为"多选 2分"，分值直接写在该题卡标签上，见 §2.7），取不到为 `null`。**严禁由整卷满分/题型反推单题分值。**
- 全站均分：Paper 组件渲染 `全站均分 N / 50`（class `pb-ave`），由服务端数据驱动；也有 `最高 best / fullScore` 等字段。

### 2.4 原生持久化（可复用）
- 整卷草稿键：`pol:paper-draft:${mode}:${paperId}`，`mode` 为 `p`（真题）/`m`（模拟），值形如 `{ startedAt: number, picked: {...}, ... }`，24h 过期（`Date.now() - startedAt < 24*36e5`）。
- 计时起点来自 `startedAt`；交卷时把 `picked` 归一化为 `{id, choice[]}` 提交。
- DOM 命名约定：题目卡 `pb-pq-${id}`、答题卡 `pb-*`、顶部信息条含 `已作答 n / N`、`全站均分 N / 50`、题型标签 `${type==="multi"?"多选":"单选"}`。

## 2.5 审查后补测与阻断关闭记录（2026-11-17）

子代理审查（`research/spec-review-1.md`）给出 APPROVED_WITH_CHANGES，5 项阻断。补测与处置如下：

| 编号 | 处置 | 证据 / 决策 |
|---|---|---|
| **D-2** 整卷是否一次渲染 | 已关闭 | 静态分析 + 浏览器实测：整卷题目经 `GET /api/politics/banks/{code}`（卷元信息 name/kind/aveScore/chapters）→ `GET /api/politics/chapters/{chapterCode}`（含完整 `questions[]`）一次拿到全量；随机组卷走 `GET /api/politics/mixed/{code}`。DOM 侧亦实测全量铺开（§2.7）。**PaperAdapter API-driven 读取 + DOM 驱动写回**，`total` 取接口题目列表长度。接口路径已按 `research/artifacts/PoliticsApp.bundle.js` 的 export 映射更正，详见 §2.7 R-3。 |
| **D-1** 取数通道 | 已关闭 | 见新增 §2.6「取数通道」。 |
| **S-1** 交卷写回 | 已关闭 | 见修订 §6.4 / §6.7：主路径驱动原生选项/交卷按钮 `.click()`，让 React `onChange→setState→写盘→UI` 链路完整执行；脚本自建 localStorage 仅作恢复补偿。**不直接改 localStorage 冒充作答。** |
| **T-1/T-2** 测试分层 | 已关闭 | 见新增 §8 三层分工 + fixture/mock 层。 |
| **C-1** total 来源 | 已关闭 | 见修订 §4：按 kind 分别定义 total 来源。 |
| **F-1** CSP | 已关闭 | 实测 `curl -I https://yanbrick.com/politics/paper/real-2026` **无 `content-security-policy` 响应头**，脚本注入无障碍，采用 `@grant none`。 |

### 2.6 取数通道（关键澄清）
**油猴脚本 ≠ 浏览器审查工具。** 审查工具只能读过滤后的可见 DOM；油猴脚本运行在页面上下文（`@grant none`），可执行任意 JS、访问完整 `document`、同源 `fetch` 自动携带登录 cookie、读写同源 localStorage。取数优先级：

1. **同源 API fetch（首选，结构化真值）**：`/api/politics/*`、`/api/state`、`/api/answer`。同源请求，无需 `GM_xmlhttpRequest` / `@connect`。
2. **完整 DOM（补充，页面显示值）**：`.pb-ave` 均分文本、`已作答 n / N`、`+N分` 标签、题干/选项 HTML。
3. **原生 localStorage（计时与作答恢复）**：`pol:paper-draft:*` 的 `startedAt` / `picked`。

适配器中禁止沿用"只能看可见文本"的自我设限。

### 2.7 第二轮审查门禁 R-1~R-6 关闭记录（实测，2026-11-17）

证据文件：`research/artifacts/{Paper,PoliticsApp}.bundle.js`（bundle 快照）、`research/spec-review-2.md`。

| 编号 | 处置 | 实测证据 / 决策 |
|---|---|---|
| **R-1**（原生题卡渲染方式） | 已关闭 | 内置浏览器打开 `/politics/paper/real-2026` 按 `End` 直达**第 33 题**（"多选 2分"、四选项完整渲染），底部"交卷（已作答 0/33）"。证明**33 题全量铺开渲染、非虚拟滚动**；任意题原生节点常驻 DOM，S-1 写回链路成立。 |
| **R-2**（节点引用失效） | 已关闭 | §6.7 写回伪代码写死：每次写回前按 `domIndex+paperId` **重新 `querySelector`**、校验 `node.isConnected`、**禁止缓存引用**；click 后回读原生 `picked` 作成功判据，失败重试/提示。 |
| **R-3**（组卷会话一致性） | 已关闭（路径已更正） | 按 bundle export 映射（`research/artifacts/PoliticsApp.bundle.js`）核实，真实接口为：`GET /api/politics/banks/{code}`（卷元信息）、`GET /api/politics/chapters/{code}`（题目列表）、`GET /api/politics/chapters/{code}/answers`（章节answers）、`GET /api/politics/mixed/{code}`（混合/随机卷）、交卷 `POST /api/politics/papers/{code}/submit` 与 `POST /api/politics/review/{code}/grade`。**不存在 `GET /papers/{code}`**（早期草稿描述有误，已删）。**约束（保守策略）**：脚本对每个 code **只做一次只读 GET，同 code 复用首次题集，绝不二次调用任何组卷接口**；题目真值优先以原生 DOM/页面已加载状态为准，API 仅用于补全结构化字段。若某 mock code 无法只读定位，降级为 DOM 驱动 + 提示。 |
| **R-4**（证据可追溯） | 已关闭 | bundle 快照落盘 `research/artifacts/`；§2.3/§2.5 结论均引用该快照，不再用无出处的混淆变量名。 |
| **R-5**（交卷选择器与弹窗层级） | 已关闭 | bundle 原文 `className:"pb-submit",onClick:q` 确认交卷按钮为 `.pb-submit`，文案"交卷（已作答 N/M）"。§6.7 补充：脚本 Shadow Host `z-index` 低于原生对话框，原生确认弹窗可点击，确认交由原生、不叠加双重确认。 |
| **R-6**（分值来源矛盾） | 已关闭 | §2.3 已删除"由满分/题型推导"，与 §4"不从满分反推"统一：分值只取真实字段或 DOM `+N分` 标签，取不到 `null`。 |

## 3. 架构

```
用户可见层（Shadow DOM，独立命名空间）
├─ 顶栏：计时 / 已作答 X/N / 全站均分 / 题型·分值 / 第 n/N 题 / 答题卡入口 / 草稿纸入口
├─ 题目区：一屏一题，题干 innerHTML 原样注入（图片/表格/公式保留），选项单选/多选
├─ 底部：上一题 / 下一题 / （最后一题）交卷
├─ 答题卡抽屉：网格、三态、点击跳转
├─ 题面批注层：透明 Canvas 覆盖题卡（就地划），笔/橡皮/撤销/清空，每题独立
└─ 动效层（motion-lab）：切题滑入、选项反馈、面板开合、交卷确认，可一键关闭

脚本核心层
├─ 路由/界面识别器：依据 location.pathname + DOM 特征判定界面类型
├─ 适配器（4 类）：把各界面数据 → 统一题目模型
├─ 统一状态机：currentIndex、answers、startedAt、submitted、作图层(按题目 id 独立键)
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
  score: number | null;     // 来自真实数据；取不到为 null（UI 显示占位），不臆造、不从满分反推
  stemHTML: string;         // 题干，原样保留图片/表格/公式
  options: { key: string; html: string; domIndex: number }[]; // key 动态（A.. 按 options.length），domIndex 用于驱动原生节点
  no: number;               // 题号
}

interface ExamModel {
  kind: "paper" | "mock" | "practice" | "book";
  paperId: string;          // 隔离键：URL code 优先，其次接口 id，最后草稿键后缀
  questions: Question[];
  // total 按 kind 分别取，禁止统一 questions.length：
  //   paper/mock → 接口题目列表长度 或 页面「共 N 题」
  //   practice/book → 页面「已作答 n / N」的分母 N 或接口 total 字段
  total: number;
  avgScore: number | null;  // 全站均分，取不到为 null（显示占位）
  fullScore: number | null; // 试卷满分，取不到为 null
  startedAt: number;        // 计时起点，来自原生草稿键
  picked: Record<id, string[]>; // 已有作答（原生真值）
  submitted: boolean;
}

// 脚本自有状态（与原生键职责分离，见 §6.4）
interface ImmersiveState {
  currentIndex: number;     // 当前位置
  submitted: boolean;       // 提交状态（脚本视角）
  scratch: Stroke[][];      // 草稿纸笔画
  motionEnabled: boolean;   // 动效开关
}
```

## 5. 适配器职责

每个适配器实现 `detect(): boolean` 与 `load(): Promise<ExamModel | null>`：

1. **PaperAdapter**（整卷/模拟）：读取整卷题目列表、均分、满分、原生草稿键；交卷走原生提交接口。
2. **PracticeAdapter**（按科目练习）：读取练习题流；答案写入复用该页面自身的作答路径（其原生 POST `/questions/{id}/answer` 会即时判分，脚本只复用同一写路径，不自行改变判分语义）。
3. **BookAdapter**（习题册/章节）：读取章节题目；按章节隔离。
4. **FallbackAdapter**（兜底）：当无法识别但页面存在可识别题目容器时，尽力从 DOM 抽取题干/选项/题型/分值；仍失败则显示"当前页面暂不支持沉浸式模式"，不破坏原页面。

适配优先级：专用适配器 > FallbackAdapter > 明确提示不支持。

**调度与缓存**（Q-6）：

```
onRouteChange(path):              // 首次加载 + SPA 路由变化统一入口
  if path matches 解析/列表/无题页: teardown(); return          // 不注入
  adapter = [PaperAdapter, PracticeAdapter, BookAdapter, FallbackAdapter]
            .find(a => a.detect(path))
  key = adapter.paperKey(path)    // URL code 优先，其次接口 id
  if current && current.key == key: return                    // 同卷不重建，避免抖动
  teardown()                                                  // 销毁旧 Shadow Host + disconnect observer
  model = await adapter.load()    // 若 401 → 提示登录；null → 提示不支持
  if !model: return
  mount(model)                    // 建 Shadow Host + 挂 observer（防抖、过滤自身节点）
```

缓存：同一 `key` 的 `ExamModel` 在内存缓存，仅在路由离开该 key 时释放；原生 `picked` 每次作答从 DOM/原生键回读，不缓存真值。

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

### 6.3 键盘安全（显式白名单）
仅在"非输入焦点态"（焦点不在 `input/textarea/[contenteditable]`、草稿纸面板未激活、非 `isComposing`、非 `event.repeat`）下，**只拦截以下白名单按键**：

| 按键 | 行为 | preventDefault |
|---|---|---|
| A/B/C/D、1/2/3/4（按 `options.length` 动态映射，超出数量忽略） | 选/切选项 | 是 |
| Enter | 多选确认切题 / 单选冗余确认 | 是 |
| ← / → | 上/下一题 | 是 |
| Esc | 关闭当前面板 | 是 |
| 其余全部（含 Tab、Ctrl/Cmd+R、F12、Ctrl/Cmd+L、输入法组合键） | 放行给网站/浏览器 | 否 |

所有键盘操作有鼠标/触屏等价入口。监听挂脚本自己的 Shadow Root（事件 `composed:true` 冒泡到 document 也能拿到），不对整页做捕获阶段全局 `stopPropagation`，以免破坏原生 Tab+Enter 可达性。

### 6.4 持久化与隔离（职责分离）
- **原生键 `pol:paper-draft:${p|m}:${paperId}`**：只同步网站原生定义的 `startedAt` 与 `picked` 两个字段，**不塞自定义字段**（无根据扩展会被原生覆盖或误判过期）。写入仅作"恢复补偿"：刷新后把已存作答注入回界面，随后以一次原生节点 click 同步 React state。
- **脚本自有键 `pol:immersive-state:${paperId}`**：当前位置 `currentIndex`、提交状态 `submitted`、动效开关。
- **批注键 `pol:immersive-scratch:${paperId}:${题目id}`**：每题一份笔画数据；另有 `pol:immersive-annot` 记忆开关。localStorage 优先，容量不足再评估 IndexedDB（当前先用 localStorage）。
- 所有键按 `paperId` 隔离；页面加载读取一次，不创建重复记录；写失败 toast 明确提示。

### 6.5 答题卡
- 网格展示 `1..total`；状态：未作答 / 已作答（显示所选字母）/ 当前（高亮）。
- 点击：保存当前 → 跳转 → 恢复该题答案 → 更新高亮 → Esc/关闭按钮返回。

### 6.6 题面批注（草稿纸）
- **就地批注，不是独立面板**：透明 `<canvas>` 绝对定位在题卡内容之上（`.im-card` 内，层级高于文字），用户直接在题干/选项/空白处划。
- 开关只切 `pointer-events`：关闭时画布完全不拦指针（选项可正常点击），打开时指针交给画布；开关状态记忆在 `pol:immersive-annot`，默认关。
- Canvas + Pointer Events（`pointerdown/move/up/cancel`），统一鼠标/触摸/触控笔；按 `devicePixelRatio` 适配。
- 工具：笔、橡皮（`destination-out` 真擦除，画布透明底）、撤销（操作栈）、清空。
- **每题独立**：存储键 `pol:immersive-scratch:{paperId}:{题目id}`，切题即整层切换；原生题卡无 id 时退回位置键（练习页 `i{nativeIndex}`），保证独立性不失效。
- **坐标锚定内容**：画布高度取 `max(题卡可视高, scrollHeight)`，随题卡一起滚动，长题干滚动时笔迹不会错位；`ResizeObserver` 在换题/窗口缩放/图片加载后重排并按比例换算旧笔迹。
- 打开批注时键盘快捷键仍可用（鼠标画、键盘答不冲突）；`Esc` 退出批注。

### 6.7 交卷（驱动原生，不伪造）
- 仅最后一题显示交卷按钮；未作答也允许主动交卷。
- 脚本自己的确认面板**只做统计与二次确认**（已作答数、未作答数、当前用时），确认后**程序化点击原生交卷按钮**（`.pb-submit`），让网站走原生判分/提交。不自行 fetch 提交接口（避免缺 `paperAttemptId`/`secs` 等字段）。
- **不自行显示"提交成功"**：以原生页面的结果态 DOM 变化作为成功判据；若原生还有确认弹窗，交由原生处理，不叠加双重确认。
- 防重复：`submitted` 标志 + 按钮禁用 + 幂等。
- 单选/多选作答的主写路径同理：驱动对应**原生选项 DOM 节点** `.click()`（原生节点仍在 light DOM，只是被覆盖层遮住），让 React `onChange→setState→写原生 localStorage→UI` 链路完整执行；脚本覆盖层只读 React 更新后的状态来刷新显示。练习模式（会即时判分、不可撤回）的原生写入需经 ~150ms 防抖确认后才触发。

**写回硬约束（R-2）**——禁止缓存 DOM 节点引用，React 重渲染后旧节点会 detached、click 静默失效。伪代码：

```
function writeChoice(q: Question, keys: string[]):
  for attempt in 1..3:
    // 每次重新定位，不用 load() 时抓的引用
    card = document.querySelector(`[id*="${q.id}"]`)  // 题卡容器，实测稳定锚点
    if !card or !card.isConnected: wait(40ms); continue
    for key in keys:
      opt = card.querySelectorAll('button')[q.options[key].domIndex]
      if !opt or !opt.isConnected: break
      opt.click()                    // 驱动原生 onChange → setState → 写盘
    // 成功判据：回读原生 picked，确认已含本次 keys
    if nativePicked(q.id) covers keys: return OK
    wait(40ms)
  return FAIL → toast "作答未保存，请重试"（不谎称已保存）
```

**层级（R-5）**：脚本 Shadow Host 的 `z-index` 低于原生对话框/确认弹窗（如 `.modal-overlay`）；原生交卷若弹确认框，脚本覆盖层不得拦截其点击。确认交由原生弹窗完成，脚本不叠加自己的二次确认面板于其上（脚本确认面板仅在"点击交卷 → 触发原生按钮 click"之间出现一次，之后隐身让位原生弹窗）。

### 6.8 样式隔离与降级
- 全部 UI 在 Shadow DOM，独立命名空间，不污染原站 CSS。
- 动效遵循 `prefers-reduced-motion: reduce` 降级；提供"关闭动效"开关。
- 桌面键盘优先，移动端支持触屏答题与草稿纸绘画。

### 6.9 模式开关（持久，默认开）
- **状态**：`localStorage['pol:immersive-enabled']`，缺省视为开启。用户点顶栏「退出」写入 `'0'`。
- **关闭态语义**：不挂载覆盖层、不轮询重试；`MutationObserver` 仅用于维护右下角开关入口，**任何情况下不得自动重新挂载**。
- **必须持久的理由**：站点自身计时器每秒改动 DOM，`MutationObserver` 与兜底轮询会持续触发；若退出只是内存态，覆盖层会在 250–650ms 内被重新建起来（实测报告的"点退出几秒后又回去"）。
- **入口**：关闭态下，仅在可答题页面（`detectKind` 命中或存在原生题卡）显示右下角固定入口「沉浸模式已关闭 · 开启」；非答题页不显示。点击后写回 `'1'` 并重新挂载。
- **不变式**：任意时刻"开启 ⇒ 覆盖层存在或正在挂载"，"关闭 ⇒ 无覆盖层且无自动挂载"。

### 6.10 滚动与滚动条
- 挂载时对 `documentElement` 与 `body` 置 `overflow:hidden` 并记录原值，退出时**逐个还原**（含 `paddingRight` 补偿），不得残留。
- 覆盖层为 `position:fixed; inset:0`，但视口滚动条仍会画在最右侧；锁定页面滚动是消除它的正确做法，不是在覆盖层上盖东西。
- 长题干在题目卡内部滚动（`overflow-y:auto; overscroll-behavior:contain`），滚动条收窄为主题化的细深色（`scrollbar-width:thin` + WebKit 伪元素），内容不溢出时不出现。

## 7. 动效选型（motion-lab）
- `slide-in-left` / `slide-in-right`：切题（方向按前进/后退），~220ms。
- `button-press` / `ripple-click-material`：选项按下反馈。
- `fade-in-up`：题干入场；`scale-in`：交卷确认弹窗。
- `accordion-smooth` 思路：答题卡抽屉开合。
- 全部提供关闭开关；遵守 reduced-motion。

## 8. 测试与验收（三层分工）

| 层 | 测什么 | 不测什么 | 前置条件 |
|---|---|---|---|
| **L1 Node 单测**（`node --test`） | 纯逻辑：解析器、状态机、键盘白名单过滤、笔画栈、total 来源判定 | DOM、网络、真实登录 | 无 |
| **L2 Playwright + fixture/mock** | DOM 适配、detect→load 链路、事件流、SPA 生命周期、持久化读写、一屏一题/键盘/答题卡/草稿纸/交卷防重复 | 真实接口数据、真实判分 | 本地 fixture（复制四种界面真实 DOM 结构）+ `page.route('**/api/politics/**')` 注入录制响应 |
| **L3 真实站点**（Playwright，deeplearning 环境） | 接口返回真值、原生交互真生效、均分与页面 `.pb-ave` 逐字符一致 | — | **需登录态**：`tests/e2e_real.py` 用持久化 profile，首次运行人工扫码一次即可长期复用（`.e2e-browser-profile/` 已 gitignore） |

### 8.1 L1 单元测试
- 解析器：题干/选项/题型/分值/均分抽取；单/多选、缺字段、图片题干、`score=null` 占位。
- 状态机：单选自动切题、多选不自动切、Enter 确认、快速连按不跳题、首/末题边界。
- total 来源：paper 用列表长度、practice/book 用"n / N"分母。
- 键盘白名单：白名单内 preventDefault、白名单外放行；输入框/草稿纸/组合/repeat 过滤。
- 持久化：按 paperId 隔离、原生键只写 startedAt/picked、写失败提示、刷新恢复。
- 题面批注：笔画栈、撤销、清空、切题隔离、滚动锚定、resize 不丢内容。
- 均分断言：显示值必须与传入的 `.pb-ave` 文本逐字符一致（含分母）。

### 8.2 L2 集成测试（无需登录，覆盖约 80% 行为）
- 本地 fixture 复制四种界面真实 DOM（`pb-pq-${id}`、`.pb-ave`、`+N分` 标签、选项按钮）；
- `page.route` mock 掉 `/api/politics/**`，喂录制/构造的真实结构 JSON；
- 验证 detect→load→一屏一题→键盘→答题卡跳转→草稿纸→交卷防重复全链路；
- 验证 SPA 路由切换后旧 Shadow Host 被清理、无重复渲染；
- 验证模式开关：退出后 3/5 秒不被重挂、刷新保持关闭、入口可回开、滚动锁写入与还原（`tests/switch_test.py`，23 项）。

### 8.3 L3 真实站点测试（需登录态）——已执行 58/58 PASS
运行：`python tests/e2e_real.py`（首次带窗口扫码登录一次，之后无头复用）；结果落 `project-context/research/artifacts/l3-report.json`。

覆盖与实测结论（均为真实登录态、真实页面）：
- **整卷**（`/politics/paper/real-2026`）：33 张题卡；题号/题型/分值/已作答/全站均分（25 / 50）与原生逐项一致；**题干 HTML 长度与原生完全相同（213 字符）**，富文本无丢失。
- **写回链路**：按 B → 原生 `.pb-opt.picked` 真的被选中（`picked=1`），已作答计数同步 1/33，单选自动切第 2 题。
- **答题卡**：33 格；跳回第 1 题恢复已选 `B`。
- **持久化**：跳到第 10 题刷新后仍停在第 10 题；题面批注笔迹刷新后恢复。
- **题面批注**：画布与题卡同尺寸（858×715，误差 ≤2px）；真实鼠标在题卡上画出的笔迹按题目落盘（整卷 `pol:immersive-scratch:real-2026:16240`）；换题画布清零、切回原题恢复；练习页 `.pb-card` 无任何原生 id，改用内容指纹键（`…:c1jd6knihzjed4`）。
- **交卷**：仅末题出现交卷按钮，确认面板给出「已作答 1 / 33、未作答 32、用时」；取消后**未发出任何 `POST /submit`**（监听网络确认），不产生真实提交。
- **移动端**：390×844 覆盖层铺满、`scrollWidth` 无横向溢出。
- **练习页**（`/politics/practice/realsub-马原`）：总题数取原生答题卡格数 150（此前误判为 1 题）；当前位置与 `.pb-cell.cur` 一致；按一次 → 只前进一题；答题卡跳转真的驱动原生切到第 10 题；选项写回原生选中态。
- **列表页**（`/politics/books`、`/politics/mocks`）：无题卡时不误挂载。
- **模式开关**：开启态默认挂载；点退出立即移除覆盖层并写入 `pol:immersive-enabled=0`；**退出后 3/6/10 秒均未被自动重新挂载**（站点计时器持续改 DOM 的条件下）；刷新后仍不挂载；右下角入口存在且点击后重新挂载、状态回 `1`。
- **滚动锁**：挂载时 `html/body` 的 `overflow` 为 `hidden`，题目卡自身仍 `overflow-y:auto`；退出后两者还原为空串、`paddingRight` 清空，页面恢复可滚动（`scrollHeight` 12144 > 视口 900）。
- 全程无未捕获异常。

真实站点测试暴露并已修复的 7 个实现缺陷（L1/L2 无法发现）：
1. **SPA 首屏晚于脚本注入**：`boot()` 只在启动跑一次，题卡未渲染即返回且未装 MutationObserver，导致真实站点根本不挂载 → 改为启动即装观察器 + 400ms 兜底轮询 + 重入保护。
2. **练习页一屏一卡**：原先用题卡数当总数，练习页显示「第 1 / 1 题」→ 改为按原生 `.pb-cell` 格数取总数、`.cur` 取位置，翻页/跳转驱动原生答题卡。
3. **`CSS.escape` 被站点覆盖**：写回作答时抛 `CSS.escape is not a function`，作答静默失败 → 自带宽字符转义兜底。
4. **方向键被处理两次**：原生页也有方向键快捷键，导致按一次跳两题 → 命中白名单后 `preventDefault + stopPropagation`，并以原生 `.cur` 回读校准位置。
5. **退出后自动重挂**：退出只清内存，`MutationObserver` + 兜底轮询 + 站点每秒 DOM 变更会在 250–650ms 内重建覆盖层 → 引入持久开关（§6.9），关闭态下观察器只维护入口、绝不挂载。
6. **视口右侧常驻滚动条**：覆盖层是 `fixed inset:0`，但视口滚动条属于根滚动容器 → 挂载时锁 `html/body` 的 `overflow` 并记录原值，退出还原；长题干改为卡内细滚动条。
7. **练习页题目没有身份**：`.pb-card` 上没有任何 `id`/`data-*`，原生也不写 localStorage 草稿，批注若按题号存，练习集换序就会串题 → 增设「题干+选项」内容指纹（双 FNV 哈希）作为题目身份。

### 8.4 验收清单（内联基准，源自任务需求）
按组逐项标记 PASS / FAIL / NOT RUN：
- **基础**：一屏一题、题目数/题型/分值/总分/均分正确、计时正常。
- **键盘**：A-D 与 1-4、单选自动切、多选连续选、Enter 切、快按不跳、不干扰输入框/草稿纸。
- **保存**：每次选择即存、返回恢复、改答覆盖、刷新恢复、重开恢复、计时恢复、试卷隔离。
- **答题卡**：全题号、三态、点击跳转、答案恢复。
- **题面批注**：鼠标/触屏/触控笔就地绘画、橡皮、撤销、清空、每题独立、滚动锚定、resize 不丢、刷新恢复。
- **交卷**：前面无交卷按钮、末题有、未作答统计、二次确认、提交状态正确、不重复提交。
- **工程**：格式/静态检查、脚本语法检查、L1/L2 测试、L3（有登录态时）、桌面+移动布局。

动效（motion-lab）为**增强项**，不列为功能验收阻塞；核心验收聚焦上述功能组。

## 9. 边界与降级表
| 场景 | 识别方式 | 行为 |
|---|---|---|
| 交卷后解析页 `/politics/analysis*` | 路由 | 不注入沉浸界面（或仅提示"本次 exams 已结束"），不破坏原生 |
| 错题/待复习/收藏页 `/politics/wrong|review|favorites` | 路由 + DOM | FallbackAdapter 尽力抽取题干；无可识别题目则提示不支持，保留原页面 |
| 列表页（`/politics/books`、`/politics/bank/*` 根） | DOM 无题目容器 | 正确判定"无可识别题目"，静默不注入 |
| 登录失效 / API 401 | fetch 状态 | 提示先登录，不伪造数据；保留原页面 |
| 草稿 24h 过期（`startedAt` 超限） | 原生键时间戳 | 提示重开考试，不偷偷重新计时 |
| 同一 paperId 多标签页并发 | storage 事件 | 以最后一次写入为准 + 提示，避免静默覆盖 |
| 公式/图片在 Shadow DOM 丢失（F-4） | 实测含公式题 | 优先 `cloneNode(true)` 保留原生已渲染节点；必要时 adoptedStyleSheets 引入站点公式 CSS |
| SPA 路由切换 | history + MutationObserver（防抖、过滤自身节点） | detect 变化则销毁旧 Shadow Host 再重建；`beforeunload` disconnect |

## 10. 明确不做的边界
- 不伪造题目、答案、分值、均分、提交结果。
- 不绕过登录、权限或访问控制。
- 不破坏原网站原有题目数据与提交逻辑。
- 不硬编码 33 题 / 50 分 / 固定题号映射（N、满分均为运行时值）。
- 不引入大型 UI 框架。

## 11. 交付物
1. 修改/新增文件清单。
2. 核心方案与技术选型。
3. 键盘快捷键说明。
4. 保存与恢复机制。
5. 题面批注（草稿纸）实现。
6. 运行/安装方式（Tampermonkey）。
7. 实际执行的测试命令。
8. 测试结果与未覆盖场景（区分已实现/已测试/未验证）。

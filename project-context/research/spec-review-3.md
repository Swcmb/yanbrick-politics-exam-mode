# 设计规格批判性技术审查报告 · spec-review-3（第三轮 / 最终复审）

- **审查对象**：`specs/2026-11-17-immersive-exam-mode-design.md`（第二轮修订版 + §2.7 新增门禁记录）
- **对照基准**：`research/spec-review-1.md`（5 BLOCKING）、`research/spec-review-2.md`（R-1~R-6 BLOCKING）
- **新增证据**：`research/artifacts/Paper.bundle.js`、`research/artifacts/PoliticsApp.bundle.js`（本轮新增落盘，已可 grep 复核）
- **审查日期**：2026-11-17
- **审查角色**：资深前端 / 浏览器自动化架构师（最终裁决）
- **最终裁决**：**APPROVED_WITH_CHANGES**（见第 6 节，2 项必须改 + 3 项非阻塞建议）

---

## 0. 本轮方法与证据级别

沿用标签：**【事实-规格】**规格原文；**【事实-bundle】**本轮从两份 bundle 直接 grep 出的代码片段（可复核）；**【推测】**工程判断。

**【事实-bundle】** 两份 bundle 已落盘（`Paper.bundle.js` 14156 字符 / `PoliticsApp.bundle.js` 10219 字符，均为压缩单行 JS）。这直接关闭了第二轮 §0.1、R-4 的"证据不可复核"质疑——本轮所有断言均可通过 `grep` 或字符偏移复核。

**审查声明**：全程只读——读了 3 份文档 + 2 份 bundle，未改规格，未运行任何访问目标站点或提交答案的命令。报告中"按 End 直达第 33 题"等浏览器实测结论**我无法复核截图本身**（artifacts 目录只有两个 bundle，无截图），只能核验其与 bundle 代码逻辑是否自洽。

---

## 1. 关键方法：跨 chunk 的混淆变量名必须经 export 映射还原（本轮核心证据）

规格 §2.5/§2.7 用 `xe(code)`、`je(code)`、`Ne(chapter)` 描述调用链。第二轮曾批评这是"无出处的混淆变量名"。本轮证实：**这些名字是 Paper chunk 的 import 别名，与 PoliticsApp chunk 内部的同名变量不是一回事**，必须经 export 表还原才能对应到真实接口。

**【事实-bundle】** `Paper.bundle.js` 头部：

```
import{l as je,b as xe,m as ge,c as Ne,o as te,n as ne,p as ke,q as ye,r as Se,L as ve}from"./PoliticsApp-CV-MCChx.js"
```

**【事实-bundle】** `PoliticsApp.bundle.js` 尾部 export 映射（节选）：

```
export{... Ee as l, ... le as b, re as c, ... Oe as m, ... ke as q, ... ye as x, Ae as r ...}
```

据此还原（Paper 别名 → PoliticsApp 内部函数 → 真实接口）：

| Paper 别名 | 导出名 | 内部函数定义 | 真实接口 |
|---|---|---|---|
| `xe` | b | `le=e=>n('/banks/${e}')` | **GET /banks/{code}** |
| `je` | l | `Ee=e=>n('/mixed/${e}')` | **GET /mixed/{code}** |
| `Ne` | c | `re=e=>n('/chapters/${e}')` | **GET /chapters/{code}** |
| `ke` | q | `ke=(e,s,a)=>c('/papers/${e}/submit','POST',{answers,durationSec})` | **POST /papers/{code}/submit** |
| `ye` | x | `ye=(e,s)=>c('/review/${e}/grade','POST',{result})` | **POST /review/{code}/grade** |
| `Se` | r | `Ae=e=>n('/papers/attempt/${e}')` | **GET /papers/attempt/{e}** |
| `te` | o | `Re=e=>n('/papers/history...')` | GET /papers/history |
| — | d | `pe=e=>n('/chapters/${e}/answers')` | GET /chapters/{code}/answers |

**重要旁证**：PoliticsApp 内部确有名为 `xe`、`je` 的函数，但分别是 `xe=e=>n('/favorites?page=..')`、`je=(e,s)=>c('/questions/${e}/graduated','PUT')`——与 Paper 的 `xe`/`je` **完全无关**。规格若在写作时直接把 PoliticsApp 内部的 `xe`/`je` 当成 Paper 调用链，就会得出错误接口结论（见 R-3）。

**【事实-bundle】** PoliticsApp 全部 GET 封装清单：`/banks`、`/banks/{code}`、`/real-subjects`、`/chapters/{code}`、`/chapters/{code}/answers`、`/wrong`、`/wrong/banks`、`/favorites`、`/favorites/ids`、`/review/due`、`/mixed/{code}`、`/papers/history`、`/papers/attempt/{e}`、`/stats`、`/analysis...`、`/shelf...`。**其中不存在 `GET /papers/{code}`。**

---

## 2. R-1~R-6 逐条核验

### R-1（原生题卡渲染方式）— ✅ 实质关闭

**【事实-bundle】** `Paper.bundle.js` 题卡列表为 `e.jsx('ol',{className:'pb-paper-list',children:l.map((s,t)=>...e.jsxs('li',{id:'pb-pq-${s.id}'...`，答题卡矩阵同为 `l.map(...)`。**是一次性 `map` 铺开全部题卡到 `<ol>`，无虚拟滚动 / 无分页 / 无窗口化**，与"按 End 直达第 33 题、四选项完整渲染、底部交卷（已作答 0/33）"的实测截图结论逻辑自洽。

**【事实-bundle】** 分值标签 `s.type==='multi'?'多选 2分':'单选 1分'` 确认存在，与 §2.3"第 1 题单选 1分、第 33 题多选 2分"一致。

**证据链自洽性判定**：逻辑侧（bundle 全量 map）成立；截图侧未落盘但结论与代码一致。**自洽，关闭。** 第二轮最根本的"API-driven 关读、S-1 写回又依赖 DOM"矛盾，因 R-1 补上"原生节点常驻 DOM"这一前提而闭环（详见第 3 节）。

### R-2（节点引用失效）— ✅ 真正关闭

**【事实-规格】** §6.7 写回伪代码（规格 @225–239）确已写死四要素：① 每次 `document.querySelector('[id*="${q.id}"]')` **重新定位**并注明"不用 load() 时抓的引用"；② `if !card or !card.isConnected` 与 `if !opt or !opt.isConnected` 双重校验；③ 注释"禁止缓存 DOM 节点引用"；④ 成功判据"回读原生 `picked`，确认已含本次 keys"，失败 `return FAIL → toast '作答未保存，请重试'（不谎称已保存）`。**逐字落实，真正关闭。**

### R-3（组卷会话一致性 / 数据真实性红线）— ⚠️ 策略已关闭，但事实断言有误 — 列入必须改

**（a）安全策略到位（应肯定）**：**【事实-规格】** §2.7 R-3 写入"脚本不得调任何会生成新卷的组卷接口，只读 {code} 对应卷；若某 mock code 无法只读定位，则该界面降级为 DOM 驱动 + 提示"。这条**兜底**保证了即使接口判断失误，脚本也不会显示与原生判分不一致的题——第二轮 R-3 的核心红线（"脚本显示的题 == 原生判分的题"）在**策略层已受控，不判 BLOCKED**。

**（b）但事实断言错误，且写在"已实测证据"章节，必须改**：

- **【事实-bundle】** 规格称"整卷读取 `GET /api/politics/papers/{code}`（by code 固定，幂等）"——**该接口不存在**（见第 1 节 GET 全清单）。真实读卷是 `GET /banks/{code}`（元信息，含 `chapters[]`/`aveScore`/`kind`）+ `GET /chapters/{code}`（返回体含 `questions[]`）；随机组卷是 `GET /mixed/{code}`（Paper `je(c)` 分支，返回 `a.questions`）。实现者若照字面 fetch `/papers/{code}` 会 404。
- **【事实-bundle】** 规格 §2.5 与 §2.7 称 `Ne(chapter)` 从 `/api/politics/chapters/{code}/answers` 拿题目——**真实调用是 `Ne` = `GET /chapters/{code}`（无 `/answers` 后缀）**；`/chapters/{code}/answers` 对应的是未被 Paper import 的 `pe`（导出 d）。"一次拿完整 questions[]"的结论方向对，但路径写错。
- **【事实-bundle】** 交卷接口规格只列 `POST /papers/{code}/submit`；bundle 显示存在**两个**交卷路径：`ke` = `POST /papers/{code}/submit`（`i` 为真分支）与 `ye` = `POST /review/{code}/grade`（另一分支），规格遗漏后者。
- **证据缺口**：第二轮 R-3 明确要求"给出响应 JSON 结构证据（录制片段或 fixture）"，artifacts 目录只有请求封装 bundle，**无响应样本**。随机组卷 `GET /mixed/{code}` 是否对同一 code 幂等（同卷同题），bundle 的封装代码无法证明，属服务端语义，仍需实测或按保守策略处理。

**结论**：红线策略已闭环，但接口路径错误 + 响应证据缺失构成"必须改的准确性缺陷"，非阻塞实现但不得原样保留。

### R-4（证据可追溯）— ✅ 真正关闭

**【事实-bundle】** 两份 bundle 已落盘 `research/artifacts/`，本轮全部结论均可 grep 复核。§2.3/§2.5/§2.7 已指向该快照。真正关闭。

### R-5（交卷选择器与弹窗层级）— ✅ 真正关闭

**【事实-bundle】** `className:'pb-submit',onClick:q,disabled:w,children:w?'判分中…':'交卷'`、`...children:\`交卷（已作答 ${_}/${l.length}）\`` —— `.pb-submit` 真实存在，与 §2.7"bundle 原文 `className:'pb-submit',onClick:q`、文案'交卷（已作答 N/M）'"完全一致。

**【事实-规格】** §6.7 @241 已写入层级约束：脚本 Shadow Host `z-index` 低于原生对话框/确认弹窗；脚本覆盖层不拦截原生弹窗点击；确认交原生、不叠加双重确认；脚本确认面板仅在"点击交卷→触发原生 click"之间出现一次后隐身让位。**真正关闭。**

（注：bundle 中交卷 `q()` 函数内未见原生二次确认弹窗，直接 `POST` 后 `t.ok===!1` 才 alert——规格的"让位原生弹窗"是保守无害设计，不构成问题。）

### R-6（分值来源矛盾）— ✅ 真正关闭

**【事实-规格】** §2.3 @42 已改为"**单题分值只取自真实字段或 DOM 的 `+N分` 标签**……取不到为 `null`。**严禁由整卷满分/题型反推单题分值**"——原"由整卷满分/题型推导"措辞已删除；§4 @115 `score: number | null // 不臆造、不从满分反推` 与之一致。**真正关闭。**

---

## 3. 新增内部矛盾专项检查（用户指定：§2.5 vs §2.7 关于 D-2）

**判定：不冲突，且正好闭环第二轮的核心矛盾。**

- §2.5 D-2 行：PaperAdapter 一律 API-driven、读取端**不依赖 DOM 是否虚拟滚动**；
- §2.7 R-1 行：实测**非虚拟滚动、原生节点常驻 DOM**，使 S-1 写回链路成立。

二者是**读取端 vs 写回端**的互补关系：第二轮指出"API-driven 关了读、写回却依赖被绕过的未知"，正是靠 §2.7 补上的写回前提消解的。逻辑自洽，**无新增冲突**。

**需一并修正的措辞瑕疵（并入必须改项 1）**：§2.5 把 `Ne(chapter)` 的接口写成 `/chapters/{code}/answers`，而 bundle 中 `Ne`=`GET /chapters/{code}`；该节与 §2.7 在"题目来自哪个接口"上表述不一致，应统一为经 export 还原的真实接口。

---

## 4. 其余遗留项复核（非本轮门禁，确认无回退）

| 项 | 状态 | 说明 |
|---|---|---|
| F-1 CSP / F-2 同源 fetch / F-3 键盘白名单 / S-2 键职责分离 / C-1 total 来源 / C-2 选项动态 / C-3 边界表 / D-4 均分不本地算 / 三层测试 / 动效降级 / 两个 §10 编号 | ✅ 保持关闭 | 第二轮已确认，本轮规格无回退 |
| 登录态表述 | ✅ 已澄清 | §2.1 明确"脚本注入页面登录态"≠"L3 的 storageState" |
| §8.4 标题 | ✅ 已改 | 现为"内联基准，源自任务需求"，不再引用不可见任务文件 |

---

## 5. 逐维度 verdict

| 维度 | 裁决 | 说明 |
|---|---|---|
| 1. 可行性 | ✅ 通过 | CSP/注入实测关闭，机制成立 |
| 2. 数据真实性 | ⚠️ 小修 | R-3 红线策略到位，但接口路径事实错误 + 响应证据缺失 |
| 3. 复用原生状态 | ✅ 通过 | R-2 伪代码写死、R-5 选择器与层级确认 |
| 4. 可测试性 | ✅ 通过 | 三层分工齐备 |
| 5. 兼容性 | ✅ 通过 | 无回退 |
| 6. 规格质量 | ⚠️ 小修 | §2.5/§2.7 接口路径需据 bundle 更正 |

---

## 6. 最终裁决

### **APPROVED_WITH_CHANGES**

**裁决理由**：R-1、R-2、R-4、R-5、R-6 已实质或真正关闭，证据链本轮已可复核；R-3 的**会话一致性安全策略与降级兜底已到位，数据真实性红线受控**，故**不判 BLOCKED**，架构可进入实现。但 R-3 在"已实测证据"章节写入了 bundle 中不存在的接口（`GET /papers/{code}`）并写错题目接口路径，属于会误导实现的事实性错误，必须更正后才算干净放行。这不是为严格而制造问题——它有确凿的 bundle 反证。

### 6.1 必须改（2 项，均 R-3 相关；改完即可进入实现，无需再复审）

1. **更正 §2.7 R-3 与 §2.5 的接口事实**：删除不存在的 `GET /api/politics/papers/{code}`。按第 1 节 export 还原写真实链路——读卷元信息 `GET /banks/{code}`、读题目 `GET /chapters/{code}`（响应含 `questions[]`）、随机组卷 `GET /mixed/{code}`、交卷 `POST /papers/{code}/submit` 与 `POST /review/{code}/grade`（两分支）；`GET /chapters/{code}/answers` 与 `Ne` 不再混写。**保留**"按 code 只读、禁调组卷接口、无法只读定位则降级 DOM 驱动 + 提示"的核心约束（这条是对的，不动）。
2. **补齐 R-3 的幂等性证据或保守策略声明**：在 artifacts 补一份 `GET /mixed/{code}` / `GET /chapters/{code}` 的响应 JSON 录制片段或 fixture；若无法实测，则在 §2.7 明写保守策略——"同一 code 全程复用首次 fetch 的题目集合，绝不二次 fetch 任何组卷接口；一旦发现题集与原生不一致立即降级 DOM 驱动并提示"。满足第二轮 R-3 对"响应结构证据"的要求。

### 6.2 非阻塞建议（可并行，不阻断）

- §2.7 R-1 的"按 End 直达第 33 题"截图补一张到 `artifacts/`，使截图侧证据也落盘（当前靠 bundle `l.map` 逻辑闭合，已可接受）。
- 统一 §2.3/§6.2 分值措辞：bundle 中 DOM 标签实为"单选 1分/多选 2分"且按 `type` 文本渲染，并非"+N分"格式；说明脚本读取的是页面显示文本，避免"分值字段"歧义。
- §2.5 把 `re(chapterCode)` 描述为"章节码解析"可精修——Paper 中本地 `re(h)` 实为 setState；接口链只保留 `xe→Ne` 两级。

---

## 7. 审查声明

- 本轮仅只读审查：读取 3 份文档 + 2 份 bundle，未修改设计规格，未运行任何访问目标站点或提交答案的命令。
- 本报告为新增文件 `research/spec-review-3.md`，不动规格原文。
- 6.1 两项均为文档准确性修正，属只读编辑范畴，无站点副作用；改完无需再次子代理复审即可进入实现。

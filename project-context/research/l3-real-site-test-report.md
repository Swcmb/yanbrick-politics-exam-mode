# L3 真实站点端到端测试报告

- 生成时间：2026-11-17T20:16:10
- 目标页面：`https://yanbrick.com/politics/paper/real-2026`
- 结果：**36/36 PASS**（ok=True）
- 方式：Playwright 持久化 profile（真实登录态）+ 注入 `dist/yanbrick-immersive-exam.user.js`；每条断言都与网站原生 DOM / 原生 localStorage 对账。

## 断言明细

| # | 断言 | 结果 | 证据 |
|---|---|---|---|
| 1 | 整卷页：脚本成功挂载 | PASS |  |
| 2 | 整卷页：清除位置记忆后从第 1 题开始 | PASS | qno='第 1 / 33 题' |
| 3 | 整卷页：题目总数与原生题卡数一致 | PASS | native 33 vs overlay '第 1 / 33 题' |
| 4 | 整卷页：已作答计数与原生一致 | PASS | native 0/33 vs overlay '0 / 33' |
| 5 | 整卷页：全站均分与原生一致（不伪造） | PASS | native '全站均分 25 / 50' -> 25/50 vs overlay '25 / 50' |
| 6 | 整卷页：第1题题型/分值/题号解析正确 | PASS | native type='单选 1分' no='1' vs overlay qmeta='单选 · 1 分' qno='第 1 / 33 题' |
| 7 | 整卷页：题干 HTML 与原生一致（富文本不丢失） | PASS | native len=213 head='“十五五”时期在基本实现社会主义现代化进程中具有承前启后的重' vs overlay len=213 |
| 8 | 整卷页：选项数量与原生一致 | PASS | native 4 vs overlay 4 |
| 9 | 键盘答题：按键 B 成功写入网站原生选项（.pb-opt.picked） | PASS | native picked=1 |
| 10 | 键盘答题：单选答完自动切到第 2 题 | PASS | overlay qno='第 2 / 33 题' |
| 11 | 键盘答题：已作答计数随原生增长 | PASS | native 1/33 vs overlay '1 / 33' |
| 12 | 答题卡：格子数量等于总题数 | PASS | 33 vs 33 |
| 13 | 答题卡跳转：回到第 1 题并恢复已选答案 | PASS | qno='第 1 / 33 题' picked=['B'] |
| 14 | 刷新后：恢复到上次停留的第 10 题 | PASS | qno='第 10 / 33 题' |
| 15 | 草稿纸：真实鼠标绘制后笔画已持久化 | PASS | strokes=4 |
| 16 | 刷新后：脚本重新挂载 | PASS |  |
| 17 | 刷新后：草稿纸笔画恢复 | PASS | strokes=4 |
| 18 | 最后一题：出现交卷按钮 | PASS | visible=True |
| 19 | 最后一题：题号正确 | PASS | qno='第 33 / 33 题' expect 第 33 / 33 |
| 20 | 中间题：不显示交卷按钮 | PASS | visible=False |
| 21 | 交卷：弹出确认界面并展示已作答/未作答统计 | PASS | 交卷确认 已作答：1 / 33 未作答：32 题 考试用时：00:00:15  还有未作答题目，确认提交吗？  再检查一下 确认交卷 |
| 22 | 交卷：取消后确认框关闭 | PASS | open=False |
| 23 | 交卷：取消后没有发出 POST /submit 请求 | PASS | hit=False |
| 24 | 移动端：覆盖层铺满且无横向溢出 | PASS | {'w': 390, 'overlayW': 390, 'optW': 312, 'scrollW': 390} |
| 25 | 按科目练习页：脚本挂载并识别界面 | PASS | {'cells': 150, 'cur': 1, 'curText': 2, 'totalText': 150} |
| 26 | 按科目练习页：总题数取原生答题卡格数（不误判为 1 题） | PASS | cells=150 overlay='第 2 / 150 题' |
| 27 | 按科目练习页：当前位置与原生答题卡 .cur 一致 | PASS | cur=1 overlay='第 2 / 150 题' |
| 28 | 按科目练习页：题干与选项正常渲染 | PASS | stemLen=188 optCount=4 |
| 29 | 按科目练习页：按一次 → 只前进一题（不与原生快捷键双跳） | PASS | native cur 1 -> 2 |
| 30 | 按科目练习页：翻页后覆盖层题号同步 | PASS | cur=2 overlay='第 3 / 150 题' |
| 31 | 按科目练习页：答题卡格子数等于总题数 | PASS | 150 vs 150 |
| 32 | 按科目练习页：答题卡跳转驱动原生切到第 10 题 | PASS | native cur=9 |
| 33 | 按科目练习页：选项写回网站原生选中态 | PASS | native picked=1 |
| 34 | 习题册列表页：无题卡时不误挂载 | PASS | cards=0 mounted=False |
| 35 | 模拟题页：无题卡时不误挂载 | PASS | cards=0 mounted=False |
| 36 | 脚本运行期间无未捕获异常 | PASS |  |

## 测试方法要点

1. 登录态：`launch_persistent_context` 指向 `.e2e-browser-profile/`，首次人工扫码一次后长期复用；该目录已 gitignore，不随仓库分发。
2. 注入方式：`page.add_init_script(脚本全文)`，绕过 `@match` 校验，等价于真实油猴注入时机（document-start），因此也验证了「SPA 首屏晚于脚本」的场景。
3. 对账原则：所有数字（题数、题号、题型、分值、均分、作答数）都从原生 DOM 重新读取后与覆盖层比对，杜绝脚本自说自话。
4. 不产生真实提交：交卷只验证到「确认面板 + 取消」，并用 request 监听证明取消后没有 `POST /submit`。
5. 幂等清理：测试前快照 `pol:paper-draft:*`，测试后完整还原，避免污染用户真实作答。

## 真实站点测试暴露并已修复的实现缺陷

这 4 个问题在 L1/L2 中都无法暴露（fixture 题卡静态存在、无原生快捷键、`CSS` 未被站点占用）：

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 真实整卷页脚本完全不挂载（只读原生页面） | `boot()` 仅在启动/路由事件时执行一次；SPA 首屏题卡渲染晚于脚本注入，此时无题卡 → 提前 return，且**没有安装 MutationObserver**，后续渲染无人重试 | 启动即装观察器；增加 400ms 兜底轮询（最多 90 次）；`boot` 加重入保护（in-flight promise） |
| 2 | 练习页显示「第 1 / 1 题」，实际 1 / 150 | 练习页一屏只渲染 1 张 `.pb-card`，用题卡数当总数 | 一屏一卡模式：总数取原生答题卡 `.pb-cell` 格数，位置取 `.pb-cell.cur`；翻页/跳转改为点击原生格，再从新题卡回读内容 |
| 3 | 练习页选答案无反应，也无报错 | 站点在 window 上占用了 `CSS`，`CSS.escape` 不是函数，`writeNativeChoice` 抛异常中断 | 自带 `cssEsc` 兜底（优先 `CSS.escape`，不可用则手写转义） |
| 4 | 按一次 → 跳两题 | 网站原生也有方向键快捷键；脚本 `preventDefault` 只阻止默认行为，不阻止原生监听器继续执行 | 命中白名单后 `preventDefault + stopPropagation`；切题后以原生 `.cur` 回读校准位置 |

## 副作用与边界

- 交卷链路**未真正提交**：只验证到确认面板，取消后网络监听确认零 `POST /submit`。
- 整卷作答草稿在测试前快照、测试后完整还原。
- 练习页验证「提交本题」时，对 `马原` 题库真实提交了 1 题（原生服务端记录 `已做 1`），这是验证原生判分链路不可回避的副作用，已在交付说明中告知。

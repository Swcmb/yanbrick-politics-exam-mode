/*
 * 构建：把 src/core.js 内联进 src/main.js，产出单文件油猴脚本。
 * 用法：node build.js
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');

// 顺序：core(纯逻辑，挂 globalThis.ImmersiveCore) → main(适配器/工具) → ui(渲染/草稿纸) → boot(事件/生命周期)
const core = read('core.js');
const main = read('main.js');
const ui = read('ui.js');
const boot = read('boot.js');

const MARKER = '/* __CORE_INLINE__ */';
if (!main.includes(MARKER)) {
  console.error('构建失败：main.js 缺少 core 注入标记');
  process.exit(1);
}
const mainWithCore = main.replace(MARKER, core);
const out = mainWithCore + '\n' + ui + '\n' + boot;

const dest = path.join(root, 'dist', 'yanbrick-immersive-exam.user.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');
console.log(`已生成 ${dest} (${Buffer.byteLength(out)} bytes)`);

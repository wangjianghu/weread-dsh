/* 布局复现工具：真实 React 渲染 Settings → vnode JSON + CSS → 无头 Chrome 量几何。
 * 用法：node tools/layout-repro.mjs [--shot]   （--shot 额外存截图 /tmp/wr-layout.png）
 * 目的：诊断「模块 title 与内容行是否同行」——输出每张卡片内各子块的 x/y/w/h。 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
const React = require_('react');
const TestRenderer = require_('react-test-renderer');

// ---- 1. 加载 client.js，捕获 W（同 rmsmoke 的注入手法）----
let code = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
code = code.replace('return {\n      inject:', 'window.__W = W; return {\n      inject:');
let W = null;
const sandbox = {
  window: { localStorage: { getItem: () => null, setItem: () => { } } },
  document: {
    createElement: () => ({ click() { }, style: {} }),
    addEventListener() { }, removeEventListener() { },
    body: { appendChild() { }, removeChild() { } },
  },
  fetch: async () => { throw new Error('offline'); },
  URLSearchParams, URL,
  setInterval: () => 0, clearInterval: () => { }, setTimeout: () => 0, clearTimeout: () => { },
  requestAnimationFrame: (f) => { setTimeout(f, 0); },
  console,
};
sandbox.window.__ModuleLoader__ = {
  load(mod) {
    const req = (name) => (name === 'react' ? React : (() => { throw new Error('unexpected require ' + name); })());
    mod.factory(req);
    W = sandbox.window.__W;
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'client.js' });
if (!W) throw new Error('W 未捕获');
W.setLang && W.setLang('zh');

// ---- 2. 真实渲染 Settings（两账号 + 官方通道已绑定，贴近用户实况）----
const state = {
  config: {}, loggedIn: true,
  accounts: [
    { id: 'a1', name: '账号一（活跃）' },
    { id: 'a2', name: '账号二' },
  ],
  account: { id: 'a1' },
  validation: { status: 'passed', summary: 'passed' },
  gateway: { enabled: true, keyTail: 'ab12' },
  syncState: { status: 'idle' },
};
const tr = TestRenderer.create(React.createElement(W.Settings, { state, onToast: () => { }, refreshState: async () => { } }));

// ---- 3. vnode → 纯 JSON（保留 className/children/text）----
const toJson = (node) => {
  if (node == null || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  const inst = node; // TestInstance
  if (typeof inst.type === 'string' || inst.type == null) {
    const props = inst.props || {};
    return {
      tag: typeof inst.type === 'string' ? inst.type : String(inst.type),
      className: typeof props.className === 'string' ? props.className : undefined,
      style: props.style || undefined,
      title: typeof props.title === 'string' ? props.title : undefined,
      children: inst.children.map(toJson).filter(Boolean),
    };
  }
  return { children: inst.children.map(toJson).filter(Boolean) };
};
const tree = toJson(tr.root);

// ---- 4. 生成 HTML：CSS（组件真实用到的两段）+ DOM 重建 + 几何测量 ----
const css = (W.BASE_CSS || '') + '\n' + (W.CSS_50 || '');
const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
:root{
  --dsw-alias-border-l1:#d8dee4;--dsw-alias-border-l2:#c2c9d0;
  --dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f6f8fa;--dsw-alias-bg-overlay:#fff;
  --dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#57606a;
  --dsw-alias-brand-primary:#0969da;--dsw-alias-success:#1a7f37;--dsw-alias-danger:#cf222e;
}
html,body{margin:0;padding:0;background:#eaeef2}
/* 模拟 DSH 宿主：宽面板 + 祖先容器（container-type），验证卡片永不并排 */
#panel{width:1800px;height:1500px;margin:0 auto;background:#fff;overflow:hidden;container-type:inline-size}
</style>
<style>${css.replace(/<\/style/gi, '<\\/style')}</style>
</head><body><div id="panel"><div id="root"></div></div>
<script>
const TREE = ${JSON.stringify(tree)};
function build(n, parent){
  if(n.text != null){ parent.appendChild(document.createTextNode(n.text)); return; }
  if(!n.tag){ (n.children||[]).forEach(c=>build(c,parent)); return; }
  if(n.tag==='style'){ const s=document.createElement('style'); s.textContent=(n.children||[]).map(c=>c.text||'').join(''); document.head.appendChild(s); return; }
  const el=document.createElement(n.tag);
  if(n.className) el.className=n.className;
  if(n.title) el.title=n.title;
  if(n.style) for(const [k,v] of Object.entries(n.style)) el.style[k]=v;
  parent.appendChild(el);
  (n.children||[]).forEach(c=>build(c,el));
}
build(TREE, document.getElementById('root'));
// --hostile：模拟宿主在文档流末尾注入横向布局（last-rule 胜出），验证 v1.8.17 防御
if (location.search.includes('hostile')) {
  const hs = document.createElement('style');
  hs.textContent = '.wr-card{display:flex!important;flex-wrap:wrap!important;align-items:center!important}';
  document.head.appendChild(hs);
}
// ---- 几何测量：每张卡片的直接子块坐标 ----
const out=[];
document.querySelectorAll('.wr-set-card').forEach((card,ci)=>{
  const cr=card.getBoundingClientRect();
  const row={card:ci, cls:card.className, rect:[cr.x,cr.y,cr.width,cr.height], children:[]};
  [...card.children].forEach(ch=>{
    const r=ch.getBoundingClientRect();
    const txt=(ch.textContent||'').trim().slice(0,24);
    row.children.push({cls:ch.className||ch.tagName, x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), txt});
  });
  out.push(row);
});
const grid=document.querySelector('.wr-set-grid');
const gs=grid?getComputedStyle(grid):null;
const res={gridDisplay:gs&&gs.display, gridCols:gs&&gs.gridTemplateColumns, cards:out};
// v1.9.22：保存条对齐测量——「保存并应用」按钮右缘、底条两缘、表单控件右缘、卡片内容区两缘。
// 保存条靠负外边距铺到卡片两边缘；卡片直接子元素的 max-width 卡宽会让负外边距只在左侧生效。
const fc=document.querySelector('.wr-set-card--form')||document.querySelector('.wr-set-card');
const sb={};
if(fc){
  const fr=fc.getBoundingClientRect(), fs=getComputedStyle(fc);
  sb.innerLeft=fr.left+parseFloat(fs.borderLeftWidth)+parseFloat(fs.paddingLeft);
  sb.innerRight=fr.right-parseFloat(fs.borderRightWidth)-parseFloat(fs.paddingRight);
  const bar=fc.querySelector('.wr-save-bar'), btn=bar&&bar.querySelector('button');
  const sw=[...fc.querySelectorAll('.wr-switch')].pop(), fld=[...fc.querySelectorAll('.wr-set-field')].pop();
  if(bar){
    const br=bar.getBoundingClientRect(), bs=getComputedStyle(bar);
    sb.barLeft=br.left; sb.barRight=br.right; sb.barMaxWidth=bs.maxWidth;
    sb.barMarginLeft=parseFloat(bs.marginLeft); sb.barMarginRight=parseFloat(bs.marginRight); sb.barPaddingRight=parseFloat(bs.paddingRight);
  }
  if(btn){ const b=btn.getBoundingClientRect(); sb.buttonLeft=b.left; sb.buttonRight=b.right; }
  if(sw) sb.toggleRight=sw.getBoundingClientRect().right;
  if(fld) sb.fieldRight=fld.getBoundingClientRect().right;
}
res.saveBar=sb;
document.title='MEASURE_DONE';
const pre=document.createElement('pre'); pre.id='measure'; pre.textContent=JSON.stringify(res,null,1);
document.body.appendChild(pre);
</script></body></html>`;

const htmlPath = '/tmp/wr-layout-repro.html';
fs.writeFileSync(htmlPath, html);

// ---- 5. 无头 Chrome 渲染并取测量结果 ----
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
  '--user-data-dir=/tmp/chrome-wr-repro',
  `--screenshot=${process.argv.includes('--shot') ? '/tmp/wr-layout.png' : '/tmp/wr-layout-ns.png'}`,
  '--window-size=1900,1500', '--virtual-time-budget=4000', '--dump-dom', 'file://' + htmlPath + (process.argv.includes('--hostile') ? '?hostile=1' : '')];
const dom = execFileSync(chrome, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const m = dom.match(/<pre id="measure">([\s\S]*?)<\/pre>/);
if (!m) { console.error('✗ 未取到测量结果'); process.exit(1); }
const res = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
console.log('grid:', res.gridDisplay, '| cols:', res.gridCols);
for (const c of res.cards) {
  console.log(`\n卡片#${c.card} [${c.cls}] rect=${c.rect.map(Math.round)} "${c.children[0]?.txt}"`);
  for (const ch of c.children) console.log(`   x=${String(ch.x).padStart(4)} y=${String(ch.y).padStart(4)} ${String(ch.w).padStart(3)}x${String(ch.h).padStart(2)}  ${ch.cls.padEnd(42)} "${ch.txt}"`);
}

// ---- v1.9.22 --assert：保存条必须铺到卡片两边缘，「保存并应用」按钮右缘与表单控件右缘对齐 ----
// 不进 npm test（依赖本机 Chrome 路径）；改动设置页布局时手动跑：node tools/layout-repro.mjs --assert [--hostile]
const s = res.saveBar || {};
const near = (a, b, tol = 0.5) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const r1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '?');
if (process.argv.includes('--assert')) {
  console.log(`\n[保存条] 按钮右缘 ${r1(s.buttonRight)} | 开关右缘 ${r1(s.toggleRight)} | 输入框右缘 ${r1(s.fieldRight)} | 卡片内容区 ${r1(s.innerLeft)}–${r1(s.innerRight)}`);
  console.log(`[保存条] 底条 ${r1(s.barLeft)}–${r1(s.barRight)}（应 ${r1(s.innerLeft + s.barMarginLeft)}–${r1(s.innerRight - s.barMarginRight)}）| 外边距 ${s.barMarginLeft}/${s.barMarginRight} | max-width ${s.barMaxWidth}`);
  const checks = [
    ['「保存并应用」按钮右缘 = 开关右缘', near(s.buttonRight, s.toggleRight)],
    ['「保存并应用」按钮右缘 = 输入框右缘', !Number.isFinite(s.fieldRight) || near(s.buttonRight, s.fieldRight)],
    ['底条铺到卡片左内缘', near(s.barLeft, s.innerLeft + s.barMarginLeft)],
    ['底条铺到卡片右内缘', near(s.barRight, s.innerRight - s.barMarginRight)],
  ];
  let bad = 0;
  for (const [name, ok] of checks) { console.log(`  ${ok ? '✓' : '✗'} ${name}`); if (!ok) bad += 1; }
  if (!Number.isFinite(s.buttonRight)) { console.log('  ✗ 没量到保存条 / 按钮'); bad += 1; }
  if (bad) { console.error(`✗ 保存条对齐断言失败（${bad} 项）`); process.exit(1); }
  console.log('✓ 保存条对齐断言通过');
}

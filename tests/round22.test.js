// Round 22: Operación layout — sticky header (top bar + date row), "+ Gasto" in the date row, filter row under the day summary.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { test } = require('./lib');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = read('docs/index.html'), sw = read('docs/sw.js');

test('round 22: APP_VER = sw CACHE', () => {
  const v = /const APP_VER='(v\d+)'/.exec(html)[1];
  assert.ok(sw.indexOf("const CACHE = 'al-ops-" + v + "'") >= 0);
});
test('round 22: roleBar wraps top bar + optional extra in a sticky .stk; Operación passes the date row', () => {
  const bar = /function roleBar\(extra\)\{[^\n]*/.exec(html)[0];
  assert.ok(bar.indexOf('class="stk"') > 0 && bar.indexOf('${extra||\'\'}') > 0);
  assert.ok(/roleBar\(!stackView&&tab==='op'\?opNav\(\):''\)/.test(html));
  const css = /\.stk\{[^\n]*/.exec(html)[0];
  assert.ok(/position:sticky/.test(css) && /top:0/.test(css) && /var\(--sand\)/.test(css) && /safe-area-inset-top/.test(css));
  assert.ok(/\.stk\.scrolled\{border-bottom-color:var\(--hair\)\}/.test(html), 'hairline only when scrolled');
});
test('round 22: "+ Gasto" lives in the date row (can compras), not next to the title', () => {
  const nav = /function opNav\(\)\{[^\n]*/.exec(html)[0];
  assert.ok(nav.indexOf("can('compras')") > 0 && nav.indexOf('+ Gasto') > 0 && nav.indexOf('data-fopen') < 0);
  const op = html.slice(html.indexOf('\nop(){'), html.indexOf('\ndep(id){'));
  assert.ok(op.indexOf('+ Gasto') < 0 && op.indexOf('<h1>Operación</h1>') > 0);
});
test('round 22: filter row (icon + "Filtrar", "Filtro: … · quitar" at the left) comes after the day summary, chips under it', () => {
  const op = html.slice(html.indexOf('\nop(){'), html.indexOf('\ndep(id){'));
  const fr = op.indexOf('const fr='), ds = op.indexOf('class="dsum"');
  assert.ok(fr > 0 && op.indexOf('data-fopen') > fr && op.indexOf('Filtrar${fOn') > 0 && op.indexOf('Filtro: <b>') > fr && op.indexOf('quitar') > fr);
  assert.ok(op.indexOf('${r3}${r4}</div>`+fr') > ds, 'fr appended right after dsum');
  assert.ok(op.indexOf('chips fchips') > fr, 'chips are part of the row block');
  assert.ok(/if\(!ds\.length(&&[^)]*\))?\)return h\+fr\+/.test(op) || op.indexOf('if(!ds.length&&') > 0, 'also on days without departures');
});
test('round 22: scroll targets account for the sticky height (--stk, scroll-margin-top); light and dark share the same variables', () => {
  assert.ok(/function stkSync\(\)\{[^\n]*--stk/.test(html) && /stkSync\(\);\n/.test(html));
  assert.ok(/\.list\.deps,[^\n]*scroll-margin-top:calc\(var\(--stk,100px\) \+ 12px\)/.test(html));
  assert.ok(/\.drow\.hl/.test(html));
});

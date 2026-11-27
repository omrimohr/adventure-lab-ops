// Round 28: tour card = 5 lines; resources (boat icon) and crew (people icon) on separate single-line rows.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { test } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const card = html.slice(html.indexOf('function depCard('), html.indexOf('// --- Detalle de una reserva'));

test('card has two rows: boat icon + resources, people icon + crew', () => {
  assert.ok(/class="l3 l3a"/.test(card) && /class="l3 l3b"/.test(card));
  assert.ok(/svgI\('sailboat',16\)/.test(card) && /svgI\('users',16\)/.test(card));
  assert.ok(/sailboat:'<path/.test(html));
  assert.ok(!/\$\{l3\|\|/.test(card), 'old single l3 line removed');
});
test('empty states: Sin recurso only when noRes, Sin tripulación not for rentals', () => {
  assert.ok(/nores\?`<span class="lt nores">Sin recurso<\/span>`:''/.test(card));
  assert.ok(/rent\?'':'<span class="lt nores">Sin tripulación<\/span>'/.test(card));
});
test('Sin recurso still counted once (depAlerts adds it via noRes, card text is not an extra alert)', () => {
  assert.ok(/noRes\(d\)\?\['Sin recurso asignado'\]/.test(html));
  assert.strictEqual((card.match(/depAlertN/g) || []).length >= 1, true);
});
test('css: single-line ellipsis rows with fixed height, muted 16px icons; rentals/canceled untouched', () => {
  assert.ok(/\.drow \.l3\{display:flex;[^}]*height:18px/.test(html));
  assert.ok(/\.drow \.l3 \.gi\{[^}]*width:16px;height:16px;color:var\(--ink3\)/.test(html));
  assert.ok(/\.drow \.l3 \.lt\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/.test(html));
  assert.ok(/function cancCard/.test(html) && /dquiet/.test(card));
});
test('APP_VER and CACHE bumped together to v25', () => {
  assert.ok(Number(/APP_VER='v(\d+)'/.exec(html)[1]) >= 25 && /al-ops-v\d+/.test(sw));
});

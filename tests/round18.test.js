// Round 18: compact Eventuales header (pill + Periodo sheet + one-line summary).
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { test } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({evPill,evMode,evMonthShift,evPayLine,evOptions,evSummary,isMonthRange,EV_INFO})', {});
const rng = (a, b) => ({ desde: a, hasta: b });
const fm = n => '$' + n.toLocaleString('en-US');

test('round 18: evPill — week, month, custom labels', () => {
  assert.strictEqual(U.evPill(null, '2026-11-26'), 'Semana 26 nov – 2 dic');
  assert.strictEqual(U.evPill(rng('2026-11-01', '2026-11-30')), 'Noviembre 2026');
  assert.strictEqual(U.evPill(rng('2026-02-01', '2026-02-28')), 'Febrero 2026');
  assert.strictEqual(U.evPill(rng('2026-11-01', '2026-11-15')), '1 – 15 nov');
  assert.strictEqual(U.evPill(rng('2026-10-28', '2026-11-03')), '28 oct – 3 nov');
  assert.strictEqual(U.evPill(rng('2026-11-10', '2026-11-10')), '10 nov');
  assert.strictEqual(U.evPill(rng('2025-12-20', '2026-01-05')), '20 dic 2025 – 5 ene 2026');
});
test('round 18: evMode and month navigation', () => {
  assert.strictEqual(U.evMode(null), 'week');
  assert.strictEqual(U.evMode(rng('2026-11-01', '2026-11-30')), 'month');
  assert.strictEqual(U.evMode(rng('2026-11-01', '2026-11-29')), 'custom');
  assert.deepStrictEqual(Array.from(U.evMonthShift(rng('2026-11-01', '2026-11-30'), -1)), ['2026-10-01', '2026-10-31']);
  assert.deepStrictEqual(Array.from(U.evMonthShift(rng('2026-12-01', '2026-12-31'), 1)), ['2027-01-01', '2027-01-31']);
  assert.deepStrictEqual(Array.from(U.evMonthShift(rng('2026-01-01', '2026-01-31'), -1)), ['2025-12-01', '2025-12-31']);
  assert.deepStrictEqual(Array.from(U.evMonthShift(rng('2026-03-01', '2026-03-31'), -1)), ['2026-02-01', '2026-02-28']);
});
test('round 18: pay line under the week', () => {
  assert.strictEqual(U.evPayLine('2026-11-26'), 'Pago jue 3 dic');
  assert.strictEqual(U.evPayLine('2026-11-23'), 'Pago lun 30 nov');
});
test('round 18: Periodo sheet options and current check', () => {
  const t = '2026-11-26', d = 'jueves';
  const o = (evp, ws, all) => Array.from(U.evOptions(evp, ws, t, d, all)).map(x => x.k + (x.on ? '*' : ''));
  assert.deepStrictEqual(o(null, '2026-11-26', true), ['sem*', 'sempas', 'mes', 'mespas', 'fechas']);
  assert.deepStrictEqual(o(null, '2026-11-19', true), ['sem', 'sempas*', 'mes', 'mespas', 'fechas']);
  assert.deepStrictEqual(o(rng('2026-11-01', '2026-11-30'), '2026-11-26', true), ['sem', 'sempas', 'mes*', 'mespas', 'fechas']);
  assert.deepStrictEqual(o(rng('2026-10-01', '2026-10-31'), '2026-11-26', true), ['sem', 'sempas', 'mes', 'mespas*', 'fechas']);
  assert.deepStrictEqual(o(rng('2026-11-01', '2026-11-15'), '2026-11-26', true), ['sem', 'sempas', 'mes', 'mespas', 'fechas*']);
  assert.deepStrictEqual(o(null, '2026-11-12', true), ['sem', 'sempas', 'mes', 'mespas', 'fechas'], 'older week: nothing checked');
  assert.deepStrictEqual(o(null, '2026-11-26', false), ['sem*', 'sempas'], 'no pagar permission: weeks only');
  const l = Array.from(U.evOptions(null, '2026-11-26', t, d, true)).map(x => x.l);
  assert.deepStrictEqual(l, ['Esta semana', 'Semana pasada', 'Este mes', 'Mes pasado', 'Elegir fechas…']);
});
test('round 18: one-line summary text', () => {
  const w = U.evSummary('week', { tot: 8650, n: 9, paid: 0 });
  assert.strictEqual(w.big, 8650); assert.deepStrictEqual(Array.from(w.rest).map(r => r.t), ['a pagar', '9 personas', '0 pagados']);
  assert.deepStrictEqual(Array.from(U.evSummary('week', { tot: 1, n: 1, paid: 1 }).rest).map(r => r.t), ['a pagar', '1 persona', '1 pagado']);
  const p = U.evSummary('range', { ganado: 44050, pagado: 43750, pendiente: 300, fmt: fm });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(p.rest)), [{ t: 'ganado' }, { t: 'pagado $43,750' }, { t: 'pendiente $300', c: 'evw' }]);
  const z = U.evSummary('range', { ganado: 100, pagado: 100, pendiente: 0, fmt: fm });
  assert.strictEqual(z.rest[2].c, undefined);
  const n = U.evSummary('range', { ganado: 100, pagado: 150, pendiente: -50, fmt: fm });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(n.rest[2])), { t: 'pagado de más $50', c: 'evm' });
});
test('round 18: old header pieces are gone, new ones wired', () => {
  const c = html.replace(/\/\/[^\n]*/g, '');
  assert.ok(!/Semana de \$\{payDayName/.test(c) && !/Total a pagar/.test(c) && !/function evChips/.test(c) && !/data-evcal/.test(c));
  assert.ok(!/Incluye los días completos\. Lo pagado/.test(c), 'explanation paragraph removed');
  ['data-evpill', 'data-evpick', 'data-evm', 'data-evinfo', "svgI('down'", "svgI('info'"].forEach(k => assert.ok(c.indexOf(k) >= 0, k));
  assert.ok(/EV_INFO/.test(c) && U.EV_INFO.indexOf('pagado de más') >= 0);
});
test('round 18: APP_VER v15 = sw.js CACHE', () => {
  assert.ok(/const APP_VER='v15'/.test(html));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8').indexOf("const CACHE = 'al-ops-v15'") >= 0);
});

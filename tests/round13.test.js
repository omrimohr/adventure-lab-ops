// Round 13: same unit icon, money format (−$1,690), stock report date picker / table, inclusive edges.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({fmt,fmt0,packs,srLabel,srPick,calCells,reportText,reportCsv})', {});
const E = loadNew().ex;

test('fmt / fmt0: minus sign (U+2212) before the $, never "$-"; cents only in fmt; fmt0 whole pesos; no "−$0"', () => {
  assert.strictEqual(U.fmt(-1690), '−$1,690');
  assert.strictEqual(U.fmt(-1690.29), '−$1,690.29');
  assert.strictEqual(U.fmt(1690.5), '$1,690.5');
  assert.strictEqual(U.fmt0(-1690.29), '−$1,690');
  assert.strictEqual(U.fmt0(1440.6), '$1,441');
  assert.strictEqual(U.fmt0(163), '$163');
  assert.strictEqual(U.fmt(0), '$0'); assert.strictEqual(U.fmt(-0.001), '$0'); assert.strictEqual(U.fmt0(-0.4), '$0');
  [-5, -0.5, -123456.789, 99].forEach(n => { assert.ok(!/\$-/.test(U.fmt(n)) && !/\$-/.test(U.fmt0(n))); });
});
test('packs: the can icon for every product (boxes keep the box icon); no boxes = can + number', () => {
  const NB = '  ';
  ['🍺', '💧', '🍷', '⛽'].forEach(ic => {
    assert.strictEqual(U.packs({ pack: 1, icon: ic, unitIcon: ic }, 7), '🥫 7');
    assert.strictEqual(U.packs({ pack: 12, icon: ic, unitIcon: ic }, 30), `📦 2${NB}🥫 6`);
  });
});
test('reportText: negative values use −$ and whole pesos', () => {
  const t = U.reportText({ rows: [{ name: 'Vino', ini: 3, com: 0, con: 5, aj: 0, fin: -2, val: -1690.29 }], totals: { consumo: 2180.4, compras: 163, valor: -1690.29 } }, 'T');
  assert.ok(t.includes('(−$1,690)') && t.includes('Consumo $2,180 · Compras $163 · Valor final −$1,690'), t);
});
test('srLabel: single day = "Balance al …", range = "a – b year" (year once when equal)', () => {
  assert.strictEqual(U.srLabel('2026-11-25', '2026-11-25'), 'Balance al mié. 25/nov 2026');
  assert.strictEqual(U.srLabel('2026-11-19', '2026-11-25'), 'jue. 19/nov – mié. 25/nov 2026');
  assert.strictEqual(U.srLabel('2025-12-29', '2026-01-04'), 'lun. 29/dic 2025 – dom. 4/ene 2026');
});
test('srPick: first tap = start, second = end, earlier second tap swaps, same day twice = one day, then a new tap starts over', () => {
  let s = J(U.srPick({ a: '2026-11-01', b: '2026-11-05', phase: 0 }, '2026-11-10'));
  assert.deepStrictEqual(s, { a: '2026-11-10', b: null, phase: 1 });
  assert.deepStrictEqual(J(U.srPick(s, '2026-11-14')), { a: '2026-11-10', b: '2026-11-14', phase: 0 });
  assert.deepStrictEqual(J(U.srPick(s, '2026-11-03')), { a: '2026-11-03', b: '2026-11-10', phase: 0 });
  assert.deepStrictEqual(J(U.srPick(s, '2026-11-10')), { a: '2026-11-10', b: '2026-11-10', phase: 0 });
  assert.deepStrictEqual(J(U.srPick({ a: '2026-11-03', b: '2026-11-10', phase: 0 }, '2026-11-20')), { a: '2026-11-20', b: null, phase: 1 });
});
test('calCells: Monday-first padding and month length', () => {
  assert.deepStrictEqual(J(U.calCells(2026, 10)), { pad: 6, dim: 30 });   // 1 nov 2026 is a Sunday
  assert.deepStrictEqual(J(U.calCells(2026, 1)), { pad: 6, dim: 28 });    // 1 feb 2026 is a Sunday
  assert.deepStrictEqual(J(U.calCells(2026, 5)), { pad: 0, dim: 30 });    // 1 jun 2026 is a Monday
});

// Inclusive edges: Inicial = before ANY movement of the first day; Final = after ALL movements of the last day
const IT = [{ id: 'cer', name: 'Cerveza', icon: '🍺', group: 'Bebidas', unit: 'lata', units: 'latas', price: 20, controlStock: true, active: true }];
const mv = (d, q, t, n) => ({ d, i: 'cer', q, c: 20, t: t || 'Compra', cid: 'x' + (n || d + q) });
test('stockReport_ edges: movements on the first day are NOT in Inicial; movements on the last day ARE in Final; day before / day after are excluded', () => {
  const M = [mv('2026-11-09', 100), mv('2026-11-10', 10), mv('2026-11-10', -4, 'Bitácora'), mv('2026-11-15', 7), mv('2026-11-15', -3, 'Ajuste · Merma'), mv('2026-11-16', 50)];
  const r = J(E.stockReport_(IT, M, '2026-11-10', '2026-11-15')).rows[0];
  assert.strictEqual(r.ini, 100, 'only the 9th (and earlier) in Inicial');
  assert.deepStrictEqual([r.com, r.con, r.aj], [17, 4, -3], 'both edge days fully inside');
  assert.strictEqual(r.fin, 100 + 17 - 4 - 3, 'the 16th is out');
  // single day = balance at the end of that day, Inicial = start of the day
  const d = J(E.stockReport_(IT, M, '2026-11-15', '2026-11-15')).rows[0];
  assert.deepStrictEqual([d.ini, d.fin], [100 + 10 - 4, 100 + 17 - 4 - 3]);
  // a period ending the day before a movement excludes it; starting the day after excludes it from Inicial's complement
  assert.strictEqual(J(E.stockReport_(IT, M, '2026-11-10', '2026-11-14')).rows[0].fin, 106);
  assert.strictEqual(J(E.stockReport_(IT, M, '2026-11-16', '2026-11-16')).rows[0].ini, 100 + 10 - 4 + 7 - 3);
});
test('wiring: report uses the custom calendar + table; no native date input, no Periodo/Un día toggle; sw CACHE v10+', () => {
  const sec = html.slice(html.indexOf('sreport(){'), html.indexOf('item(id){'));
  assert.ok(!/type="date"/.test(sec) && !/class="srd"|id="srA"|id="srB"/.test(html), 'no native date input in the report');
  assert.ok(!/data-srm|Un día<\/button>/.test(html));
  ['data-srcal', 'data-scd', 'data-scnav', 'data-scok', 'class="srt"', 'Incluye los dos días completos, hasta el cierre de operaciones.', 'tfoot'].forEach(k => assert.ok(html.includes(k), k));
  assert.ok(/'al-ops-v(1\d|[2-9]\d)'/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8')));
});

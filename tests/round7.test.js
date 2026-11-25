// Round 7: stock report (pure + API), idempotent writes (client id), day summary, stock units, optimistic queue helpers, report CSV/text.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({daySummary,packs,optApply,optMark,reportCsv,reportText,qClass,qBackoff,Q_MAX,uuid,DEP_FILTERS,hasBk})', {});
const E = loadNew().ex;

// ---------- stock report (pure) ----------
const IT = [{ id: 'cer', name: 'Cerveza', icon: '🍺', group: 'Bebidas', unit: 'lata', units: 'latas', price: 20, controlStock: true, active: true },
  { id: 'hie', name: 'Hielo', icon: '🧊', group: 'Consumo directo', unit: 'bolsa', units: 'bolsas', price: 45, controlStock: false, active: true },
  { id: 'old', name: 'Viejo', icon: '📦', group: 'Bebidas', unit: 'lata', units: 'latas', price: 5, controlStock: true, active: false }];
const MV = [
  { d: '2026-11-01', i: 'cer', q: 100, c: 15, t: 'Compra', cid: 'C1' },            // before
  { d: '2026-11-05', i: 'cer', q: -30, c: 20, t: 'Bitácora', dep: '1' },           // before
  { d: '2026-11-10', i: 'cer', q: 48, c: 18, t: 'Compra', cid: 'C2' },             // inside (first day)
  { d: '2026-11-12', i: 'cer', q: -40, c: 20, t: 'Bitácora', dep: '2' },           // inside
  { d: '2026-11-15', i: 'cer', q: -6, c: 20, t: 'Ajuste · Merma', aj: true },      // inside (last day, counts until 23:59)
  { d: '2026-11-16', i: 'cer', q: 24, c: 18, t: 'Compra', cid: 'C3' },             // after
  { d: '2026-11-17', i: 'cer', q: -10, c: 20, t: 'Bitácora', dep: '3' },           // after
  { d: '2026-11-11', i: 'hie', q: 5, c: 45, t: 'Compra', cid: 'C4', noStock: true } // no-stock product: not in the report
];
test('stockReport_: before / inside / after the period → Inicial, Compras, Consumo, Ajustes, Final, Δ, Valor, totals', () => {
  const r = J(E.stockReport_(IT, MV, '2026-11-10', '2026-11-15'));
  assert.strictEqual(r.rows.length, 1, 'only controlled products; inactive with no movement hidden');
  const c = r.rows[0];
  assert.deepStrictEqual([c.ini, c.com, c.con, c.aj, c.fin, c.delta, c.val], [70, 48, 40, -6, 72, 2, 1440]);
  assert.deepStrictEqual([c.comV, c.conV], [864, 800]);
  assert.deepStrictEqual(r.totals, { consumo: 800, compras: 864, valor: 1440 });
  assert.strictEqual(c.fin, c.ini + c.com - c.con + c.aj);
});
test('stockReport_: single day (desde = hasta) = balance al día; day boundaries are inclusive; reversed dates are swapped; period before any movement is all zero', () => {
  const day = J(E.stockReport_(IT, MV, '2026-11-12', '2026-11-12')).rows[0];
  assert.deepStrictEqual([day.ini, day.com, day.con, day.fin], [118, 0, 40, 78]);
  const bal = J(E.stockReport_(IT, MV, '2026-11-15', '2026-11-15')).rows[0];
  assert.strictEqual(bal.fin, 72, 'movement on the last day counts, the 16th does not');
  assert.strictEqual(J(E.stockReport_(IT, MV, '2026-11-15', '2026-11-10')).rows[0].fin, 72);
  const z = J(E.stockReport_(IT, MV, '2026-10-01', '2026-10-31')).rows[0];
  assert.deepStrictEqual([z.ini, z.com, z.con, z.aj, z.fin, z.val], [0, 0, 0, 0, 0, 0]);
  const all = J(E.stockReport_(IT, MV, '2026-11-01', '2026-11-30')).rows[0];
  assert.strictEqual(all.fin, 100 - 30 + 48 - 40 - 6 + 24 - 10);
});
test('stockReport_: annulled purchases net to zero (Compra + Compra anulada) and the report ledger equals buildMoves_ stock', () => {
  const mv = [{ d: '2026-11-02', i: 'cer', q: 10, c: 20, t: 'Compra', cid: 'C9' }, { d: '2026-11-03', i: 'cer', q: -10, c: 20, t: 'Compra anulada', cid: 'C9' }];
  const r = J(E.stockReport_(IT, mv, '2026-11-01', '2026-11-30')).rows[0];
  assert.deepStrictEqual([r.com, r.fin, r.val], [0, 0, 0]);
  const r2 = J(E.stockReport_(IT, mv, '2026-11-03', '2026-11-30')).rows[0];
  assert.deepStrictEqual([r2.ini, r2.com, r2.fin], [10, -10, 0], 'annulment dated inside the period');
});

// ---------- server: idempotent writes + API ----------
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : []; };
  return { ss, fe, G, rows };
}
const PIN = '0000';
test('addCompra with the same client id twice → one purchase, the retry answers with the original id; "ID cliente" is the LAST column', () => {
  const e = env(), p = { cid: 'u-1', d: '2026-11-20', sup: 'Depósito', lines: [{ i: 'cer', q: 24, p: 18 }, { i: 'agu', q: 12, p: 9 }] };
  const a = J(e.G.ex.addCompra(PIN, p)), b = J(e.G.ex.addCompra(PIN, p));
  assert.strictEqual(a.ok, true); assert.strictEqual(b.dup, true); assert.strictEqual(b.id, a.id);
  const rows = e.rows('Compras'); assert.strictEqual(rows.length, 2, 'two lines, written once');
  assert.deepStrictEqual(J(e.ss.getSheetByName('Compras')._d.rows[0].slice(-2)), ['Por', 'ID cliente']);
  assert.ok(rows.every(r => r[13] === 'u-1'));
  for (const t0 = Date.now(); Date.now() - t0 < 3;); // purchase ids are 'C'+ms: never two in the same millisecond in real life (script lock)
  const c = J(e.G.ex.addCompra(PIN, Object.assign({}, p, { cid: 'u-2' })));
  assert.notStrictEqual(c.id, a.id); assert.strictEqual(e.rows('Compras').length, 4, 'a different client id is a new purchase');
  for (const t0 = Date.now(); Date.now() - t0 < 3;);
  const d = J(e.G.ex.addCompra(PIN, { d: '2026-11-20', sup: 'x', lines: [{ i: 'cer', q: 1, p: 1 }] })); // no client id (old clients): always writes
  assert.ok(d.ok && !d.dup); assert.strictEqual(e.rows('Compras').length, 5);
});
test('addAjuste / addConteo / markPaid / markRev / addComida: duplicates by client id are ignored; existing rows are never edited', () => {
  const e = env(), G = e.G.ex;
  G.getData(PIN, '', ''); // seeds Productos/Usuarios
  const aj = { cid: 'a-1', d: '2026-11-20', i: 'cer', q: -6, motivo: 'Merma', nota: 'rotas' };
  G.addAjuste(PIN, aj); const r2 = J(G.addAjuste(PIN, aj));
  assert.strictEqual(r2.dup, true); assert.strictEqual(e.rows('Ajustes').length, 1); assert.strictEqual(e.rows('Ajustes')[0][7], 'a-1');
  const before = J(e.rows('Ajustes')[0]);
  G.addAjuste(PIN, Object.assign({}, aj, { cid: 'a-2' })); assert.strictEqual(e.rows('Ajustes').length, 2);
  assert.deepStrictEqual(J(e.rows('Ajustes')[0]), before, 'row 1 untouched');
  const cnt = { cid: 'k-1', d: '2026-11-21', counts: { cer: 1, agu: 2 }, nota: 'conteo' };
  const n1 = J(G.addConteo(PIN, cnt)); const n2 = J(G.addConteo(PIN, cnt));
  assert.ok(n1.n >= 1 && n2.dup === true && n2.n === 0);
  assert.strictEqual(e.rows('Ajustes').filter(r => String(r[7]).indexOf('k-1') === 0).length, n1.n, 'count written once');
  G.markPaid(PIN, '2026-11-19', 'Luis', 400, 'p-1'); const p2 = J(G.markPaid(PIN, '2026-11-19', 'Luis', 400, 'p-1'));
  assert.strictEqual(e.rows('Pagos').length, 1); assert.ok(p2.dup);
  G.addComida(PIN, { cid: 'c-1', nombre: 'Luis', tipo: 'desayuno', cantidad: 1 }); G.addComida(PIN, { cid: 'c-1', nombre: 'Luis', tipo: 'desayuno', cantidad: 1 });
  assert.strictEqual(e.rows('Comida empleado').length, 1);
});
test('markRev with the same client id → one Revisiones row', () => {
  const e = env(), G = e.G.ex;
  G.getData(PIN, '', '');
  const sal = e.ss.getSheetByName('Salidas') || e.ss.insertSheet('Salidas');
  if (!sal._d.rows.length) sal.appendRow(E.SAL_HEADERS || ['Availability pk']);
  sal.appendRow(['9000']);
  const a = J(G.markRev(PIN, '9000', 'r-1')), b = J(G.markRev(PIN, '9000', 'r-1'));
  assert.ok(a.ok && b.dup); assert.strictEqual(e.rows('Revisiones').length, 1);
  assert.strictEqual(e.rows('Revisiones')[0][3], 'r-1');
});
test('ensureCidCol_ adds the header at the end of an old sheet; cidRow_ never matches an empty id', () => {
  const e = env(), sh = e.ss.insertSheet('Ajustes'); sh.appendRow(['Fecha', 'Producto ID', 'Cantidad (+/-)', 'Motivo', 'Nota', 'Por', 'Registrado']); sh.appendRow(['2026-11-01', 'cer', 1, 'x', '', 'o', '']);
  e.G.ex.ensureCidCol_(sh, E.AJUSTE_HEADERS || e.G.get('AJUSTE_HEADERS'));
  assert.strictEqual(sh._d.rows[0][7], 'ID cliente'); assert.strictEqual(e.G.ex.cidRow_(sh, 8, ''), 0); assert.strictEqual(e.G.ex.cidRow_(sh, 8, 'zz'), 0);
  assert.strictEqual(e.G.ex.cidOf_('a b/c<1>'), 'abc1');
});
test('stockReport API: admin only; one date = balance al día; needs a valid date', () => {
  const e = env(), G = e.G.ex;
  G.getData(PIN, '', '');
  const r = J(G.stockReport(PIN, '2026-11-01', '2026-11-30'));
  assert.ok(r.ok && Array.isArray(r.rows) && r.totals && r.desde === '2026-11-01');
  const one = J(G.stockReport(PIN, '2026-11-15', ''));
  assert.strictEqual(one.desde, one.hasta);
  assert.throws(() => G.stockReport(PIN, 'x', 'y'), /fechas/);
  const us = e.ss.getSheetByName('Usuarios'); us.appendRow(['Jesús', '1111', 'op', 'sí']);
  assert.throws(() => G.stockReport('1111', '2026-11-01', '2026-11-30'), /admin/);
});
test('getData: purchases carry cid; ajuste moves carry detail (aj, mot, nota, por, k)', () => {
  const e = env(), G = e.G.ex;
  G.addCompra(PIN, { cid: 'u-9', d: '2026-11-20', sup: 'S', lines: [{ i: 'cer', q: 24, p: 18 }] });
  G.addAjuste(PIN, { cid: 'a-9', d: '2026-11-20', i: 'cer', q: -2, motivo: 'Rotura', nota: 'se cayó' });
  const d = J(G.getData(PIN, '', ''));
  assert.strictEqual(d.purchases.find(c => c.cid === 'u-9').sup, 'S');
  const a = d.moves.find(x => x.aj);
  assert.deepStrictEqual([a.mot, a.nota, a.k, a.por !== ''], ['Rotura', 'se cayó', 'a-9', true]);
});

// ---------- UI pure ----------
const dep = o => Object.assign({ date: '2026-11-24', time: '09:00', end: '2026-11-24 12:00', bit: 'Completa', bookings: [{ pax: 5 }], res: [{ name: 'B' }], crew: [], alerts: '', tipo: 'compartido', rev: null, ci: { in: 4, n: 5, ns: 0 } }, o);
test('daySummary: Tours / Rentas / ⚠️ total / check-in / revisadas — cancelled-only departures count NOWHERE', () => {
  const ds = [dep(), dep({ rev: { by: 'x' }, alerts: 'No show: 1' }), dep({ tipo: 'renta', bookings: [{ pax: 2 }, { pax: 3 }] }),
    dep({ bookings: [], alerts: 'Algo', crew: [{ r: '', n: 'Z' }], ci: { in: 0, n: 3, ns: 0 } }),           // cancelled-only, with a warning and check-in data
    dep({ bookings: [], rev: null })];
  const s = J(U.daySummary(ds, '2026-11-25 10:00', '2026-11-25', '2026-11-24'));
  assert.deepStrictEqual([s.t.n, s.t.pax, s.r.n, s.r.pax], [2, 10, 1, 5]);
  assert.strictEqual(s.warn, 1, 'only the active departure with an alert');
  assert.deepStrictEqual(s.ci && [s.ci.in, s.ci.n], [12, 15], 'check-in ignores cancelled-only');
  assert.deepStrictEqual(s.rev, { n: 1, tot: 3 }, 'revisadas ÷ active departures only');
  const f = U.DEP_FILTERS.find(x => x.key === 'revisar'), g = U.DEP_FILTERS.find(x => x.key === 'avisos');
  assert.strictEqual(ds.filter(d => f.test(d, { today: '2026-11-25' })).length, s.rev.tot - s.rev.n, 'tapping ✓ revisadas lists exactly the missing ones');
  assert.strictEqual(ds.filter(d => g.test(d, { nowKey: '2026-11-25 10:00' })).length, 1);
  assert.strictEqual(J(U.daySummary(ds, '2026-11-24 10:00', '2026-11-24', '2026-11-24')).rev, null, 'no revisadas on today');
  assert.strictEqual(J(U.daySummary(ds, '2026-11-24 10:00', '2026-11-24', '2026-11-25')).rev, null, 'nor on future days');
  assert.deepStrictEqual(J(U.daySummary([dep({ bookings: [] })], '', '2026-11-25', '2026-11-24')), { t: { n: 0, pax: 0 }, r: { n: 0, pax: 0 }, warn: 0, ci: null, rev: null });
});
test('packs: every product in the same icon format (📦 boxes + unit icon + loose); Agua with no unit icon uses the can-style icon; no unit words', () => {
  const NB = '  ';
  assert.strictEqual(U.packs({ pack: 24, unitIcon: '🥫', units: 'latas' }, 212), `📦 8${NB}🥫 20`);
  assert.strictEqual(U.packs({ pack: 12, unitIcon: '', units: 'botellas' }, 114), `📦 9${NB}🥫 6`);
  assert.strictEqual(U.packs({ pack: 6, unitIcon: '🍶', units: 'botellas' }, 12), `📦 2${NB}🍶 0`);
  assert.strictEqual(U.packs({ pack: 1, unitIcon: '', icon: '⛽', units: 'litros' }, 155), '⛽ 155');
  assert.strictEqual(U.packs({ pack: 24, unitIcon: '🥫' }, -5), `📦 0${NB}🥫 -5`);
  assert.ok(!/[a-zñ]{3}/i.test(U.packs({ pack: 12, unitIcon: '', units: 'botellas' }, 30)));
});
const S0 = () => ({ items: [{ id: 'cer', name: 'Cerveza', controlStock: true, active: true, price: 15 }, { id: 'hie', name: 'Hielo', controlStock: false, active: true, price: 45 }],
  purchases: [], moves: [{ d: '2026-11-01', i: 'cer', q: 10, c: 15, t: 'Compra' }], deps: [{ id: '9000', rev: null }], paid: {}, pend: [{ kind: 'campo', clave: '8888' }] });
const CTX = { today: '2026-11-25', hm: '10:00', user: 'Omri' };
test('optApply: purchase/ajuste/conteo/revisión/pago/config appear as "guardando…"; applying twice or after the server has them adds nothing', () => {
  const S = S0(), buy = { id: 'u1', fn: 'addCompra', args: [{ cid: 'u1', d: '2026-11-25', sup: 'Dep', lines: [{ i: 'cer', q: 24, p: 18 }, { i: 'hie', q: 2, p: 40 }] }] };
  const S1 = S0(); U.optApply(S1, buy, CTX); U.optApply(S1, buy, CTX); // second apply is blocked: the pending purchase already carries the cid
  assert.strictEqual(S1.purchases.length, 1); assert.strictEqual(S1.purchases[0].pend, 'guardando…'); assert.strictEqual(S1.items[0].price, 18);
  assert.strictEqual(S1.moves.filter(x => x.pend).length, 2); assert.strictEqual(S1.moves.find(x => x.i === 'hie').noStock, true);
  U.optApply(S1, { id: 'a1', fn: 'addAjuste', args: [{ cid: 'a1', d: '2026-11-25', i: 'cer', q: -3, motivo: 'Merma', nota: 'n' }] }, CTX);
  U.optApply(S1, { id: 'a1', fn: 'addAjuste', args: [{ cid: 'a1', d: '2026-11-25', i: 'cer', q: -3, motivo: 'Merma', nota: 'n' }] }, CTX);
  assert.strictEqual(S1.moves.filter(x => x.k === 'a1').length, 1);
  U.optApply(S1, { id: 'k1', fn: 'addConteo', args: [{ cid: 'k1', d: '2026-11-25', counts: { cer: 100, hie: 3 }, nota: 'c' }] }, CTX);
  assert.deepStrictEqual(S1.moves.filter(x => x.k === 'k1').map(x => x.q), [100 - (10 + 24 - 3)], 'only controlled products, diff against current stock');
  U.optApply(S1, { id: 'r1', fn: 'markRev', args: ['9000', 'r1'] }, CTX); assert.strictEqual(S1.deps[0].rev.pend, 'guardando…');
  U.optApply(S1, { id: 'p1', fn: 'markPaid', args: ['2026-11-19', 'Luis', 400, 'p1'] }, CTX); assert.strictEqual(S1.paid['2026-11-19|Luis'], '2026-11-25'); assert.ok(S1.paidPend['2026-11-19|Luis']);
  U.optApply(S1, { id: 'm1', fn: 'setMapeo', args: ['campo', '8888', {}, 'm1'] }, CTX); assert.strictEqual(S1.pend[0].pend, 'guardando…');
  // server already has it → skipped
  const S2 = S0(); S2.purchases.push({ id: 'C5', cid: 'u1' }); U.optApply(S2, buy, CTX); assert.strictEqual(S2.purchases.length, 1);
  const S3 = S0(); S3.moves.push({ k: 'a1', i: 'cer', q: -3 }); U.optApply(S3, { id: 'a1', fn: 'addAjuste', args: [{ cid: 'a1', d: 'x', i: 'cer', q: -3, motivo: 'm' }] }, CTX); assert.strictEqual(S3.moves.length, 2);
});
test('optMark flips "guardando…" ↔ "no se guardó" on what was already painted', () => {
  const S = S0(), q = { id: 'u1', fn: 'addCompra', args: [{ cid: 'u1', d: '2026-11-25', sup: 'D', lines: [{ i: 'cer', q: 1, p: 1 }] }], fail: '' };
  U.optApply(S, q, CTX); q.fail = 'final'; U.optMark(S, q);
  assert.deepStrictEqual([S.purchases[0].pend, S.purchases[0].pf, S.moves.find(x => x.k === 'u1').pend], ['no se guardó', true, 'no se guardó']);
  q.fail = ''; U.optMark(S, q); assert.strictEqual(S.purchases[0].pend, 'guardando…');
});
test('queue policy: network/server-busy errors retry with growing backoff (in order); validation errors fail at once; auth stops', () => {
  assert.strictEqual(U.qClass('Sin conexión. Intenta de nuevo.'), 'retry'); assert.strictEqual(U.qClass('Servidor 503'), 'retry');
  assert.strictEqual(U.qClass('Lock timeout'), 'retry'); assert.strictEqual(U.qClass('Producto desconocido'), 'final');
  assert.strictEqual(U.qClass('El motivo es obligatorio'), 'final'); assert.strictEqual(U.qClass('PIN incorrecto'), 'auth');
  assert.deepStrictEqual([1, 2, 3, 4, 5, 9].map(U.qBackoff), [2000, 5000, 15000, 30000, 60000, 60000]); assert.strictEqual(U.Q_MAX, 6);
  const a = U.uuid(), b = U.uuid(); assert.ok(/^[0-9a-f-]{36}$/.test(a) && a !== b);
});
test('reportCsv / reportText: header, one line per product, TOTAL, quoted commas, BOM', () => {
  const rep = { desde: '2026-11-10', hasta: '2026-11-15', rows: [{ name: 'Cerveza, fría', group: 'Bebidas', units: 'latas', ini: 70, com: 48, con: 40, aj: -6, fin: 72, delta: 2, price: 20, val: 1440, comV: 864, conV: 800 }], totals: { consumo: 800, compras: 864, valor: 1440 } };
  const csv = U.reportCsv(rep).replace(/^﻿/, '').split('\r\n');
  assert.strictEqual(csv[0].split(',')[0], 'Producto'); assert.strictEqual(csv[1], '"Cerveza, fría",Bebidas,latas,70,48,40,-6,72,2,20,1440,864,800');
  assert.strictEqual(csv[2], 'TOTAL,,,,,,,,,,1440,864,800'); assert.ok(U.reportCsv(rep).charCodeAt(0) === 0xfeff);
  const t = U.reportText(rep, 'Reporte');
  assert.ok(/^Reporte\n\nCerveza, fría: inicial 70 · compras \+48 · consumo −40 · ajustes −6 · final 72/.test(t)); assert.ok(/Consumo \$800 · Compras \$864 · Valor final \$1,440$/.test(t));
});
test('app wiring: sw CACHE bumped, queue + idempotency hooks present, no pills, sheet uses select grouped by Grupo', () => {
  assert.ok(/'al-ops-v[5-9]|'al-ops-v\d{2,}|'al-ops-v4'/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8')));
  assert.ok(/enqueue\('addCompra'/.test(html) && /enqueue\('markRev'/.test(html) && /enqueue\('markPaid'/.test(html) && /enqueue\('setMapeo'/.test(html) && /enqueue\('addAjuste'/.test(html));
  assert.ok(!/class="pills"/.test(html) && /<optgroup label=/.test(html) && !/data-chip=/.test(html));
});

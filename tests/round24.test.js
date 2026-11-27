// Round 24: cancelled bookings / departures — kept money is income, no automatic 50%, pay decision, visibility.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test } = require('./lib');
const F = require('./fixtures');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({isCanc,cancPend,cancDec,cancAntes,cancMoney,cancShow,cancMode,grossOf,DEP_FILTERS,depAlerts,depAlertN,daySummary,optApply})', {});
const N = loadNew(), E = N.ex, TAR = N.get('TAR_SEED');
const NOW = new Date('2026-11-20T23:00:00Z');
const tours = J(E.toursFromRows_(N.get('TOURS_SEED')));
const mk = (pk, status, o) => { const b = J(F.booking(Object.assign({ pk: pk, av: 9500, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z', status: status, customers: [F.cust(100, 'Adult')], crew: [F.CREW[0], F.CREW[1]] }, o))).booking; return b; };
const run = (bs, ing) => J(E.computeSalida_('9500', bs.map((b, i) => ({ b: b, row: i + 2, tc: b.status === 'cancelled' ? '2026-11-20T13:20:00.000Z' : '' })), tours, NOW, ing || {}, null));
const H = E.SAL_HEADERS, col = n => H.indexOf(n);

test('keptAmount_ = paid − refunds (never negative); cancelIncome_: report wins, else estimate on the kept amount', () => {
  const b = mk(1, 'cancelled', { paid: 180000 });
  assert.strictEqual(E.keptAmount_(b), 1800);
  b.payments = [{ amount: 180000, refunds: [{ amount: 50000 }] }]; assert.strictEqual(E.keptAmount_(b), 1300);
  b.payments = [{ amount: 180000, refunds: [{ amount: 180000 }] }]; assert.strictEqual(E.keptAmount_(b), 0);
  assert.strictEqual(E.keptAmount_(mk(2, 'cancelled', {})), 0);
  assert.deepStrictEqual(J(E.cancelIncome_(mk(3, 'cancelled', { paid: 100000 }), {})), { kept: 1000, net: 1000, est: true });
  assert.deepStrictEqual(J(E.cancelIncome_(mk(4, 'cancelled', { paid: 100000 }), { 4: 900, 'fee:4': 40 })), { kept: 1000, net: 940, est: false }, 'Net Revenue + fee like exactNet_');
  assert.strictEqual(E.cancelIncome_(mk(5, 'cancelled', {}), { 5: 500 }).net, 0, 'nothing kept → no income');
});

test('cancelAtOf_: cancel timestamp key in the payload; none → empty (caller falls back to Raw Recibido of the first cancelled payload)', () => {
  const b = mk(6, 'cancelled', {});
  assert.strictEqual(E.cancelAtOf_(b), '');
  b.cancellation = { cancelled_at: '2026-11-19T10:00:00Z' }; assert.strictEqual(E.cancelAtOf_(b), '2026-11-19T10:00:00.000Z');
  const c = mk(7, 'cancelled', {}); c.cancelled_at = '2026-11-18T09:30:00Z'; assert.strictEqual(E.cancelAtOf_(c), '2026-11-18T09:30:00.000Z');
  const d = mk(8, 'cancelled', {}); d.cancellation_policy = { cutoff: '2026-11-18T09:30:00Z' }; assert.strictEqual(E.cancelAtOf_(d), '', 'policy cutoffs are not cancel times');
  assert.strictEqual(E.cancelCells_(mk(9, 'cancelled', { paid: 50000 }), 'cancelled', '', {}, '2026-11-20T13:20:00Z')[3], '2026-11-20T13:20:00.000Z');
  assert.deepStrictEqual(J(E.cancelCells_(mk(9, 'booked', {}), 'booked', '', {}, '')), ['', '', '', '']);
});

test('computeSalida_: cancelled money is income, never pax / unidades / active count; all cancelled → Cancelada sí + minutes before', () => {
  const r = run([mk(10, 'cancelled', { paid: 120000 }), mk(11, 'cancelled', {})]);
  assert.strictEqual(r.salida[col('Cancelada')], 'sí'); assert.strictEqual(r.salida[col('Reservas activas')], 0);
  assert.strictEqual(r.salida[col('Pax')], 0); assert.strictEqual(r.salida[col('Unidades')], 0);
  assert.strictEqual(r.salida[col('Ingreso neto (MXN)')], 1200); assert.strictEqual(r.salida[col('Cobro cancelaciones (MXN)')], 1200); assert.strictEqual(r.salida[col('Fuente ingreso')], 'estimado');
  assert.strictEqual(r.salida[col('Cancelada antes (min)')], 40); assert.strictEqual(r.salida[col('Cancelación (hora)')], '2026-11-20T13:20:00.000Z');
  const p = run([mk(12, 'booked', { paid: 100000 }), mk(13, 'cancelled', { paid: 30000 })]);
  assert.strictEqual(p.salida[col('Cancelada')], '', 'one active booking → not a cancelled departure');
  assert.strictEqual(p.salida[col('Pax')], 1); assert.strictEqual(p.salida[col('Ingreso neto (MXN)')], 1300);
  const z = run([mk(14, 'cancelled', {})]); assert.strictEqual(z.salida[col('Ingreso neto (MXN)')], 0); assert.strictEqual(z.salida[col('Cobro cancelaciones (MXN)')], '');
});

test('Reservas: reservaRow_ keeps Cuenta "no" for cancelled and fills the 4 new END columns', () => {
  const b = mk(20, 'cancelled', { paid: 80000 }), row = J(E.reservaRow_(b, 'now', 5, tours, {}, null, '2026-11-20T13:00:00Z'));
  const H2 = E.RES_HEADERS; assert.strictEqual(row.length, H2.length);
  assert.strictEqual(row[3], 'no'); assert.strictEqual(row[30], 0);
  assert.deepStrictEqual(row.slice(E.RES_KEPT), [800, 800, 'estimado', '2026-11-20T13:00:00.000Z']);
  assert.strictEqual(H2[E.RES_CTC], 'Cancelada (hora)'); assert.strictEqual(H2.length, E.RES_CTC + 1);
});

const sal = ['9500', 258806, 'Bacalar Lagoon Boat Tour', 'compartido', '2026-11-20', '09:00', '2026-11-20T14:00:00Z', '2026-11-20T17:00:00Z', 0];
const cap = ['9500', '', '', '', 'Capitan', 'Juan Pérez', 'juan', '', ''];
const bitSal = ['9500', '', '', '', 1, 'Salida', 'Cerveza', '2024601', 12, ''];
const pay = bit => J(E.payForSalida_(sal, [cap], bit, TAR, 'ponton', null, NOW)).pay[0];

test('crew pay on a cancelled departure: no automatic 50%; with a Salida bitácora FULL rate; without it 0 but the rate is kept for the decision', () => {
  assert.ok(!TAR.some(r => r[0] === 'cancelado'), 'seed no longer has the 50% rule');
  const s = pay([bitSal]); assert.strictEqual(s[11], 1); assert.strictEqual(s[14], 450); assert.ok(/Cancelada · salió/.test(s[15]));
  const n = pay([]); assert.strictEqual(n[10], 450, 'rate recorded'); assert.strictEqual(n[11], 0); assert.strictEqual(n[14], 0); assert.strictEqual(n[16], '');
  assert.strictEqual(pay([Object.assign(bitSal.slice(), { 5: 'Regreso' })])[14], 0, 'only a Salida side counts');
  const act = J(E.payForSalida_(Object.assign(sal.slice(), { 8: 2 }), [cap], [], TAR, 'ponton', null, NOW)).pay[0]; assert.strictEqual(act[14], 450, 'active departures unchanged');
});

test('Ajustes salida: a "decision" row (monto 0) is kept active, excluded from sums and from Eventuales; normAjusteSalida_ accepts it', () => {
  const rows = [['A1', '', '9500', '2026-11-20', 'x', 'decision', '', 'Cancelación: no se paga', 0, 'Cancelada · decidido por Omri', 'Omri', '', '', '', 'c1'],
    ['A2', '', '9500', '2026-11-20', 'x', 'pago', 'Juan Pérez', 'Cancelación', 225, '', 'Omri', '', '', '', 'c2']];
  const a = J(E.ajustesActivos_(rows)); assert.strictEqual(a.length, 2); assert.strictEqual(a[0].tipo, 'decision');
  assert.deepStrictEqual(J(E.ajustesPorSalida_(a))['9500'], { pago: 225, costo: 0, total: 225 });
  assert.strictEqual(E.ajusteEvRows_(a, {}, 4, '2026-12-01').length, 1);
  assert.deepStrictEqual(J(N.ex.normAjusteSalida_({ av: '9500', tipo: 'decision', concepto: 'Cancelación: no se paga', monto: 0, motivo: 'x' })), { av: '9500', tipo: 'decision', persona: '', concepto: 'Cancelación: no se paga', monto: 0, motivo: 'x' });
  assert.throws(() => N.ex.normAjusteSalida_({ av: '9500', tipo: 'pago', concepto: 'x', persona: 'a', monto: 0 }));
});

const crewPay = rate => ({ n: 'Juan', r: 'Capitán', pay: { rate: rate, base: 0, hx: 0, tot: 0 } });
const dep = o => Object.assign({ id: '9500', date: '2026-11-20', time: '09:00', item: 'T', bookings: [], aj: [], crew: [crewPay(450)], gross: 0, costs: null,
  cn: { all: true, n: 1, bks: [], kept: 0, net: 0, est: false, at: '', min: 40, salio: false, need: true } }, o);

test('buildDeps_ / cancelAlerts_: cn object; "¿se paga?" only without Salida bitácora, with crew, before a decision; text with how long before', () => {
  assert.strictEqual(E.cancelAntesTxt_(40), 'cancelada 40 min antes'); assert.strictEqual(E.cancelAntesTxt_(1560), 'cancelada 26 h antes');
  assert.strictEqual(E.cancelAntesTxt_(-5), 'cancelada después de la hora de salida'); assert.strictEqual(E.cancelAntesTxt_(null), '');
  const al = J(E.cancelAlerts_([dep()], '2026-11-21')); assert.strictEqual(al.length, 1);
  assert.ok(/¿se paga\?/.test(al[0].texto) && /40 min antes/.test(al[0].texto) && al[0].rol === 'todos' && al[0].av === '9500' && al[0].tipo === 'cancelada');
  assert.strictEqual(E.cancelAlerts_([dep({ aj: [{ tipo: 'decision', concepto: 'x' }] })], '2026-11-21').length, 0, 'decision removes it');
  assert.strictEqual(E.cancelAlerts_([dep({ aj: [{ tipo: 'pago', concepto: 'Cancelación', monto: 225 }] })], '2026-11-21').length, 0, 'a Cancelación pago is a decision too');
  assert.strictEqual(E.cancelAlerts_([dep({ cn: Object.assign(dep().cn, { need: false }) })], '2026-11-21').length, 0);
  assert.strictEqual(E.cancelAlerts_([dep()], '2026-12-30').length, 0, 'older than 14 days');
});

test('client: isCanc / cancPend / visibility (Solo con dinero · Todas · Ocultar · filtro Canceladas) / income helpers', () => {
  const d = dep(); assert.ok(U.isCanc(d) && U.cancPend(d) && U.cancMoney(d));
  assert.ok(!U.cancPend(dep({ aj: [{ tipo: 'decision' }] })));
  const nothing = dep({ crew: [], cn: Object.assign(dep().cn, { need: false }) }), money = dep({ cn: Object.assign(dep().cn, { need: false, kept: 500 }) }), cost = dep({ cn: Object.assign(dep().cn, { need: false }), costs: { tot: 80 } });
  assert.ok(!U.cancMoney(nothing) && U.cancMoney(money) && U.cancMoney(cost));
  assert.ok(!U.cancShow(nothing, 'dinero', 'todas') && U.cancShow(money, 'dinero', 'todas') && U.cancShow(nothing, 'todas', 'todas') && !U.cancShow(money, 'ocultar', 'todas'));
  assert.ok(U.cancShow(nothing, 'ocultar', 'canc'), 'the Canceladas filter shows $0 ones too'); assert.ok(U.cancShow({ bookings: [{}] }, 'ocultar', 'todas'));
  assert.strictEqual(U.cancMode('x'), 'dinero'); assert.strictEqual(U.grossOf({ gross: 100, cn: { kept: 50 } }), 150);
  assert.strictEqual(U.cancAntes(1560), 'cancelada 26 h antes'); assert.strictEqual(U.cancAntes(40), 'cancelada 40 min antes');
  assert.ok(U.DEP_FILTERS.find(f => f.key === 'canc').test(d) && !U.DEP_FILTERS.find(f => f.key === 'tours').test(d) && !U.DEP_FILTERS.find(f => f.key === 'rentas').test(d));
});

test('client: pending alert counts in ⚠ and "Con advertencias"; cancelled never in Tours/Rentas/pax; decision removes the alert', () => {
  const d = dep(), f = U.DEP_FILTERS.find(x => x.key === 'avisos');
  assert.ok(U.depAlerts(d, '2026-11-21 10:00').some(a => /¿se paga\?.*40 min antes/.test(a)));
  assert.strictEqual(U.depAlertN(d, '2026-11-21 10:00'), 1); assert.ok(f.test(d, { nowKey: '2026-11-21 10:00' }));
  const s = U.daySummary([d], '2026-11-21 10:00', '2026-11-21', '2026-11-20');
  assert.strictEqual(s.warn, 1); assert.deepStrictEqual(J(s.t), { n: 0, pax: 0 }); assert.deepStrictEqual(J(s.r), { n: 0, pax: 0 });
  const d2 = dep(); U.optApply({ deps: [d2], moves: [], purchases: [], items: [] }, { id: 'q1', fn: 'addAjusteSalida', args: [{ av: '9500', tipo: 'decision', persona: '', concepto: 'Cancelación: no se paga', monto: 0, motivo: '' }] }, { today: '2026-11-21', hm: '10:00', user: 'Omri' });
  assert.ok(!U.cancPend(d2)); assert.strictEqual(U.depAlertN(d2, '2026-11-21 10:00'), 0);
});

test('UI wiring: 3 actions, Ajustes › Canceladas, cancelled strip, bookings split, sw CACHE = APP_VER v21', () => {
  ['data-cdec=\"${esc(d.id)}|50\"', '|100\"', '|0\"', 'Pagar 50%', 'Pagar completo', 'No pagar', 'data-canc-set', 'adv_ops_canc', 'data-czero', 'canceladas sin cobro', 'cuenta como ingreso', 'Cobrado sin reembolso', "key:'canc'"].forEach(k => assert.ok(html.indexOf(k) >= 0, k));
  assert.ok(/concepto:'Cancelación'/.test(html) && /Cancelada · decidido por /.test(html));
  assert.ok(/const APP_VER='v\d+'/.test(html) && /const CACHE = 'al-ops-v\d+'/.test(sw)); // generic: rounds bump it (round 25 test checks the pair)
  assert.ok(Number(E.BITACORA_RULE_V) >= 8);
});

test('end to end: webhook with a cancelled paid booking → Reservas kept cols, Salidas Cancelada sí, rebuildAll keeps them, getData deps carry cn', () => {
  const { fakeSpreadsheet, fakeEnv } = require('./lib');
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss); fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe), rows = n => ss.getSheetByName(n)._d.rows.slice(1).filter(r => r.some(v => v !== ''));
  const p = F.booking({ pk: 7700, av: 9700, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z', status: 'cancelled', paid: 90000, customers: [F.cust(100, 'Adult')], crew: [F.CREW[0]] });
  G.ex.doPost({ postData: { contents: JSON.stringify(p) } }); G.ex.ensureMapeos_(ss); G.ex.rebuildAll();
  const res = rows('Reservas')[0], sal = rows('Salidas')[0];
  assert.strictEqual(res[3], 'no'); assert.strictEqual(res[G.ex.RES_KEPT], 900); assert.ok(res[G.ex.RES_CTC]);
  assert.strictEqual(sal[G.ex.SAL_CANC], 'sí'); assert.strictEqual(sal[17], 900);
  const d = J(G.ex.buildDeps_({ desde: '2026-11-01', hasta: '2026-12-01', today: '2026-11-21', salidas: rows('Salidas'), bit: [], barcos: {}, productos: [], M: null, reservas: rows('Reservas'), crew: rows('Tripulación'), ev: rows('Eventuales'), ext: [], costos: [], revs: {} }))[0];
  assert.strictEqual(d.cn.kept, 900); assert.strictEqual(d.cn.all, true); assert.strictEqual(d.bookings.length, 0);
});

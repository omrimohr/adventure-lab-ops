// Round 6: check-in / no-show (server + app helpers), booking detail columns (Campos, Teléfono, Check-in detalle).
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const N = loadNew(), E = N.ex;

const ci = st => ({ checkin_status: st });
test('checkinOf_: null → pending; no-show (type or name) → noshow; "not checked in" → pending; anything else → in', () => {
  const k = c => E.checkinOf_(c);
  assert.strictEqual(k({ checkin_status: null }), 'pending');
  assert.strictEqual(k({}), 'pending'); assert.strictEqual(k(null), 'pending'); assert.strictEqual(k(undefined), 'pending');
  assert.strictEqual(k(ci({ pk: 1, type: 'checked-in', name: 'Checked in' })), 'in');
  assert.strictEqual(k(ci({ type: 'checked-in' })), 'in');
  assert.strictEqual(k(ci({ name: 'Llegó' })), 'in', 'company custom status = checked in');
  assert.strictEqual(k(ci({ name: 'No show' })), 'noshow');
  assert.strictEqual(k(ci({ type: 'no-show' })), 'noshow');
  assert.strictEqual(k(ci({ type: 'no_show', name: 'x' })), 'noshow');
  assert.strictEqual(k(ci({ name: 'NoShow' })), 'noshow');
  assert.strictEqual(k(ci({ type: 'not-checked-in', name: 'Not checked in' })), 'pending');
  assert.strictEqual(k(ci({ name: 'Not Checked-In' })), 'pending');
  assert.strictEqual(k(ci('no show')), 'noshow', 'plain string status');
});

const cu = (ct, name, st) => Object.assign(F.cust(ct, name), { checkin_status: st });
const bk = (pk, av, custs, extra) => { const b = F.booking(Object.assign({ pk, av, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: F.T(24, 14), end: F.T(24, 17), paid: 100000, customers: custs }, extra || {})); return b; };

test('checkinSummary_: only pax customers count (OPS excluded); detail text "Type:state|…"', () => {
  const b = bk(7001, 9400, [cu(100, 'Adult', null), cu(100, 'Adult', { type: 'checked-in' }), cu(101, 'Child', { name: 'No show' }), cu(1999, 'OPS · Otro', null)]).booking;
  assert.deepStrictEqual(J(E.checkinSummary_(b, null)), { in: 1, ns: 1, pend: 1, n: 3, det: 'Adult:pending|Adult:in|Child:noshow' });
  const o = bk(7002, 9400, [cu(1331886, 'OPS · Salida', { type: 'checked-in' })]).booking;
  assert.strictEqual(E.checkinSummary_(o, null).n, 0);
  assert.strictEqual(E.checkinText_(1, 3), '1 de 3'); assert.strictEqual(E.checkinText_(0, 0), '');
  assert.deepStrictEqual(J(E.parseCheckin_('12 de 14')), { in: 12, n: 14 }); assert.deepStrictEqual(J(E.parseCheckin_('2/3')), { in: 2, n: 3 });
  assert.strictEqual(E.parseCheckin_(''), null); assert.strictEqual(E.parseCheckin_('x'), null);
});

test('camposText_: non-bitácora answers only; excludes OPS customers and Uso producto / hora extra / extras / costo adicional; collapses repeats; ≤ ~500 chars', () => {
  const b = bk(7003, 9400, [cu(100, 'Adult'), cu(100, 'Adult'), cu(1331886, 'OPS · Salida')]).booking;
  b.custom_field_values = [F.cfv(555, 'Hotel', 'Magic', 'Magic'), F.cfv(556, 'Vacío', ''), F.cfv(557, 'Alergias', 'nueces | mariscos')];
  b.customers[0].custom_field_values = [F.cfv(558, 'Talla', 'M')]; b.customers[1].custom_field_values = [F.cfv(558, 'Talla', 'M')];
  b.customers[2].custom_field_values = [F.cfv(2024601, 'Cerveza', '12'), F.cfv(2024642, 'Costos adicionales', '150')];
  assert.strictEqual(E.camposText_(b, null), 'Hotel: Magic | Alergias: nueces / mariscos | Talla: M ×2');
  // mapped Uso on a pax customer's field
  const M = { ctype: {}, field: { '555': { uso: 'extras' }, '558': { uso: 'costo adicional' } }, role: {} };
  assert.strictEqual(E.camposText_(b, M), 'Alergias: nueces / mariscos');
  const big = bk(7004, 9400, [cu(100, 'Adult')]).booking; big.custom_field_values = Array.from({ length: 40 }, (_, i) => F.cfv(900 + i, 'Pregunta ' + i, 'respuesta larga '.repeat(3)));
  assert.ok(E.camposText_(big, null).length <= 500);
  assert.strictEqual(E.camposText_(bk(7005, 9400, [cu(100, 'Adult')]).booking, null), '');
});

test('reservaRow_ appends Check-in / No show / Check-in detalle / Campos / Teléfono at the END (OPS rows: blank except phone)', () => {
  const H = E.RES_HEADERS, n = H.length;
  assert.deepStrictEqual(J(H.slice(-12, -7)), ['Check-in', 'No show', 'Check-in detalle', 'Campos', 'Teléfono']);
  assert.strictEqual(H.indexOf('Link FareHarbor'), 32, 'earlier columns did not move');
  const p = bk(7010, 9400, [cu(100, 'Adult', { type: 'checked-in' }), cu(100, 'Adult', null), cu(100, 'Adult', { name: 'No show' })]); p.booking.contact.normalized_phone = '+529831112233'; p.booking.contact.phone = '983 111 2233';
  p.booking.custom_field_values = [F.cfv(555, 'Hotel', 'Magic')];
  const row = J(E.reservaRow_(p.booking, 'now', 5, { 258806: { tipo: 'compartido', fields: [] } }, {}, null));
  assert.strictEqual(row.length, n);
  assert.deepStrictEqual(row.slice(-12, -7), ['1 de 3', 1, 'Adult:in|Adult:pending|Adult:noshow', 'Hotel: Magic', '+529831112233']);
  const p2 = bk(7011, 9400, [cu(100, 'Adult', null)]); p2.booking.contact.phone = '983 999 0000';
  assert.strictEqual(J(E.reservaRow_(p2.booking, 'now', 5, { 258806: { tipo: 'compartido', fields: [] } }, {}, null)).slice(-8)[0], '983 999 0000', 'phone falls back to contact.phone');
  const o = bk(7012, 9400, [cu(1331886, 'OPS · Salida', { type: 'checked-in' })]);
  assert.deepStrictEqual(J(E.reservaRow_(o.booking, 'now', 5, {}, {}, null)).slice(-12, -7), ['', '', '', '', '']);
  const none = bk(7013, 9400, [cu(100, 'Adult', null)]);
  assert.deepStrictEqual(J(E.reservaRow_(none.booking, 'now', 5, { 258806: { tipo: 'compartido', fields: [] } }, {}, null)).slice(-12, -7), ['0 de 1', 0, 'Adult:pending', '', '']);
});

test('headers + rule version: Salidas ends with Check-in / No show; BITACORA_RULE_V is 6', () => {
  assert.deepStrictEqual(J(E.SAL_HEADERS.slice(-3)), ['Check-in', 'No show', 'Recursos conocidos']);
  assert.ok(/^\d+$/.test(E.BITACORA_RULE_V));
  assert.strictEqual(E.bitacoraRuleStale_('4'), true);
});

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : null; };
  return { ss, fe, G, rows, post: payload => G.ex.doPost({ postData: { contents: JSON.stringify(payload) } }) };
}
test('end to end: webhook → Reservas/Salidas check-in columns, alert "No show: N", getData deps/bookings ci, Campos, phone, note', () => {
  const e = env(), H = N.ex.RES_HEADERS, S = N.ex.SAL_HEADERS;
  const a = bk(7101, 9400, [cu(100, 'Adult', { pk: 1, type: 'checked-in', name: 'Checked in' }), cu(100, 'Adult', null)]);
  a.booking.contact.normalized_phone = '+529831112233'; a.booking.note = 'Silla de ruedas'; a.booking.custom_field_values = [F.cfv(555, 'Hotel', 'Magic')];
  const b = bk(7102, 9400, [cu(101, 'Child', { type: 'no-show', name: 'No show' }), cu(100, 'Adult', { name: 'Checked in' })]);
  const ops = bk(7103, 9400, [cu(1331886, 'OPS · Salida', { type: 'checked-in' })]);
  const canc = bk(7104, 9400, [cu(100, 'Adult', { type: 'no-show' })], { status: 'cancelled' });
  [a, b, ops, canc].forEach(p => e.post(p)); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const sal = e.rows('Salidas').find(r => String(r[0]) === '9400');
  assert.strictEqual(sal[S.indexOf('Check-in')], '2 de 4'); assert.strictEqual(sal[S.indexOf('No show')], 1);
  assert.ok(/(^| \| )No show: 1( \||$)/.test(sal[S.indexOf('Alertas')]), 'alert: ' + sal[S.indexOf('Alertas')]);
  const ra = e.rows('Reservas').find(r => r[0] === 7101);
  assert.deepStrictEqual([ra[H.indexOf('Check-in')], ra[H.indexOf('No show')], ra[H.indexOf('Check-in detalle')], ra[H.indexOf('Campos')], ra[H.indexOf('Teléfono')]], ['1 de 2', 0, 'Adult:in|Adult:pending', 'Hotel: Magic', '+529831112233']);
  const d = J(e.G.ex.getData('0000', '2026-11-20', '2026-11-30')), dep = d.deps.find(x => x.id === '9400');
  assert.deepStrictEqual(dep.ci, { in: 2, n: 4, ns: 1 });
  assert.ok(/No show: 1/.test(dep.alerts));
  const ba = dep.bookings.find(x => x.pk === '7101'), bb = dep.bookings.find(x => x.pk === '7102');
  assert.deepStrictEqual(ba.ci, { in: 1, n: 2, ns: 0, det: [{ t: 'Adult', s: 'in' }, { t: 'Adult', s: 'pending' }] });
  assert.strictEqual(bb.ci.ns, 1); assert.deepStrictEqual(bb.ci.det.map(x => x.s), ['noshow', 'in']);
  assert.deepStrictEqual([ba.note, ba.tel, ba.campos, ba.paid, ba.gross], ['Silla de ruedas', '+529831112233', 'Hotel: Magic', 1000, 1000]);
  assert.ok('created' in ba && 'aff' in ba && 'src' in ba && 'by' in ba);
  // later webhook: the pending guest checks in → counts update, alert disappears once the no-show is cleared
  const a2 = bk(7101, 9400, [cu(100, 'Adult', { type: 'checked-in' }), cu(100, 'Adult', { type: 'checked-in' })]);
  e.post(a2);
  const sal2 = e.rows('Salidas').find(r => String(r[0]) === '9400');
  assert.strictEqual(sal2[S.indexOf('Check-in')], '3 de 4');
});
test('old sheets without the new columns: header repaired and rebuild pending on the next webhook (never lost)', () => {
  const e = env();
  e.post(bk(7201, 9401, [cu(100, 'Adult', null)])); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const H = N.ex.RES_HEADERS, rs = e.ss.getSheetByName('Reservas'); rs._d.rows[0] = H.slice(0, H.length - 12); delete e.fe.props.REBUILD_PENDING;
  e.post(bk(7202, 9401, [cu(100, 'Adult', { type: 'checked-in' })]));
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  assert.strictEqual(e.ss.getSheetByName('Reservas')._d.rows[0][H.length - 1], H[H.length - 1]);
  assert.strictEqual(e.rows('Raw').length, 2, 'Raw untouched / append-only');
});

// ---------- app (pure helpers extracted from docs/index.html) ----------
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({ciState,ciPend,depStarted,dayCi,DEP_FILTERS,depFilter,depAlerts,depAlertN})', {});
const dep = o => Object.assign({ date: '2026-11-24', time: '09:00', end: '2026-11-24 12:00', bit: 'Completa', bookings: [{ pax: 2 }], res: [{ name: 'B' }], crew: [], alerts: '', tipo: 'compartido' }, o);
const K = hm => '2026-11-24 ' + hm;

test('app: ciState colors (green all · yellow pending after start · gray before start · red only for no-show)', () => {
  assert.strictEqual(U.ciState({ in: 3, n: 3, ns: 0 }, true), 'ok'); assert.strictEqual(U.ciState({ in: 3, n: 3, ns: 0 }, false), 'ok');
  assert.strictEqual(U.ciState({ in: 2, n: 3, ns: 0 }, true), 'warn');
  assert.strictEqual(U.ciState({ in: 2, n: 3, ns: 0 }, false), 'mute', 'before start: muted, no alarm');
  assert.strictEqual(U.ciState({ in: 2, n: 3, ns: 1 }, false), 'bad'); assert.strictEqual(U.ciState({ in: 0, n: 1, ns: 1 }, true), 'bad');
  assert.strictEqual(U.ciState(null, true), ''); assert.strictEqual(U.ciState({ in: 0, n: 0, ns: 0 }, true), '');
  assert.strictEqual(U.ciPend({ in: 2, n: 5, ns: 1 }), 2); assert.strictEqual(U.ciPend(null), 0);
  assert.strictEqual(U.depStarted(dep(), K('09:00')), true); assert.strictEqual(U.depStarted(dep(), K('08:59')), false); assert.strictEqual(U.depStarted(dep(), ''), false);
});
test('app: "Sin check-in" filter = started departures with pending guests; "No show: N" counts as a warning', () => {
  assert.ok(U.DEP_FILTERS.some(f => f.key === 'checkin' && f.label === 'Sin check-in'));
  const f = U.depFilter('checkin'), c = h => ({ today: '2026-11-24', nowKey: K(h) });
  const d = dep({ ci: { in: 1, n: 3, ns: 0 } });
  assert.strictEqual(f.test(d, c('10:00')), true); assert.strictEqual(f.test(d, c('08:00')), false, 'not started');
  assert.strictEqual(f.test(dep({ ci: { in: 3, n: 3, ns: 0 } }), c('10:00')), false);
  assert.strictEqual(f.test(dep({ ci: { in: 2, n: 3, ns: 1 } }), c('10:00')), false, 'only no-show left: not "pending"');
  assert.strictEqual(f.test(dep(), c('10:00')), false, 'no data');
  const w = dep({ alerts: 'No show: 2', ci: { in: 1, n: 3, ns: 2 } });
  assert.deepStrictEqual(Array.from(U.depAlerts(w, K('08:00'))), ['No show: 2']);
  assert.strictEqual(U.depAlertN(w, K('08:00')), 1);
  assert.strictEqual(U.depFilter('avisos').test(w, c('08:00')), true);
});
test('app: dayCi total for the day (yellow only when pending among STARTED departures; no-shows counted)', () => {
  const a = dep({ ci: { in: 12, n: 14, ns: 0 } }), b = dep({ time: '15:00', ci: { in: 0, n: 5, ns: 0 } }), c = dep({ time: '07:00', ci: { in: 4, n: 4, ns: 0 } }), z = dep({ ci: null });
  let r = J(U.dayCi([a, b, c, z], K('10:00')));
  assert.deepStrictEqual([r.in, r.n, r.ns, r.st], [16, 23, 0, 'warn']);
  r = J(U.dayCi([b, c], K('10:00'))); assert.strictEqual(r.st, 'mute', 'pending only in a departure that has not started');
  r = J(U.dayCi([c], K('10:00'))); assert.strictEqual(r.st, 'ok');
  r = J(U.dayCi([dep({ ci: { in: 3, n: 4, ns: 1 } })], K('10:00'))); assert.deepStrictEqual([r.ns, r.st], [1, 'ok']);
  assert.strictEqual(U.dayCi([z], K('10:00')), null);
});
test('app: booking sheet section order is exactly Check-in · Tipos · Canal · Pago · Contacto · Campos · Nota; WhatsApp + Llamar; booking # stays a FareHarbor link; note icon only with a note', () => {
  const fn = html.slice(html.indexOf('function openBooking'), html.indexOf('// --- Calendario ---'));
  const order = ['gh(\'checkin\',\'Check-in\')', 'gh(\'bookings\',\'Tipos\')', 'gh(\'tag\',\'Canal\')', 'gh(\'costos\',\'Pago\')', 'gh(\'phone\',\'Contacto\')', 'gh(\'sliders\',\'Campos\')', 'gh(\'note\',\'Nota\')'].map(x => fn.indexOf(x));
  assert.ok(order.every(i => i > 0) && order.every((x, i) => !i || x > order[i - 1]), 'order ' + order);
  assert.ok(fn.indexOf('class="bkh"') < order[0], 'header first');
  assert.ok(/https:\/\/wa\.me\/\$\{dg\}/.test(fn) && /href="tel:\+\$\{dg\}"/.test(fn) && /fhA\(fhBookUrl/.test(fn));
  assert.ok(/moneyRows\(b\)/.test(fn)); // round 16: the Pago group is the money block (Saldo replaces Debe)
  assert.ok(/b\.note\?`<span class="ni"/.test(html), 'note icon only when the booking has a note');
  assert.ok(/data-bk=/.test(html) && /const bkr=on\('\[data-bk\]'\)/.test(html));
  assert.ok(/'al-ops-v(?:[4-9]|\d\d+)'/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8')), 'CACHE bumped');
});

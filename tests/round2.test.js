// UI round 2: resources per departure, gross + net, stale flag (no synchronous rebuild in getData), header migration.
const assert = require('assert');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const N = loadNew(), E = N.ex;
const NOW = new Date('2026-11-24T12:00:00Z');
const tours = J(E.toursFromRows_(N.get('TOURS_SEED')));

const ru = (pk, rpk, name, n) => ({ pk: pk, resource: { pk: rpk, name: name, short_name: name.slice(0, 3) }, use_count: n });

test('resourcesFrom_: unique by resource pk, use_count summed, name kept, separators stripped', () => {
  const r = J(E.resourcesFrom_([
    { resource_uses: [ru(1, 309946, 'Barracuda', 6), ru(2, 309950, 'Ramona', 4)] },
    { resource_uses: [ru(3, 309946, 'Barracuda', 4)] },
    { resource_uses: [ru(4, 777, 'Cat: A|B', 2)] }, {}
  ]));
  assert.deepStrictEqual(r, [{ pk: '309946', name: 'Barracuda', n: 10 }, { pk: '309950', name: 'Ramona', n: 4 }, { pk: '777', name: 'Cat A B', n: 2 }]);
  assert.deepStrictEqual(J(E.resourcesFrom_([])), []);
  assert.deepStrictEqual(J(E.resourcesFrom_([{ resource_uses: [{ resource: { pk: 5, name: 'X' } }] }])), [{ pk: '5', name: 'X', n: 1 }], 'no use_count → 1');
  const t = r.map(x => x.pk + ':' + x.name + ':' + x.n).join('|');
  assert.deepStrictEqual(J(E.resFromText_(t)), r);
});

function dep() {
  const mk = (pk, extra, status) => { const p = F.booking({ pk: pk, av: 9300, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-11-25T14:00:00Z', end: '2026-11-25T17:00:00Z',
    paid: 100000, status: status, customers: [F.cust(100, 'Adult'), F.cust(100, 'Adult')] }); Object.assign(p.booking, extra); return p; };
  return [
    mk(7001, { resource_uses: [ru(1, 309946, 'Barracuda', 2)] }),
    mk(7002, { resource_uses: [ru(2, 309946, 'Barracuda', 3), ru(3, 309950, 'Ramona', 1)] }),
    mk(7003, { resource_uses: [ru(4, 555, 'Cancelado', 9)] }, 'cancelled'),
    F.booking({ pk: 7004, av: 9300, item: 258806, itemName: 'x', start: '2026-11-25T14:00:00Z', end: '2026-11-25T17:00:00Z', customers: [F.cust(1331886, 'OPS · Salida')] })
  ];
}
test('computeSalida_: resources from active customer bookings only (not cancelled, not OPS) → last two Salidas columns', () => {
  const list = dep().map((p, i) => ({ b: J(p).booking, row: i + 2 }));
  list[3].b.resource_uses = [ru(9, 888, 'OPS barco', 5)];
  const s = J(E.computeSalida_('9300', list, tours, NOW, {}, null)).salida;
  const H = E.SAL_HEADERS;
  assert.deepStrictEqual(J(H.slice(-2)), ['Recursos', 'Recursos pk']);
  assert.strictEqual(s.length, H.length);
  assert.strictEqual(s[H.length - 2], 'Barracuda (5) · Ramona (1)');
  assert.strictEqual(s[H.length - 1], '309946:Barracuda:5|309950:Ramona:1');
});

test('salHeaderStale_: shorter header row (older version) is stale', () => {
  const H = E.SAL_HEADERS;
  assert.strictEqual(E.salHeaderStale_(H.slice(0, H.length - 2)), true);
  assert.strictEqual(E.salHeaderStale_(H.slice()), false);
  assert.strictEqual(E.salHeaderStale_(undefined), true);
});

test('windowTest_ keeps exact semantics and skips Utilities for ISO strings far outside the window', () => {
  const w = N.ex.windowTest_('2026-11-10', '2026-11-20');
  assert.strictEqual(w('2026-11-10T09:00:00-0500'), true);
  assert.strictEqual(w('2026-11-20T23:00:00-0500'), true);
  assert.strictEqual(w('2026-11-21T09:00:00-0500'), false);
  assert.strictEqual(w('2026-11-09T09:00:00-0500'), false);
  assert.strictEqual(w('2026-12-30T09:00:00-0500'), false);
  assert.strictEqual(w('2026-11-21T02:00:00Z'), true, '21st 02:00Z is the 20th 21:00 in Cancún');
  assert.strictEqual(w(new Date('2026-11-15T15:00:00Z')), true);
});

test('staleFin_: Salidas changed after FIN_AT', () => {
  const rows = [[], []]; rows[0][16] = new Date(1000); rows[1][16] = '2026-11-24T12:00:00.000Z';
  assert.strictEqual(N.ex.staleFin_(rows, 0), true);
  assert.strictEqual(N.ex.staleFin_(rows, Date.parse('2026-11-24T12:00:00.000Z')), false);
  assert.strictEqual(N.ex.staleFin_([], 0), false);
});

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : null; };
  return { ss, fe, G, rows, post: p => G.ex.doPost({ postData: { contents: JSON.stringify(p) } }) };
}

test('getData: gross per booking and departure (cancelled/OPS excluded), resources, end time, no synchronous rebuild, stale flag; refreshFin clears it', () => {
  const e = env();
  dep().forEach(p => e.post(p));
  e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll(); // seeds + builds everything, sets FIN_AT
  e.fe.props.FIN_AT = String(Date.now() - 5000);
  e.post(F.booking({ pk: 7010, av: 9300, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-11-25T14:00:00Z', end: '2026-11-25T17:00:00Z', paid: 50000,
    customers: [F.cust(100, 'Adult'), F.cust(101, 'Child')] }));
  let rebuilds = 0; const orig = e.G.ctx.rebuildFinanzas_;
  e.G.ctx.rebuildFinanzas_ = function () { rebuilds++; return orig.apply(this, arguments); };
  const d = J(e.G.ex.getData('0000', '2026-11-20', '2026-11-30'));
  assert.strictEqual(rebuilds, 0, 'getData never rebuilds');
  assert.strictEqual(d.stale, true);
  assert.strictEqual(d.fhOk, true);
  const dd = d.deps.find(x => x.id === '9300');
  assert.deepStrictEqual(dd.bookings.map(b => b.gross).sort((a, b) => a - b), [500, 1000, 1000]);
  assert.strictEqual(dd.gross, 2500);
  assert.deepStrictEqual(dd.res, [{ pk: '309946', name: 'Barracuda', n: 5 }, { pk: '309950', name: 'Ramona', n: 1 }]);
  assert.strictEqual(dd.end, '2026-11-25 12:00');
  assert.ok(dd.bookings.every(b => b.types));
  // the app asks refreshFin in the background
  const r = J(e.G.ex.refreshFin('0000'));
  assert.deepStrictEqual(r, { ran: true });
  assert.strictEqual(rebuilds, 1);
  assert.strictEqual(J(e.G.ex.getData('0000', '2026-11-20', '2026-11-30')).stale, false);
  e.fe.setLockBusy(true);
  assert.deepStrictEqual(J(e.G.ex.refreshFin('0000')), { ran: false, busy: true });
  assert.throws(() => e.G.ex.refreshFin('9999'), /PIN/);
});

test('old Salidas sheet (fewer columns): trigger sets REBUILD_PENDING, full rebuild recomputes the new columns for old departures', () => {
  const e = env();
  dep().forEach(p => e.post(p)); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const sal = e.ss.getSheetByName('Salidas'), H = E.SAL_HEADERS;
  sal._d.rows[0] = H.slice(0, H.length - 2);           // pretend the sheet was written by the previous version
  sal._d.rows.slice(1).forEach(r => { r[H.length - 2] = ''; r[H.length - 1] = ''; });
  delete e.fe.props.REBUILD_PENDING;
  e.G.ex.rebuildFinanzas();                              // 15-min trigger
  assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined, 'the rebuild ran and cleared the flag');
  assert.strictEqual(e.ss.getSheetByName('Salidas')._d.rows[0].length, H.length);
  assert.strictEqual(e.rows('Salidas')[0][H.length - 2], 'Barracuda (5) · Ramona (1)');
});

test('webhook on an old Salidas sheet: header gets the new columns and REBUILD_PENDING is set (history not left half-empty)', () => {
  const e = env();
  dep().forEach(p => e.post(p)); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const H = E.SAL_HEADERS; e.ss.getSheetByName('Salidas')._d.rows[0] = H.slice(0, H.length - 2);
  delete e.fe.props.REBUILD_PENDING;
  e.post(F.booking({ pk: 7011, av: 9300, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-11-25T14:00:00Z', end: '2026-11-25T17:00:00Z', customers: [F.cust(100, 'Adult')] }));
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  assert.strictEqual(e.ss.getSheetByName('Salidas')._d.rows[0][H.length - 1], 'Recursos pk');
});

// ---------- round 3: FareHarbor links, staff meals ----------
test('Reservas: "Link FareHarbor" is the LAST column, filled from booking.dashboard_url (blank when absent)', () => {
  const H = E.RES_HEADERS;
  assert.strictEqual(H[H.length - 1], 'Link FareHarbor');
  const url = 'https://fareharbor.com/thegaiaexperience/dashboard/?overlay=/contacts/1/bookings/abc/';
  const p = dep()[0]; p.booking.dashboard_url = url;
  const row = J(E.reservaRow_(p.booking, NOW, 5, tours, {}, null));
  assert.strictEqual(row.length, H.length);
  assert.strictEqual(row[H.length - 1], url);
  assert.strictEqual(J(E.reservaRow_(dep()[1].booking, NOW, 5, tours, {}, null))[H.length - 1], '');
});

test('old Reservas sheet (no link column): header fixed + REBUILD_PENDING; full rebuild refills links from Raw; getData exposes url, salidaUrl, regresoUrl, itemPk', () => {
  const e = env(), U = id => 'https://fareharbor.com/thegaiaexperience/dashboard/?overlay=/contacts/9/bookings/' + id + '/';
  const ps = dep(); ps.forEach(p => { p.booking.dashboard_url = U(p.booking.pk); });
  ps.forEach(p => e.post(p)); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const H = E.RES_HEADERS, rs = e.ss.getSheetByName('Reservas');
  rs._d.rows[0] = H.slice(0, H.length - 1); rs._d.rows.slice(1).forEach(r => { r[H.length - 1] = ''; });
  delete e.fe.props.REBUILD_PENDING;
  e.G.ex.rebuildFinanzas();                               // trigger notices the short header → full rebuild
  assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined);
  assert.strictEqual(e.ss.getSheetByName('Reservas')._d.rows[0][H.length - 1], 'Link FareHarbor');
  const d = J(e.G.ex.getData('0000', '2026-11-20', '2026-11-30')), dd = d.deps.find(x => x.id === '9300');
  assert.strictEqual(dd.itemPk, '258806');
  assert.ok(dd.bookings.length && dd.bookings.every(b => b.url === U(b.id.replace('#', '')) || /^https:\/\/fareharbor\.com\//.test(b.url)));
  assert.strictEqual(dd.salidaUrl, U(7004), 'OPS Salida booking link');
  assert.strictEqual(dd.regresoUrl, '');
  // webhook on an old sheet: header repaired, pending set
  rs._d.rows[0] = H.slice(0, H.length - 1); delete e.fe.props.REBUILD_PENDING;
  e.post(F.booking({ pk: 7012, av: 9300, item: 258806, itemName: 'x', start: '2026-11-25T14:00:00Z', end: '2026-11-25T17:00:00Z', customers: [F.cust(100, 'Adult')] }));
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  assert.strictEqual(e.ss.getSheetByName('Reservas')._d.rows[0][H.length - 1], 'Link FareHarbor');
});

test('staff meals: cde/cda are reused and renamed only while they still carry the old seed name; missing ones are added; idempotent', () => {
  const seed = id => E.PROD_SEED.filter(r => r[0] === id)[0];
  assert.strictEqual(seed('cde')[1], 'Desayuno Staff'); assert.strictEqual(seed('cda')[1], 'Almuerzo Staff');
  assert.strictEqual(seed('cde')[5], 'no'); assert.strictEqual(seed('cde')[8], 40); assert.strictEqual(seed('cda')[8], 50);
  const old = [['cer', 'Cerveza'], ['cde', 'Comida empleado · desayuno'], ['cda', 'Almuerzo (editado por Omri)']];
  const p = J(E.planStaffMeals_(old));
  assert.deepStrictEqual(p.renames, [{ idx: 1, name: 'Desayuno Staff' }]);
  assert.deepStrictEqual(p.appends, []);
  assert.deepStrictEqual(J(E.planStaffMeals_([['cer', 'Cerveza']])).appends.map(r => r[0]), ['cde', 'cda']);
  assert.deepStrictEqual(J(E.planStaffMeals_([['cde', 'Desayuno Staff'], ['cda', 'Almuerzo Staff']])), { renames: [], appends: [] });
  // end to end on a sheet
  const e = env(); const sh = e.ss.insertSheet('Productos');
  sh.appendRow(['ID', 'Producto']);
  sh.appendRow(['cde', 'Comida empleado · desayuno', 'Comida empleado', 'comida', 1, 'no', 0, '', 40, 'sí', '']);
  e.G.ex.ensureStaffMeals_(e.ss); e.G.ex.ensureStaffMeals_(e.ss);
  const r = e.rows('Productos');
  assert.deepStrictEqual(r.map(x => [x[0], x[1]]), [['cde', 'Desayuno Staff'], ['cda', 'Almuerzo Staff']]);
});

test('round 4: bitácora applies to every tipo except renta; "Sin recurso asignado" alert; rule-version flag', () => {
  const list = dep().slice(0, 1).map((p, i) => ({ b: J(p).booking, row: i + 2 }));
  const run = (tipo, l) => J(E.computeSalida_('9300', l || list, { '258806': { tipo: tipo, fields: [], bitacora: false } }, NOW, {}, null)).salida;
  const H = E.SAL_HEADERS, iB = H.indexOf('Bitácora'), iA = H.indexOf('Alertas');
  assert.strictEqual(run('compartido')[iB], 'Sin bitácora');     // Tours "Lleva bitácora" = no, still applies
  assert.strictEqual(run('privado')[iB], 'Sin bitácora');
  assert.strictEqual(run('?')[iB], 'Sin bitácora');
  assert.strictEqual(run('renta')[iB], 'No aplica');
  assert.strictEqual(E.bitacoraNoAplica_(' Renta '), true);
  assert.strictEqual(E.bitacoraNoAplica_('compartido'), false);
  assert.ok(!/Sin recurso/.test(run('compartido')[iA]));
  const nores = J(list); nores[0].b.resource_uses = [];
  assert.ok(/Sin recurso asignado/.test(run('compartido', nores)[iA]));
  const cancelled = J(nores); cancelled[0].b.status = 'cancelled';
  assert.ok(!/Sin recurso/.test(run('compartido', cancelled)[iA]), 'no active customer bookings → no warning');
  assert.strictEqual(E.bitacoraRuleStale_(undefined), true);
  assert.strictEqual(E.bitacoraRuleStale_('1'), true);
  assert.strictEqual(E.bitacoraRuleStale_(E.BITACORA_RULE_V), false);
});

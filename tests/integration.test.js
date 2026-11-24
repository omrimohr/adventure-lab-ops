// End-to-end on an in-memory Spreadsheet: webhook hardening, seeding, unknowns, setMapeo → REBUILD_PENDING → rebuild from Raw.
const assert = require('assert');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : null; };
  const post = payload => G.ex.doPost({ postData: { contents: JSON.stringify(payload) } });
  return { ss, fe, G, rows, post };
}
const col = (rows, i) => rows.map(r => r[i]);

test('doPost: mapping tabs missing → Raw is written, derived step skipped, REBUILD_PENDING set', () => {
  const e = env();
  assert.strictEqual(e.post(F.DEPARTURES[9001][0]).text, 'ok');
  assert.strictEqual(e.rows('Raw').length, 1);
  assert.strictEqual(e.ss.getSheetByName('Reservas'), null);
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  assert.strictEqual(e.ss.getSheetByName('Tipos de cliente'), null, 'webhook never seeds');
});

test('doPost: lock busy → Raw still appended (no data dropped), pending flag + Errores row', () => {
  const e = env();
  e.fe.setLockBusy(true);
  assert.strictEqual(e.post(F.DEPARTURES[9001][0]).text, 'ok');
  assert.strictEqual(e.rows('Raw').length, 1);
  assert.strictEqual(e.rows('Raw')[0][3], 5001);
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  assert.ok(/candado/.test(e.rows('Errores')[0][2]));
  assert.strictEqual(e.ss.getSheetByName('Reservas'), null);
  e.fe.setLockBusy(false);
});

test('seeding from Raw (ensureMapeos_) creates the three tabs with Estado OK and the Tours Estado column', () => {
  const e = env();
  F.DEPARTURES[9001].forEach(p => e.post(p)); e.post(F.DEPARTURES[9002][0]);
  assert.strictEqual(e.G.ex.ensureMapeos_(e.ss), true);
  assert.strictEqual(e.G.ex.ensureMapeos_(e.ss), false, 'idempotent');
  const ct = e.rows('Tipos de cliente'), cf = e.rows('Campos'), rl = e.rows('Roles');
  assert.ok(ct.length >= 6 && cf.length >= 12 && rl.length >= 5);
  assert.ok([ct.map(r => r[3]), cf.map(r => r[4]), rl.map(r => r[4])].every(a => a.every(x => x === 'OK')));
  assert.deepStrictEqual(J(e.ss.getSheetByName('Tipos de cliente')._d.rows[0]), J(e.G.get('CT_HEADERS')));
  const tours = e.rows('Tours');
  assert.ok(tours.length === 30 && tours.every(r => r[7] === 'OK'));
  assert.strictEqual(e.ss.getSheetByName('Tours')._d.rows[0][7], 'Estado');
});

test('webhook with unknowns: derived tabs written with defaults; unknown type/field/role/item appended as "Nuevo – revisar"', () => {
  const e = env();
  e.post(F.DEPARTURES[9001][0]); e.G.ex.ensureMapeos_(e.ss);
  const nb = F.booking({ pk: 6001, av: 9100, item: 999001, itemName: 'Tour Nuevo', start: '2026-11-27T15:00:00Z', end: '2026-11-27T17:00:00Z',
    crew: [F.crew(F.role(77, 'Piloto'), 'Pili', 'pili')], customers: [F.cust(4242, 'Student'), F.cust(4242, 'Student')], cfs: [F.cfv(8888, 'Pet name', 'Rex')] });
  e.post(nb); e.post(nb); // second one is a duplicate: nothing is added twice
  assert.strictEqual(e.rows('Raw').length, 3);
  const res = e.rows('Reservas'); assert.ok(res.some(r => r[0] === 6001 && r[14] === 2), 'Student counts as a person by default');
  const ct = e.rows('Tipos de cliente').filter(r => r[3] === 'Nuevo – revisar');
  assert.deepStrictEqual(ct.map(r => [r[0], r[1], r[2], r[5]]), [['4242', 'Student', 'pax', '999001 · Tour Nuevo']]);
  assert.deepStrictEqual(e.rows('Campos').filter(r => r[4] === 'Nuevo – revisar').map(r => [r[0], r[2], r[7]]), [['8888', 'ignorar', 'Rex']]);
  assert.deepStrictEqual(e.rows('Roles').filter(r => r[4] === 'Nuevo – revisar').map(r => [r[0], r[1], r[3]]), [['77', 'Piloto', 'piloto']]);
  const t = e.rows('Tours').find(r => r[0] === 999001);
  assert.deepStrictEqual([t[2], t[7]], ['compartido', 'Nuevo – revisar']);
  assert.strictEqual(e.rows('Tripulación').find(r => r[5] === 'Pili')[8], '77'); // Rol clave
});

test('setMapeo → REBUILD_PENDING → rebuildFinanzas (15-min trigger) rebuilds from Raw and clears the flag', () => {
  const e = env();
  F.DEPARTURES[9001].forEach(p => e.post(p));
  e.G.ex.ensureMapeos_(e.ss);
  e.G.ex.rebuildAll();
  const pax = () => e.rows('Reservas').find(r => r[0] === 5001)[14];
  assert.strictEqual(pax(), 5);
  delete e.fe.props.REBUILD_PENDING;
  const r = e.G.ex.setMapeo('0000', 'tipo', '102', { uso: 'no cuenta' });
  assert.deepStrictEqual(J(r), { ok: true, rebuildPending: true });
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  const row = e.rows('Tipos de cliente').find(x => x[0] === '102' || x[0] === 102);
  assert.deepStrictEqual([row[2], row[3], row[7]], ['no cuenta', 'OK', 'Omri']);
  assert.ok(row[8] instanceof Date);
  assert.strictEqual(pax(), 5, 'not recalculated yet');
  e.G.ex.rebuildFinanzas();
  assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined);
  assert.strictEqual(pax(), 4, 'history recalculated from Raw with the new mapping');
  // campo + rol + item
  e.G.ex.setMapeo('0000', 'campo', '2024650', { uso: 'producto', prod: 'cer' });
  e.G.ex.setMapeo('0000', 'rol', '12', { tarifa: 'Externo' });
  assert.throws(() => e.G.ex.setMapeo('0000', 'campo', '2024650', { uso: 'producto', prod: 'nope' }), /Producto desconocido/);
  assert.throws(() => e.G.ex.setMapeo('0000', 'tipo', '31337', { uso: 'pax' }), /No encontré/);
  assert.throws(() => e.G.ex.setMapeo('1234', 'tipo', '102', { uso: 'pax' }), /PIN/);
  e.G.ex.rebuildFinanzas();
  const bit = e.rows('Bitácora'); assert.ok(bit.length > 5);
  assert.ok(e.rows('Externos').length >= 2, 'role 12 (Marinero) is now externo');
});

test('rebuildFinanzas without a pending flag only refreshes finanzas; with the lock busy the flag stays', () => {
  const e = env();
  F.DEPARTURES[9001].forEach(p => e.post(p)); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  e.fe.props.BITACORA_RULE_V = e.G.ex.BITACORA_RULE_V; // rule v2 already applied
  assert.strictEqual(J(e.G.ex.rebuildFinanzas()).reconstruido, undefined);
  e.fe.props.REBUILD_PENDING = '1'; e.fe.setLockBusy(true);
  e.G.ex.rebuildFinanzas();
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
});

test('first run of the bitácora rule v2 sets REBUILD_PENDING and rebuilds once; the flag is stored', () => {
  const e = env();
  F.DEPARTURES[9001].forEach(p => e.post(p)); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  delete e.fe.props.BITACORA_RULE_V;
  assert.strictEqual(J(e.G.ex.rebuildFinanzas()).reconstruido, true);
  assert.strictEqual(e.fe.props.BITACORA_RULE_V, e.G.ex.BITACORA_RULE_V);
  assert.strictEqual(J(e.G.ex.rebuildFinanzas()).reconstruido, undefined);
});

test('getData returns pend (admin only), salud and rebuildPending', () => {
  const e = env();
  e.post(F.DEPARTURES[9001][0]); e.G.ex.ensureMapeos_(e.ss); delete e.fe.props.REBUILD_PENDING;
  e.post(F.booking({ pk: 6002, av: 9101, item: 999002, itemName: 'Tour Nuevo 2', start: '2026-11-27T15:00:00Z', end: '2026-11-27T17:00:00Z', customers: [F.cust(4343, 'Student')] }));
  const d = J(e.G.ex.getData('0000', '2026-11-01', '2026-12-31'));
  assert.strictEqual(d.ok, true); assert.strictEqual(d.rebuildPending, false);
  assert.deepStrictEqual(d.pend.map(x => [x.kind, x.clave, x.name]).sort(), [['item', '999002', 'Tour Nuevo 2'], ['tipo', '4343', 'Student']]);
  assert.ok(Array.isArray(d.salud));
  assert.ok(d.pend[0].visto);
  e.G.ex.setMapeo('0000', 'tipo', '4343', { uso: 'pax' });
  const d2 = J(e.G.ex.getData('0000', '2026-11-01', '2026-12-31'));
  assert.strictEqual(d2.rebuildPending, true); assert.deepStrictEqual(d2.pend.map(x => x.kind), ['item']);
});

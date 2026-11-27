// Round 29: no "Personas ≠ Seats" alert; no "Falta rol" for external crew.
const assert = require('assert');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const N = loadNew(), E = N.ex;

const cf = (pk, name, value) => ({ custom_field: { pk: pk, name: name }, value: value });
const M = () => E.mapeosFromRows_([], [['1', 'Personas', 'personas', '', 'OK'], ['2', 'QTY · Seats', 'seats', '', 'OK']], []);
test('private: people 4 vs seats 6 → pax 4, no alert', () => {
  const b = F.booking({ pk: 1, av: 1, item: 244132, itemName: 'Private Boat Tour', start: '2026-11-24T15:00:00Z', end: '2026-11-24T18:00:00Z',
    customers: [F.cust(1, 'Private', [cf(1, 'Personas', '4'), cf(2, 'QTY · Seats', '6')])] }).booking;
  const r = J(E.bookingPax_(b, { tipo: 'privado', fields: [] }, M()));
  assert.strictEqual(r.pax, 4); assert.strictEqual(r.alerta, '');
});
test('private: only seats / nothing keep their alerts', () => {
  const mk = cfvs => F.booking({ pk: 1, av: 1, item: 244132, itemName: 'P', start: '2026-11-24T15:00:00Z', end: '2026-11-24T18:00:00Z', customers: [F.cust(1, 'Private', cfvs)] }).booking;
  assert.strictEqual(J(E.bookingPax_(mk([cf(2, 'QTY · Seats', '6')]), { tipo: 'privado', fields: [] }, M())).alerta, 'Solo Seats (falta campo personas)');
  assert.strictEqual(J(E.bookingPax_(mk([]), { tipo: 'privado', fields: [] }, M())).alerta, 'Falta # de personas');
});

function salidaAlerts(crew) {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  G.ex.doPost({ postData: { contents: JSON.stringify(F.booking({ pk: 5, av: 9400, item: 244132, itemName: 'Private Boat Tour',
    start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z', customers: [F.cust(1, 'Private', [cf(1, 'Personas', '4')])], crew })) } });
  G.ex.ensureMapeos_(ss); G.ex.rebuildAll();
  const sh = ss.getSheetByName('Salidas');
  return sh._d.rows.slice(1).map(r => r.join(' | ')).join('\n');
}
test('Falta rol: staff yes, external (name or username "extern") no', () => {
  const out = salidaAlerts([{ user: { name: 'Pedro Staff', username: 'pedro' }, note: '' }, { user: { name: 'Juan', username: 'capitan externo' }, note: '' }, { user: { name: 'Externo Lalo', username: 'lalo' }, note: '' }]);
  assert.ok(out.indexOf('Falta rol: Pedro Staff') >= 0);
  assert.ok(out.indexOf('Falta rol: Juan') < 0 && out.indexOf('Falta rol: Externo Lalo') < 0);
});
test('BITACORA_RULE_V bumped (>= 10)', () => { assert.ok(Number(E.BITACORA_RULE_V) >= 10); assert.strictEqual(E.bitacoraRuleStale_('9'), true); });

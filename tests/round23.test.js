// Round 23: bitácora Salida/Regreso is decided per CUSTOMER type (one OPS booking, two customers), not per booking.
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
const cf = (pk, name, value) => ({ custom_field: { pk: pk, name: name }, value: value });
const ctype = (pk, name) => ({ customer_type_rate: { customer_type: { pk: pk, singular: name } } });
const oneCustomerPayload = () => {
  const p = F.booking({ pk: 393381546, av: 9300, item: 555001, itemName: 'Pontón Privado [AMNH]', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z',
    customers: [] });
  p.booking.affiliate_company = { name: 'OPS · Bitácora' };
  p.booking.customers = [
    Object.assign({ pk: 1149960137 }, ctype(1331886, 'OPS · Salida'), { custom_field_values: [
      cf(2010715, 'Cerveza', '8'), cf(2010717, 'Agua', '4'), cf(2010714, 'Refresco', '4'), cf(2024635, 'Fruta (personas)', ''),
      cf(2024634, 'Vino (botellas)', ''), cf(2011766, 'Hielo (bolsas)', '1'), cf(2012971, 'Gasolina (litros)', '0'), cf(2010728, 'Extras a bordo', '')] }),
    Object.assign({ pk: 1149960138 }, ctype(1332005, 'OPS · Regreso'), { custom_field_values: [
      cf(2010722, 'Cerveza', '8'), cf(2010724, 'Agua', '2'), cf(2010721, 'Refresco', '3'), cf(2024634, 'Vino (botellas)', ''), cf(2010487, 'Costos adicionales', '')] })
  ];
  return p;
};
function seeded(payload) {
  const e = env();
  e.post(payload); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  return e;
}
// map the fields of this payload to products (as Omri confirms them in Por configurar)
const prodMap = e => {
  [['2010715', 'cer'], ['2010722', 'cer'], ['2010717', 'agu'], ['2010724', 'agu'], ['2010714', 'ref'], ['2010721', 'ref'], ['2011766', 'hie'], ['2024634', 'vin']]
    .forEach(([pk, prod]) => e.G.ex.setMapeo('0000', 'campo', pk, { uso: 'producto', prod: prod }));
  e.G.ex.rebuildAll();
};

test('one OPS booking with an OPS · Salida and an OPS · Regreso customer: Bitácora rows get the side per customer', () => {
  const e = seeded(oneCustomerPayload()); prodMap(e);
  const bit = e.rows('Bitácora').filter(r => String(r[4]) === '393381546');
  const by = {}; bit.forEach(r => { by[r[5] + '|' + r[6]] = r; });
  assert.strictEqual(by['Salida|Cerveza'][8], 8); assert.strictEqual(by['Regreso|Cerveza'][8], 8);
  assert.strictEqual(by['Salida|Agua'][8], 4); assert.strictEqual(by['Regreso|Agua'][8], 2);
  assert.strictEqual(by['Salida|Refresco'][8], 4); assert.strictEqual(by['Regreso|Refresco'][8], 3);
  assert.strictEqual(by['Salida|Hielo (bolsas)'][8], 1); assert.strictEqual(by['Regreso|Hielo (bolsas)'], undefined);
  assert.strictEqual(by['Salida|Gasolina (litros)'][8], 0);
  // customer pk is recorded (last column)
  assert.strictEqual(e.G.ex.BIT_HEADERS[10], 'Customer pk');
  assert.strictEqual(String(by['Salida|Cerveza'][10]), '1149960137'); assert.strictEqual(String(by['Regreso|Agua'][10]), '1149960138');
  assert.strictEqual(bit.filter(r => r[5] === 'Salida').length + bit.filter(r => r[5] === 'Regreso').length, bit.length);
});

test('stock consumption = salió − regresó per product (Cerveza 0, Agua 2, Refresco 1, Hielo 1)', () => {
  const e = seeded(oneCustomerPayload()); prodMap(e);
  const bit = e.rows('Bitácora').filter(r => String(r[0]) === '9300');
  const productos = e.G.ex.PROD_SEED.map(r => ({ id: r[0], campo: r[7] }));
  const M = e.G.ex.loadMapeos_(e.ss);
  assert.deepStrictEqual(J(e.G.ex.consumoSalida_(bit, productos, M)), { agu: 2, ref: 1, hie: 1 });
  const bq = J(e.G.ex.bitQty_(bit, productos, M));
  assert.deepStrictEqual([bq.out.cer, bq.back.cer, bq.out.agu, bq.back.agu, bq.out.ref, bq.back.ref, bq.out.hie, bq.back.hie], [8, 8, 4, 2, 4, 3, 1, undefined]);
});

test('Ida and Regreso both "hecha": Salidas status Completa, the single booking fills both columns', () => {
  const e = seeded(oneCustomerPayload());
  const s = e.rows('Salidas').find(r => String(r[0]) === '9300');
  assert.strictEqual(s[11], 'Completa');
  assert.strictEqual(String(s[12]), '393381546'); assert.strictEqual(String(s[13]), '393381546');
  assert.ok(!/Más de una reserva/.test(s[15]));
  assert.strictEqual(e.rows('Reservas').find(r => String(r[0]) === '393381546')[13], 'Salida+Regreso');
  // client: bitParts → both done
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  const m = /function bitParts\(d,nowKey\)\{[\s\S]*?\n\}/.exec(html); assert.ok(m);
  const bitParts = new Function(m[0] + '; return bitParts;')();
  const r = bitParts({ bit: s[11], date: '2026-11-20', time: '09:00', end: '2026-11-20 12:00', bookings: [] }, '2026-11-21 00:00');
  assert.deepStrictEqual([r.ida, r.reg], ['done', 'done']);
});

test('old shape (separate Salida and Regreso bookings) still works and a pk on both sides counts once per side', () => {
  const e = env();
  const mk = (pk, ct, name, fields) => { const p = F.booking({ pk: pk, av: 9301, item: 555001, itemName: 'Pontón Privado [AMNH]', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z', customers: [] });
    p.booking.customers = [Object.assign({ pk: pk + 1 }, ctype(ct, name), { custom_field_values: fields })]; return p; };
  e.post(mk(1, 1331886, 'OPS · Salida', [cf(2010715, 'Cerveza', '8'), cf(2024634, 'Vino (botellas)', '3')]));
  e.post(mk(10, 1332005, 'OPS · Regreso', [cf(2010722, 'Cerveza', '6'), cf(2024634, 'Vino (botellas)', '1')]));
  e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const bit = e.rows('Bitácora');
  assert.deepStrictEqual(bit.filter(r => r[7] === '2024634').map(r => [r[5], r[8]]).sort(), [['Regreso', 1], ['Salida', 3]]);
  assert.strictEqual(e.rows('Salidas').find(r => String(r[0]) === '9301')[11], 'Completa');
});

test('traslado ways, costo adicional and hora extra follow the customer side', () => {
  const e = env();
  const p = oneCustomerPayload();
  p.booking.customers[0].custom_field_values.push(cf(2026466, 'Traslado ida', 'true'), cf(2021180, 'Hora extra (staff)', '1'));
  p.booking.customers[1].custom_field_values = [cf(2026467, 'Traslado regreso', 'true'), cf(2010487, 'Costos adicionales', 'Hielo $300')];
  e.post(p); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const bit = e.rows('Bitácora'), M = e.G.ex.loadMapeos_(e.ss);
  assert.deepStrictEqual(J(e.G.ex.trasladoWays_(bit, M)), { ida: true, regreso: true });
  assert.deepStrictEqual(bit.filter(r => /Traslado/.test(r[6])).map(r => [r[6], r[5]]).sort(), [['Traslado ida', 'Salida'], ['Traslado regreso', 'Regreso']]);
  assert.strictEqual(bit.find(r => r[7] === '2010487')[5], 'Regreso');
  assert.strictEqual(bit.find(r => r[7] === '2021180')[5], 'Salida');
});

test('BITACORA_RULE_V bumped to 7 → first rebuildFinanzas recalculates once', () => {
  const e = env();
  e.post(oneCustomerPayload()); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  assert.strictEqual(e.G.ex.BITACORA_RULE_V, '7');
  e.fe.props.BITACORA_RULE_V = '6';
  assert.strictEqual(J(e.G.ex.rebuildFinanzas()).reconstruido, true);
  assert.strictEqual(e.fe.props.BITACORA_RULE_V, '7');
});

// Round 5: Costos adicionales parsing, Externos amount/note/alerts, Costos salida column, rule version, bitácora text kept.
const assert = require('assert');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const N = loadNew(), E = N.ex;

const P = t => J(E.parseCostos_(t));
const sum = (t, total, n) => { const r = P(t); assert.strictEqual(r.total, total, t + ' → total ' + r.total); if (n !== undefined) assert.strictEqual(r.items.length, n, t + ' → items'); return r; };

test('parseCostos_: the spec example (external boat + fuel) → 2800, first item ext', () => {
  const r = sum('Barco externo San Ángel – Juan Pérez: $2,500 · gasolina extra $300', 2800, 2);
  assert.deepStrictEqual(r.items, [{ label: 'Barco externo San Ángel – Juan Pérez', amount: 2500, ext: true }, { label: 'gasolina extra', amount: 300, ext: false }]);
  assert.strictEqual(r.unparsed, false);
});
test('parseCostos_: number formats ($2,500 · 2500 · $2.500 MX thousands · $ 300 · 300 pesos · decimals)', () => {
  sum('$2,500', 2500, 1); sum('2500', 2500, 1); sum('$2.500', 2500, 1); sum('$ 300', 300, 1); sum('300 pesos', 300, 1);
  sum('Gasolina $1.250,50', 1250.5, 1); sum('Hielo $1,250.50', 1250.5, 1); sum('propina 2.5', 2.5, 1); sum('$12.345', 12345, 1);
  sum('MXN 300', 300, 1); sum('300 MXN', 300, 1);
  assert.deepStrictEqual(P('300 pesos gasolina').items, [{ label: 'gasolina', amount: 300, ext: false }], 'label after the amount when nothing precedes it');
  assert.deepStrictEqual(P('$ 300').items[0].label, '');
});
test('parseCostos_: separators · , ; / newline y', () => {
  sum('gasolina $300 · hielo $90', 390, 2); sum('gasolina $300, hielo $90', 390, 2); sum('gasolina 300; hielo 90', 390, 2);
  sum('gasolina 300 / hielo 90', 390, 2); sum('gasolina 300\nhielo 90\r\npeaje 50', 440, 3); sum('gasolina $300 y hielo $90', 390, 2);
  sum('gasolina $2,500, hielo $1,000', 3500, 2);
  const r = P('Barco externo San Ángel, Juan Pérez: $2,500'); assert.strictEqual(r.items.length, 1, 'a comma with no number on one side is not a separator'); assert.ok(r.items[0].ext);
  assert.strictEqual(P('Barco externo San Ángel y Juan $2500').items.length, 1, '" y " with no number on its left is part of the label');
  assert.deepStrictEqual(P('Barco externo San Ángel · $2,500').items, [{ label: 'Barco externo San Ángel', amount: 2500, ext: true }], 'label and amount in separate segments are joined');
});
test('parseCostos_: ext flag is case/accents-insensitive and only on that segment', () => {
  const r = P('BARCO EXTERNO Sán Ángel $2000 · Barco  Externo 2 $500 · gasolina $100');
  assert.deepStrictEqual(r.items.map(x => x.ext), [true, true, false]);
  assert.deepStrictEqual(P('barco externó lancha 800').items.map(x => x.ext), [true]);
  assert.deepStrictEqual(P('Barco propio $100').items.map(x => x.ext), [false]);
});
test('parseCostos_: segments without a number are unparsed (raw kept); empty text is fine', () => {
  const r = P('Pagar a Juan después · gasolina $300');
  assert.strictEqual(r.unparsed, true); assert.deepStrictEqual(r.rest, ['Pagar a Juan después']); assert.strictEqual(r.total, 300);
  const o = P('lo paga la oficina'); assert.strictEqual(o.unparsed, true); assert.strictEqual(o.total, 0); assert.strictEqual(o.raw, 'lo paga la oficina');
  [null, undefined, '', '   '].forEach(x => { const e = P(x); assert.deepStrictEqual([e.items.length, e.total, e.unparsed], [0, 0, false]); });
});
test('parseCostos_: real-looking notes', () => {
  sum('Lancha externa San Ángel $2,500 + gasolina $300', 2800, 2);
  sum('Barco externo: 3000 pesos', 3000, 1);
  sum('Barco externo San Ángel – Juan Pérez: $2,500 · gasolina extra $300 · peaje $50', 2850, 3);
  sum('guía extra 400, comida 150', 550, 2);
  sum('Barco externo (Don Beto) $1.800 / propina para el capitán externo $200', 2000, 2);
});

test('costoAdicionalText_: only fields with Uso costo adicional; text first, number otherwise', () => {
  const row = (name, n, t) => ['9', '', '', '', 1, 'Regreso', name, '', n, t];
  const rows = [row('Costos adicionales', '', 'Barco externo X: $2,500'), row('Costos adicionales', 300, ''), row('Extras a bordo', '', 'Jugo'), row('Cerveza', 5, '')];
  assert.strictEqual(E.costoAdicionalText_(rows, null), 'Barco externo X: $2,500 · 300');
  assert.strictEqual(E.costoAdicionalText_([], null), '');
});

test('headers: new columns are appended at the END; BITACORA_RULE_V is 4 (one-time rebuild)', () => {
  assert.strictEqual(E.COSTO_HEADERS[E.COSTO_HEADERS.length - 1], 'Costos adicionales (MXN)');
  assert.strictEqual(E.COSTO_HEADERS[E.COSTO_HEADERS.length - 2], 'Alertas');
  assert.strictEqual(E.EXT_HEADERS[E.EXT_HEADERS.length - 1], 'Monto (MXN)');
  assert.strictEqual(E.EXT_HEADERS[E.EXT_HEADERS.length - 2], 'Alerta');
  assert.strictEqual(E.BITACORA_RULE_V, '4');
  assert.strictEqual(E.bitacoraRuleStale_('3'), true);
});

// ---- Externos: payForSalida_ (pure) ----
const TAR = N.get('TAR_SEED');
const sal = ['9100', 258806, 'Bacalar Lagoon Boat Tour', 'compartido', '2026-03-10', '09:00', '2026-03-10T14:00:00Z', '2026-03-10T17:00:00Z', 1];
const NOW_AFTER = new Date('2026-03-11T00:00:00Z'), NOW_BEFORE = new Date('2026-03-10T15:00:00Z');
const ext1 = ['9100', '', '', '', 'Capitan', 'Capitan Externo', 'capitan.externo', 'San Ángel – Juan Pérez', ''];
const staff = ['9100', '', '', '', 'Marinero', 'Luis M', 'luis', 'Barco: El Cormoran', ''];
const costRow = t => ['9100', '', '', '', 1, 'Regreso', 'Costos adicionales', '', '', t];
test('Externos: note = a quién se debe; amount = barco externo lines only; staff untouched', () => {
  const r = J(E.payForSalida_(sal, [ext1, staff], [costRow('Barco externo San Ángel – Juan Pérez: $2,500 · gasolina extra $300')], TAR, 'ponton', null, NOW_AFTER));
  assert.strictEqual(r.ext.length, 1); assert.strictEqual(r.pay.length, 1);
  assert.deepStrictEqual(r.ext[0].slice(5), ['Capitan Externo', 'San Ángel – Juan Pérez', '', 2500]);
  assert.strictEqual(r.pay[0][5], 'Luis M');
});
test('Externos: empty note → "Falta nota"; no amount after the end → "Falta monto"; before the end → no alert', () => {
  const noNote = Object.assign([], ext1); noNote[7] = '';
  const r = J(E.payForSalida_(sal, [noNote], [costRow('gasolina $300')], TAR, 'ponton', null, NOW_AFTER));
  assert.strictEqual(r.ext[0][7], 'Falta nota: ¿a quién se debe? | Falta monto en Costos adicionales'); assert.strictEqual(r.ext[0][8], '');
  const early = J(E.payForSalida_(sal, [ext1], [], TAR, 'ponton', null, NOW_BEFORE));
  assert.strictEqual(early.ext[0][7], '', 'departure not ended yet → no missing-amount alert');
  const late = J(E.payForSalida_(sal, [ext1], [], TAR, 'ponton', null, NOW_AFTER));
  assert.strictEqual(late.ext[0][7], 'Falta monto en Costos adicionales');
  const unparsed = J(E.payForSalida_(sal, [ext1], [costRow('lo paga la oficina')], TAR, 'ponton', null, NOW_AFTER));
  assert.strictEqual(unparsed.ext[0][7], 'Falta monto en Costos adicionales');
});
test('Externos: several externals → total on the first, alert "Varios externos: repartir"', () => {
  const ext2 = ['9100', '', '', '', 'Marinero', 'Marinero Externo', 'mar.externo', 'Lancha Bety – Beto', ''];
  const r = J(E.payForSalida_(sal, [ext1, ext2], [costRow('Barco externo San Ángel: $2,500 · Barco externo Bety $1,500')], TAR, 'ponton', null, NOW_AFTER));
  assert.deepStrictEqual([r.ext[0][8], r.ext[1][8]], [4000, '']);
  assert.ok(/Varios externos: repartir/.test(r.ext[0][7])); assert.strictEqual(r.ext[1][7], '');
});

// ---- End to end on the in-memory spreadsheet ----
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : null; };
  return { ss, fe, G, rows, post: p => G.ex.doPost({ postData: { contents: JSON.stringify(p) } }) };
}
const COSTO_TXT = 'Barco externo San Ángel – Juan Pérez: $2,500 · gasolina extra $300';
const crewExt = [F.crew(F.role(11, 'Capitan', 'Captain'), 'Capitan Externo', 'capitan.externo', 'San Ángel – Juan Pérez'), F.crew(F.role(12, 'Marinero', 'Sailor'), 'Luis M', 'luis', 'Barco: El Cormoran')];
const mk = (pk, cust) => F.booking({ pk: pk, av: 9100, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-03-10T14:00:00Z', end: '2026-03-10T17:00:00Z', paid: 250000, crew: crewExt, customers: cust });
test('end to end: Externos + Costos salida columns, Bitácora keeps the free text, history recomputed once', () => {
  const e = env();
  e.post(mk(7100, [F.cust(100, 'Adult'), F.cust(100, 'Adult')]));
  e.post(mk(7101, [F.cust(1331886, 'OPS · Salida', [F.cfv(2024601, 'Cerveza', '10')])]));
  e.post(mk(7102, [F.cust(1332005, 'OPS · Regreso', [F.cfv(2024601, 'Cerveza', '4'), F.cfv(2024642, 'Costos adicionales', COSTO_TXT)])]));
  e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const bit = e.rows('Bitácora').find(r => r[6] === 'Costos adicionales');
  assert.strictEqual(bit[9], COSTO_TXT, 'text with digits is not reduced to its first number');
  const ext = e.rows('Externos');
  assert.strictEqual(ext.length, 1);
  assert.deepStrictEqual([ext[0][5], ext[0][6], ext[0][7], ext[0][8]], ['Capitan Externo', 'San Ángel – Juan Pérez', '', 2500]);
  const c = e.rows('Costos salida')[0], H = J(e.G.get('COSTO_HEADERS'));
  assert.strictEqual(c[H.indexOf('Costos adicionales (MXN)')], 2800);
  const tripu = c[H.indexOf('Tripulación (MXN)')];
  assert.ok(c[H.indexOf('Costo total (MXN)')] >= 2800 + tripu, 'Costo total includes the additional costs');
  assert.ok(Math.abs(c[H.indexOf('Costo total (MXN)')] - (c[H.indexOf('Bebidas (MXN)')] + c[H.indexOf('Hielo (MXN)')] + c[H.indexOf('Gasolina (MXN)')] + c[H.indexOf('Fruta (MXN)')] + c[H.indexOf('Desayuno (MXN)')] + tripu + 2800)) < 0.02);
  // crew note is stored and exposed to the app
  const d = J(e.G.ex.getData('0000', '2026-03-01', '2026-03-31')).deps.find(x => x.id === '9100');
  assert.deepStrictEqual(d.crew.map(x => [x.n, x.nt || '', x.ext || false]), [['Capitan Externo', 'San Ángel – Juan Pérez', true], ['Luis M', 'Barco: El Cormoran', false]]);
  assert.strictEqual(d.crew[0].monto, 2500);
  assert.deepStrictEqual(d.ca.items.map(x => [x.label, x.amount, x.ext]), [['Barco externo San Ángel – Juan Pérez', 2500, true], ['gasolina extra', 300, false]]);
  assert.strictEqual(d.ca.total, 2800); assert.strictEqual(d.ca.unparsed, false);
  assert.ok(!/Costos adicionales/.test(d.extras), 'costo adicional lines are shown under Costos, not under Extras a bordo');
  const ex = J(e.G.ex.getData('0000', '2026-03-01', '2026-03-31')).externos;
  assert.strictEqual(ex[0].monto, 2500);
});
test('end to end: unparsed costo adicional → alert in Costos salida, total 0', () => {
  const e = env();
  e.post(mk(7200, [F.cust(100, 'Adult')]));
  e.post(mk(7201, [F.cust(1331886, 'OPS · Salida', [F.cfv(2024601, 'Cerveza', '10')])]));
  e.post(mk(7202, [F.cust(1332005, 'OPS · Regreso', [F.cfv(2024601, 'Cerveza', '4'), F.cfv(2024642, 'Costos adicionales', 'lo paga Omri')])]));
  e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const c = e.rows('Costos salida')[0], H = J(e.G.get('COSTO_HEADERS'));
  assert.ok(/Costo adicional sin monto: lo paga Omri/.test(c[H.indexOf('Alertas')]));
  assert.strictEqual(c[H.indexOf('Costos adicionales (MXN)')], 0);
  assert.ok(e.rows('Externos')[0][7].indexOf('Falta monto en Costos adicionales') >= 0);
});

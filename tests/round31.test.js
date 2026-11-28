// Round 31: gasolina por salida — cargas de Monday + bitácora repartidas por horas (Gasolina cargas, config, Costos salida, report, app).
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('docs/index.html'), sw = read('docs/sw.js');
const N = loadNew(), E = N.ex;

test('APP_VER = CACHE = v27+, BITACORA_RULE_V >= 12', () => {
  const v = /const APP_VER='(v\d+)'/.exec(html)[1];
  assert.ok(sw.indexOf("const CACHE = 'al-ops-" + v + "'") >= 0 && Number(v.slice(1)) >= 27);
  assert.ok(Number(E.BITACORA_RULE_V) >= 12 && E.bitacoraRuleStale_('11'));
});

// ---------- normalizer ----------
test('gasBarco_ / gasGrupo_: Monday vessel names and FareHarbor resource names → boat + group (accents / case / punctuation ignored)', () => {
  const g = n => { const b = E.gasBarco_(n); return b ? J(b) : null; };
  [['LA FLACA', 'La Flaca', 'ponton'], ['EL REY', 'El Rey', 'ponton'], ['CORMORÁN', 'El Cormorán', 'ponton'], ['CORMORAN', 'El Cormorán', 'ponton'], ['EL CORMORAN', 'El Cormorán', 'ponton'], ['EL CONMORAN', 'El Cormorán', 'ponton'],
    ['HURACÁN', 'Huracán', 'catamaran'], ['BARRACUDA', 'Barracuda', 'catamaran'], ['LA RAMONA', 'La Ramona', 'catamaran'], ['KATANA', 'Katana', 'catamaran'],
    ['TIAMAT', 'Tiamat', 'monocasco'], ['GMI', 'GMI', 'monocasco'], ['HOBBIECAT', 'Hobie Cat', 'hobie'], ['HOBIE CAT', 'Hobie Cat', 'hobie'],
    ['La Flaca', 'La Flaca', 'ponton'], ['Ponton _ La Flaca', 'La Flaca', 'ponton'], ['El Cormoran', 'El Cormorán', 'ponton'], ['Barco techado _ La Ramona', 'La Ramona', 'catamaran'], ['Catamarán _ Huracán', 'Huracán', 'catamaran']]
    .forEach(([n, b, gr]) => assert.deepStrictEqual(g(n), { barco: b, grupo: gr }, n));
  assert.strictEqual(g('CAMIONETA ALMACEN'), null); assert.strictEqual(g(''), null); assert.strictEqual(g('Kayak sencillo'), null);
  assert.strictEqual(E.gasGrupo_('CAMIONETA ALMACEN'), 'general'); assert.strictEqual(E.gasGrupo_('algo raro'), 'general'); assert.strictEqual(E.gasGrupo_('TIAMAT'), 'monocasco');
  assert.deepStrictEqual(J(E.gasBoatsOf_(['Ponton _ La Flaca', 'SUP board', 'La Flaca', 'Catamarán _ Huracán'])), ['La Flaca', 'Huracán']);
});

// ---------- Gasolina cargas intake ----------
test('gasolinaPlan_: validates, groups, dedupes by sha1 of the row (also within one call)', () => {
  const r = J(E.gasolinaPlan_([['2026-11-20T10:00:00', 'LA FLACA', 30, 'Jesús'], ['2026-11-20T10:00:00', 'LA FLACA', 30, 'Jesús'], ['2026-11-21', 'CAMIONETA ALMACEN', '12,5', ''], ['mal', 'X', 5], ['2026-11-22', 'TIAMAT', 0], 'x'], {}));
  assert.deepStrictEqual([r.added, r.dup, r.bad], [2, 1, 3]);
  assert.deepStrictEqual(r.rows.map(x => x.slice(0, 6)), [['2026-11-20', 'LA FLACA', 'ponton', 30, 'monday', 'Jesús'], ['2026-11-21', 'CAMIONETA ALMACEN', 'general', 12.5, 'monday', '']]);
  assert.strictEqual(r.rows[0][6].length, 40);
  const again = J(E.gasolinaPlan_([['2026-11-20T10:00:00', 'LA FLACA', 30, 'Jesús']], { [r.rows[0][6]]: true })); assert.deepStrictEqual([again.added, again.dup], [0, 1]);
});
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const p2 = n => String(n).padStart(2, '0');
  fe.Utilities = Object.assign({}, require('./lib').loadGs([''], {}).ctx.Utilities, {});
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : []; };
  return { ss, fe, G, rows, post: p => G.ex.doPost({ postData: { contents: JSON.stringify(p) } }) };
}
test('doPost type "gasolina": appends to "Gasolina cargas" (Fuente monday), dedupes on resend, never touches Raw; APP_KEY respected', () => {
  const e = env(), body = { type: 'gasolina', rows: [['2026-11-20T10:00:00', 'LA FLACA', 30, 'Jesús'], ['2026-11-20T11:00:00', 'CAMIONETA ALMACEN', 20, 'Jesús']] };
  const r = JSON.parse(e.post(body).text); assert.deepStrictEqual([r.ok, r.added, r.dup], [true, 2, 0]);
  const r2 = JSON.parse(e.post(body).text); assert.deepStrictEqual([r2.ok, r2.added, r2.dup], [true, 0, 2]);
  const rows = e.rows('Gasolina cargas'); assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(J(rows[0]).slice(0, 6), ['2026-11-20', 'LA FLACA', 'ponton', 30, 'monday', 'Jesús']); assert.strictEqual(rows[1][2], 'general');
  assert.strictEqual(e.ss.getSheetByName('Gasolina cargas')._d.rows[0].join('|'), J(E.GAS_HEADERS).join('|'));
  assert.strictEqual(e.rows('Raw').length, 0, 'not a webhook: nothing in Raw');
  e.fe.props.APP_KEY = 'k1'; assert.strictEqual(JSON.parse(e.post(Object.assign({ key: 'x' }, body)).text).ok, false);
  assert.strictEqual(JSON.parse(e.post(Object.assign({ key: 'k1' }, { rows: [['2026-11-23', 'TIAMAT', 10, '']] }, { type: 'gasolina' })).text).added, 1);
});

// ---------- config ----------
test('config: gasolina_desde (valid date, default 2026-11-28) and gasolina_precio (MXN/L, default 25) are validated', () => {
  assert.deepStrictEqual(J(E.configFromRows_([])).gasolina_desde, '2026-11-28'); assert.strictEqual(E.configFromRows_([]).gasolina_precio, '25');
  assert.deepStrictEqual(J(E.validateConfig_('gasolina_desde', '2026-12-01')), { key: 'gasolina_desde', value: '2026-12-01' });
  ['2026-13-01', '2026-02-30', 'mañana', ''].forEach(v => assert.throws(() => E.validateConfig_('gasolina_desde', v), /inválida/, v));
  assert.deepStrictEqual(J(E.validateConfig_('gasolina_precio', '24,5')), { key: 'gasolina_precio', value: '24.5' });
  ['0', '-3', 'abc', '', '500'].forEach(v => assert.throws(() => E.validateConfig_('gasolina_precio', v), /inválido/, v));
  assert.strictEqual(E.configFromRows_([['gasolina_precio', 'xx']]).gasolina_precio, '25', 'bad stored value falls back');
});

// ---------- allocation ----------
const H = 3600000, t0 = Date.parse('2026-11-01T14:00:00Z');
const dep = (pk, fecha, o) => Object.assign({ pk: pk, fecha: fecha, ini: Date.parse(fecha + 'T14:00:00Z'), fin: Date.parse(fecha + 'T17:00:00Z'), item: 'A', barco: 'ponton', activas: 1, boats: ['La Flaca'], ext: false, bit: 0 }, o || {});
const alloc = o => J(E.allocateGasolina_(Object.assign({ desde: '2026-11-28', precio: 25, compras: [], cargas: [], deps: [] }, o)));
test('a) before the cutover: Monday liters of (month × grupo) ÷ group hours × departure hours; estimate; months without departures get nothing', () => {
  const deps = [dep('1', '2026-11-03'), dep('2', '2026-11-10', { fin: Date.parse('2026-11-10T19:00:00Z') }), dep('3', '2026-11-12', { barco: 'catamaran', boats: ['Huracán'] }), dep('4', '2026-10-05', { barco: 'catamaran', boats: ['Huracán'] })];
  const cargas = [{ fecha: '2026-11-02', grupo: 'ponton', litros: 40 }, { fecha: '2026-11-15', grupo: 'ponton', litros: 20 }, { fecha: '2026-11-05', grupo: 'catamaran', litros: 9 },
    { fecha: '2026-11-06', grupo: 'general', litros: 500 }, { fecha: '2026-09-01', grupo: 'ponton', litros: 99 }, { fecha: '2026-12-02', grupo: 'ponton', litros: 77 }];
  const r = alloc({ deps: deps, cargas: cargas });
  // ponton Nov: 60 L over 3 h + 5 h = 8 h → 7.5 L/h
  assert.deepStrictEqual([r['1'].l, r['2'].l], [22.5, 37.5]); assert.deepStrictEqual([r['1'].src, r['1'].pe, r['1'].mxn], ['monday-est', true, 562.5]);
  assert.strictEqual(r['3'].l, 9, 'catamaran: the whole 9 L (only one departure of the group in Nov)');
  assert.strictEqual(r['4'].l, 0, 'October has no cargas');
  // liters before the DB's first departure date are ignored (Nov 2 cargas dropped when the first departure is Nov 3? no: earlier month shown below)
  const r2 = alloc({ deps: [dep('1', '2026-11-10')], cargas: [{ fecha: '2026-11-02', grupo: 'ponton', litros: 40 }, { fecha: '2026-11-11', grupo: 'ponton', litros: 10 }] });
  assert.strictEqual(r2['1'].l, 10, 'cargas before the first departure date are ignored');
  assert.strictEqual(alloc({ deps: [dep('1', '2026-12-01')], cargas: [{ fecha: '2026-12-02', grupo: 'ponton', litros: 40 }] })['1'].src, 'bitacora', 'on/after the cutover Monday rows are ignored');
  assert.strictEqual(alloc({ deps: [dep('1', '2026-12-01')], cargas: [{ fecha: '2026-12-02', grupo: 'ponton', litros: 40 }] })['1'].l, 0);
});
test('a) bitácora gasoline before the cutover is ignored for cost; external boats, no active bookings and non-fuel boats (sup/kayak/otro) are not allocated', () => {
  const deps = [dep('1', '2026-11-10', { bit: 50 }), dep('2', '2026-11-10', { ext: true }), dep('3', '2026-11-10', { activas: 0 }), dep('4', '2026-11-10', { barco: 'sup' }), dep('5', '2026-11-11', { barco: 'otro' })];
  const r = alloc({ deps: deps, cargas: [{ fecha: '2026-11-10', grupo: 'ponton', litros: 12 }] });
  assert.deepStrictEqual(Object.keys(r), ['1']); assert.strictEqual(r['1'].l, 12, 'only Monday liters; the 50 L of the bitácora are ignored');
});
test('hours: fin − ini; ≤ 0 or missing → median of that item\'s positive durations, else 3 h', () => {
  const deps = [dep('1', '2026-11-03'), dep('2', '2026-11-04', { fin: Date.parse('2026-11-04T18:00:00Z') }), dep('3', '2026-11-05', { fin: null }), dep('4', '2026-11-06', { item: 'B', fin: null }), dep('5', '2026-11-07', { item: 'A', fin: Date.parse('2026-11-07T13:00:00Z') })];
  const r = alloc({ deps: deps });
  assert.deepStrictEqual([r['1'].h, r['2'].h, r['3'].h, r['4'].h, r['5'].h], [3, 4, 3.5, 3, 3.5]);
});
test('b) from the cutover: a bitácora refuel is spread over that boat\'s departures from it (inclusive) until the next refuel of the same boat (exclusive), weighted by hours', () => {
  const deps = [dep('1', '2026-11-28', { bit: 30 }), dep('2', '2026-11-29', { fin: Date.parse('2026-11-29T19:00:00Z') }), dep('3', '2026-11-30'), dep('4', '2026-12-01', { bit: 12 }), dep('5', '2026-12-02'),
    dep('6', '2026-11-29', { boats: ['El Rey'] }), dep('7', '2026-11-30', { boats: ['La Flaca', 'El Rey'] })];
  const r = alloc({ deps: deps });
  // La Flaca sequence: 1(3h, refuel 30) 2(5h) 3(3h) 7(3h) | 4(3h, refuel 12) 5(3h) → 30 over 14 h; 12 over 6 h
  const k = 30 / 14;
  assert.deepStrictEqual([r['1'].l, r['2'].l, r['3'].l, r['7'].l], [3, 5, 3, 3].map(h => Math.round(h * k * 100) / 100));
  assert.deepStrictEqual([r['4'].l, r['5'].l], [6, 6]); assert.strictEqual(r['1'].src, 'bitacora');
  assert.strictEqual(r['6'].l, 0, 'another boat without a refuel');
  // no known boat: everything on that departure
  const r2 = alloc({ deps: [dep('1', '2026-11-28', { bit: 20, boats: [] }), dep('2', '2026-11-29', { boats: [] })] }); assert.deepStrictEqual([r2['1'].l, r2['2'].l], [20, 0]);
  // refuel on an external-boat departure is ignored (they pay their own)
  assert.strictEqual(alloc({ deps: [dep('1', '2026-11-28', { bit: 20, ext: true }), dep('2', '2026-11-29')] })['2'].l, 0);
});
test('c) price: latest gas purchase on or before the date; else gasolina_precio and pe = true', () => {
  const deps = [dep('1', '2026-11-28', { bit: 10, boats: [] }), dep('2', '2026-12-05', { bit: 10, boats: [] }), dep('3', '2026-12-10', { bit: 10, boats: [] })];
  const r = alloc({ deps: deps, precio: 26, compras: [{ fecha: '2026-12-01', precio: 24 }, { fecha: '2026-12-08', precio: 23 }, { fecha: '2026-12-02', precio: 0 }] });
  assert.deepStrictEqual([r['1'].mxn, r['1'].pe], [260, true]); assert.deepStrictEqual([r['2'].mxn, r['2'].pe], [240, false]); assert.deepStrictEqual([r['3'].mxn, r['3'].pe], [230, false]);
  assert.deepStrictEqual(J(E.gasPrecio_([], '2026-11-28', 25)), { p: 25, est: true });
  assert.deepStrictEqual([E.gasFuenteText_({ src: 'monday-est', pe: true, mxn: 5 }), E.gasFuenteText_({ src: 'bitacora', pe: false, mxn: 5 }), E.gasFuenteText_(null)], ['monday-est · precio est.', 'bitacora', '']);
  assert.deepStrictEqual(J(E.gasFuenteParse_('monday-est · precio est.')), { src: 'monday-est', pe: true });
});

// ---------- end to end: Costos salida + getData + report ----------
const crewE = [F.crew(F.role(11, 'Capitan', 'Captain'), 'Juan Pérez', 'juan')];
const res = (b, n) => { b.booking.resource_uses = [{ pk: 1, resource: { pk: 501, name: n }, use_count: 1 }]; return b; };
const mk = (pk, av, day, cust, rn, crew) => res(F.booking({ pk: pk, av: av, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: day + 'T15:00:00Z', end: day + 'T18:00:00Z', paid: 250000, crew: crew || crewE, customers: cust }), rn);
const CH = J(N.get('COSTO_HEADERS'));
function built() {
  const e = env();
  // 2026-03-10: pontón La Flaca with a bitácora gas field (40 L, ignored for cost before the cutover); 2026-03-11 second departure
  e.post(mk(7100, 9100, '2026-03-10', [F.cust(100, 'Adult'), F.cust(100, 'Adult')], 'Ponton _ La Flaca'));
  e.post(mk(7101, 9100, '2026-03-10', [F.cust(1331886, 'OPS · Salida', [F.cfv(2024605, 'Gasolina (litros)', '40')])], 'Ponton _ La Flaca'));
  e.post(mk(7110, 9101, '2026-03-11', [F.cust(100, 'Adult')], 'Ponton _ La Flaca'));
  e.G.ex.ensureMapeos_(e.ss);
  e.post({ type: 'gasolina', rows: [['2026-03-10T09:00:00', 'LA FLACA', 30, 'Jesús'], ['2026-03-10T10:00:00', 'CAMIONETA ALMACEN', 99, '']] });
  e.G.ex.rebuildAll();
  return e;
}
test('Costos salida: Gasolina (MXN) = allocation (Monday estimate, placeholder price), new END columns Gasolina (L) / Gasolina fuente, Costo total follows; stock consumption of gas unchanged', () => {
  const e = built(), c = e.rows('Costos salida'), by = pk => c.find(r => String(r[0]) === pk);
  assert.deepStrictEqual(CH.slice(-2), ['Gasolina (L)', 'Gasolina fuente']);
  const a = by('9100'), b = by('9101');
  assert.deepStrictEqual([a[CH.indexOf('Gasolina (L)')], b[CH.indexOf('Gasolina (L)')]], [15, 15], 'camioneta liters are never a tour cost; 30 L ÷ 2 departures of 3 h');
  assert.deepStrictEqual([a[CH.indexOf('Gasolina (MXN)')], a[CH.indexOf('Gasolina fuente')]], [375, 'monday-est · precio est.']);
  const base = a[CH.indexOf('Bebidas (MXN)')] + a[CH.indexOf('Hielo (MXN)')] + a[CH.indexOf('Gasolina (MXN)')] + a[CH.indexOf('Fruta (MXN)')] + a[CH.indexOf('Desayuno (MXN)')] + a[CH.indexOf('Tripulación (MXN)')];
  assert.ok(Math.abs(a[CH.indexOf('Costo total (MXN)')] - (base + a[CH.indexOf('Costos adicionales (MXN)')] + a[CH.indexOf('Ajustes (MXN)')])) < 0.02, 'Costo total includes the allocated gasoline');
  const stock = e.rows('Stock').find(r => r[0] === 'gas'); assert.strictEqual(stock[4], 40, 'consumption (stock) keeps the bitácora liters by refuel');
  const d = J(e.G.ex.getData('0000', '2026-03-01', '2026-03-31')).deps.find(x => x.id === '9100');
  assert.deepStrictEqual(d.costs.gas, { l: 15, mxn: 375, src: 'monday-est', pe: true });
});
test('cutover from config + bitácora liters + latest purchase price (end to end)', () => {
  const e = built(); e.G.ex.setConfig('0000', 'gasolina_desde', '2026-03-01');
  e.G.ex.rebuildAll();
  const c = e.rows('Costos salida'), by = pk => c.find(r => String(r[0]) === pk);
  // refuel 40 L on 9100 (3 h) → spread over 9100 + 9101 (same boat, no later refuel): 20 L each
  assert.deepStrictEqual([by('9100')[CH.indexOf('Gasolina (L)')], by('9101')[CH.indexOf('Gasolina (L)')]], [20, 20]);
  assert.strictEqual(by('9100')[CH.indexOf('Gasolina fuente')], 'bitacora · precio est.'); assert.strictEqual(by('9100')[CH.indexOf('Gasolina (MXN)')], 500);
  e.G.ex.setConfig('0000', 'gasolina_precio', '30'); e.G.ex.rebuildAll();
  assert.strictEqual(e.rows('Costos salida').find(r => String(r[0]) === '9100')[CH.indexOf('Gasolina (MXN)')], 600);
});
test('external boat departure: no fuel cost, empty source', () => {
  const e = env(), ext = [F.crew(F.role(16, 'Externo', 'External'), 'Pedro X', 'externo1', 'Barco: San Ángel (externo) – Juan – $3,500')];
  e.post(mk(7200, 9200, '2026-03-10', [F.cust(100, 'Adult')], 'Ponton _ La Flaca', ext)); e.post(mk(7201, 9201, '2026-03-11', [F.cust(100, 'Adult')], 'Ponton _ La Flaca'));
  e.G.ex.ensureMapeos_(e.ss); e.post({ type: 'gasolina', rows: [['2026-03-10T09:00:00', 'LA FLACA', 30, '']] }); e.G.ex.rebuildAll();
  const c = e.rows('Costos salida'), x = c.find(r => String(r[0]) === '9200'), y = c.find(r => String(r[0]) === '9201');
  assert.deepStrictEqual([x[CH.indexOf('Gasolina (MXN)')], x[CH.indexOf('Gasolina fuente')]], [0, '']); assert.strictEqual(y[CH.indexOf('Gasolina (L)')], 30, 'the whole pool goes to the non-external departure');
  assert.strictEqual(J(e.G.ex.getData('0000', '2026-03-01', '2026-03-31')).deps.find(d => d.id === '9200').costs.gas, null);
});
test('gasolinaReport_: per boat (refuels, departures, hours, L/h), per group (L, MXN), General apart; day-inclusive; gasolinaReport is admin only', () => {
  const deps = [dep('1', '2026-11-03', { boat: 'La Flaca', grupo: 'ponton' }), dep('2', '2026-11-04', { boat: 'La Flaca', grupo: 'ponton' }), dep('3', '2026-11-05', { boat: 'Huracán', grupo: 'catamaran' }), dep('4', '2026-10-31', { boat: 'La Flaca', grupo: 'ponton' }), dep('5', '2026-11-06', { boat: 'La Flaca', grupo: 'ponton', ext: true })];
  const costos = { 1: { l: 10, mxn: 250, pe: true }, 2: { l: 20, mxn: 500, pe: true }, 3: { l: 5, mxn: 125, pe: false }, 4: { l: 99, mxn: 1, pe: false } };
  const r = J(require('./lib').loadNew().ex.gasolinaReport_({ desde: '2026-11-30', hasta: '2026-11-01', deps: deps.map(d => Object.assign({ grupo: d.barco }, d)), costos: costos,
    cargas: [{ fecha: '2026-11-01', emb: 'LA FLACA', litros: 40 }, { fecha: '2026-11-30', emb: 'LA FLACA', litros: 5 }, { fecha: '2026-11-02', emb: 'CAMIONETA ALMACEN', litros: 60 }, { fecha: '2026-12-01', emb: 'LA FLACA', litros: 9 }] }));
  assert.deepStrictEqual([r.desde, r.hasta], ['2026-11-01', '2026-11-30'], 'reversed dates are swapped');
  assert.deepStrictEqual(r.boats.map(b => [b.barco, b.litros, b.cargas, b.deps, b.horas, b.lph]), [['La Flaca', 45, 2, 2, 6, 7.5], ['Huracán', 0, 0, 1, 3, null]]);
  assert.deepStrictEqual(r.grupos.map(g => [g.grupo, g.litros, g.mxn, g.deps, g.pe]), [['ponton', 30, 750, 2, true], ['catamaran', 5, 125, 1, false]]);
  assert.deepStrictEqual(r.general, { litros: 60, cargas: 1 }); assert.deepStrictEqual(r.totals, { litros: 35, mxn: 875 });
  const e = built(); e.G.ex.saveUser('0000', { nombre: 'Jesús', pinNuevo: '3333', rol: 'op' });
  assert.throws(() => e.G.ex.gasolinaReport('3333', '2026-03-01', '2026-03-31'), /Solo admin/); assert.throws(() => e.G.ex.gasolinaReport('0000', '', ''), /Elige/);
  const rep = J(e.G.ex.gasolinaReport('0000', '2026-03-01', '2026-03-31'));
  assert.ok(rep.ok); assert.deepStrictEqual(rep.boats.map(b => [b.barco, b.litros, b.deps]), [['La Flaca', 30, 2]]); assert.deepStrictEqual(rep.general, { litros: 99, cargas: 1 });
  assert.deepStrictEqual(rep.grupos.map(g => [g.grupo, g.litros, g.mxn]), [['ponton', 30, 750]]); assert.strictEqual(rep.cfg.desde, '2026-11-28');
});

// ---------- app (client) ----------
const pm = html.match(/\/\/ ==PURE-BEGIN==[\s\S]*?\/\/ ==PURE-END==/)[0];
const U = vm.runInNewContext(pm + '\n({gasEst,gasMonths,gasNote,gasDay})', { document: {}, window: {} });
test('client helpers: est. when monday-est or price estimated; month chips (this month first); source note', () => {
  assert.deepStrictEqual([U.gasEst({ src: 'monday-est', pe: false }), U.gasEst({ src: 'bitacora', pe: true }), U.gasEst({ src: 'bitacora', pe: false }), U.gasEst(null)], [true, true, false, false]);
  const m = J(U.gasMonths('2026-11-27', 6)); assert.deepStrictEqual(m.map(x => x.k), ['2026-11', '2026-10', '2026-09', '2026-08', '2026-07', '2026-06']);
  assert.deepStrictEqual([m[0].l, m[1].l, m[0].desde, m[0].hasta, m[1].hasta], ['Este mes', 'oct', '2026-11-01', '2026-11-30', '2026-10-31']);
  assert.strictEqual(J(U.gasMonths('2026-02-10', 3)).map(x => x.l).join(','), 'Este mes,ene,dic 2025');
  assert.strictEqual(U.gasNote('2026-11-28'), 'Monday (estimado) hasta 27 nov · Bitácora desde 28 nov'); assert.strictEqual(U.gasNote('2026-12-01'), 'Monday (estimado) hasta 30 nov · Bitácora desde 1 dic');
});
test('app wiring: Costos line "Gasolina · N L" + est., Más › Gasolina (admin), view, fetch, config input sheet', () => {
  assert.ok(/Gasolina\$\{c\.gas&&c\.gas\.l\?' · '\+num\(c\.gas\.l\)\+' L':''\}/.test(html) && /gasEst\(c\.gas\)\?' <span class="est">est\.<\/span>'/.test(html));
  assert.ok(/adm\?row\('gasolina','fuel','Gasolina'/.test(html) && /\ngasolina\(\)\{/.test(html) && /srv\('gasolinaReport',m\.desde,m\.hasta\)/.test(html) && /gasolina:'Gasolina'/.test(html));
  assert.ok(/data-gasmes/.test(html) && /General \(camioneta\)/.test(html) && /\/\^gasolina_\/\.test\(clave\)/.test(html));
  assert.ok(/gasolinaReport: gasolinaReport/.test(read('apps-script/app.gs')));
});

// Round 21: Traslado pay from the bitácora checkboxes (Campos 2026466 "Traslado ida" / 2026467 "Traslado regreso"), Tarifas rows by boat, migrations, client wiring.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const N = loadNew(), E = N.ex;
const TAR = N.get('TAR_SEED');

const tr = (pk, kind, q, t) => ['9200', '', '', '', 1, kind, kind === 'Salida' ? 'Traslado ida' : 'Traslado regreso', pk, q, t];
const IDA = t => tr('2026466', 'Salida', '', t), REG = t => tr('2026467', 'Regreso', '', t);
const cfM = () => E.mapeosFromRows_([], [['2026466', 'Traslado ida', 'traslado', '', 'OK'], ['2026467', 'Traslado regreso', 'traslado', '', 'OK']], []);
const sal = ['9200', 258806, 'Bacalar Lagoon Boat Tour', 'compartido', '2026-03-10', '09:00', '2026-03-10T14:00:00Z', '2026-03-10T17:00:00Z', 1];
const cap = ['9200', '', '', '', 'Capitan', 'Juan Pérez', 'juan', '', ''], mar = ['9200', '', '', '', 'Marinero', 'Luis M', 'luis', '', ''];
const ext = ['9200', '', '', '', 'Capitan', 'Pedro Externo', 'capitan externo', 'Barco: San Ángel (externo) – Pedro – $3,000', ''];
const NOW = new Date('2026-03-11T00:00:00Z');
const pay = (crew, bit, barco, M) => J(E.payForSalida_(sal, crew, bit, TAR, barco, M === undefined ? cfM() : M, NOW));

test('trasladoWays_: checkbox values true/yes/sí/checked/x/1 per way; false/no/empty = not ticked; only Uso traslado', () => {
  ['true', 'Yes', 'sí', 'si', 'checked', 'x', '1'].forEach(t => assert.deepStrictEqual(J(E.trasladoWays_([IDA(t)], cfM())), { ida: true, regreso: false }, t));
  ['true', 'Yes'].forEach(t => assert.deepStrictEqual(J(E.trasladoWays_([REG(t)], cfM())), { ida: false, regreso: true }, t));
  ['false', 'No', '', 'maybe'].forEach(t => assert.deepStrictEqual(J(E.trasladoWays_([IDA(t), REG(t)], cfM())), { ida: false, regreso: false }, t));
  assert.deepStrictEqual(J(E.trasladoWays_([IDA('true'), REG('true')], cfM())), { ida: true, regreso: true });
  // another Uso on the same pk → ignored
  const M2 = E.mapeosFromRows_([], [['2026466', 'Traslado ida', 'ignorar', '', 'OK']], []);
  assert.strictEqual(J(E.trasladoWays_([IDA('true')], M2)).ida, false);
  // no M: the name rule guesses 'traslado'
  assert.strictEqual(J(E.trasladoWays_([IDA('true')], null)).ida, true);
});
test('unknown-field default rule guesses traslado for names containing "traslado"', () => {
  assert.strictEqual(E.guessFieldUso_('Traslado ida', '2026466', { ops: true }).uso, 'traslado');
  assert.strictEqual(E.guessFieldUso_('TRASLADO regreso', '1', { ops: true }).uso, 'traslado');
  assert.ok(E.USOS_CF.indexOf('traslado') >= 0);
  assert.strictEqual(J(E.validateMapeo_('campo', { uso: 'Traslado' }, { productos: [] })).uso, 'traslado');
});
test('trasladoRate_: by boat from Tarifas (catamaran/monocasco/hobie 100, ponton 50, sup 0, others 0); first match wins; blank = 0', () => {
  const r = b => E.trasladoRate_(TAR, b);
  assert.deepStrictEqual(['catamaran', 'monocasco', 'hobie', 'ponton', 'sup', 'kayak', 'otro', ''].map(r), [100, 100, 100, 50, 0, 0, 0, 0]);
  // a user rate placed first wins; a blank '*' row = 0
  assert.strictEqual(E.trasladoRate_([['traslado', 'ponton', '', '', '', '', 80, 'salida', ''], ['traslado', 'ponton', '', '', '', '', 50, 'salida', '']], 'ponton'), 80);
  assert.strictEqual(E.trasladoRate_([['traslado', '*', '', '', '', '', '', 'salida', '']], 'hobie'), 0);
  assert.strictEqual(E.trasladoRate_([], 'hobie'), 0);
  // the generic '*' row of the seed sits AFTER the specific ones and is 0
  const rows = TAR.filter(x => x[0] === 'traslado'); assert.strictEqual(rows[rows.length - 1][1], '*'); assert.strictEqual(rows[rows.length - 1][6], 0);
});
test('findRate_ never returns a traslado row as a role rate', () => {
  const t = E.findRate_(TAR, 'traslado', 'ponton', 3, 'x', 'Juan'); assert.ok(!t || t.monto !== 50, 'traslado rows are skipped by findRate_');
  const r = E.findRate_(TAR, 'capitan', 'ponton', 3, 'x', 'Juan'); assert.strictEqual(r.monto, 450);
});
test('payForSalida_: each staff crew member gets traslado per ticked way (ida and regreso once each); added to Total; columns 18/19 expose amount and ways', () => {
  const base = pay([cap, mar], [], 'catamaran').pay;
  const one = pay([cap, mar], [IDA('true')], 'catamaran').pay, two = pay([cap, mar], [IDA('true'), REG('yes')], 'catamaran').pay;
  one.forEach((r, i) => { assert.strictEqual(r[14], base[i][14] + 100); assert.strictEqual(r[18], 100); assert.strictEqual(r[19], 'ida'); assert.ok(/Traslado ida/.test(r[15])); });
  two.forEach((r, i) => { assert.strictEqual(r[14], base[i][14] + 200); assert.strictEqual(r[18], 200); assert.strictEqual(r[19], 'ida,regreso'); assert.ok(/Traslado ida \+ regreso/.test(r[15])); assert.strictEqual(r[10], base[i][10], 'tarifa unchanged'); });
  assert.strictEqual(base[0][18], 0); assert.strictEqual(base[0][19], '');
  // duplicate tick of the same way counts once
  assert.strictEqual(pay([cap], [IDA('true'), IDA('true')], 'catamaran').pay[0][18], 100);
  // pontón 50 per way
  assert.strictEqual(pay([cap], [IDA('true'), REG('true')], 'ponton').pay[0][18], 100);
  assert.strictEqual(pay([cap], [IDA('true')], 'ponton').pay[0][18], 50);
});
test('payForSalida_: sup / kayak / otro = $0 but the ticked ways are still exposed; externos and ignorar roles get nothing', () => {
  ['sup', 'kayak', 'otro'].forEach(b => { const r = pay([cap], [IDA('true'), REG('true')], b).pay[0]; assert.strictEqual(r[18], 0, b); assert.strictEqual(r[19], 'ida,regreso', b); });
  const r = pay([cap, ext], [IDA('true')], 'catamaran');
  assert.strictEqual(r.pay.length, 1); assert.strictEqual(r.ext.length, 1);
  assert.ok(r.ext[0].every(v => typeof v !== 'number' || v !== 100), 'externo row has no traslado');
  assert.strictEqual(r.extMonto, 3000);
  // role mapped to 'ignorar' → not paid
  const Mi = E.mapeosFromRows_([], [['2026466', 'Traslado ida', 'traslado', '', 'OK']], [['9', 'Capitan', '', 'ignorar', 'OK']]);
  const c9 = ['9200', '', '', '', 'Capitan', 'Juan Pérez', 'juan', '', '9'];
  assert.strictEqual(pay([c9], [IDA('true')], 'catamaran', Mi).pay.length, 0);
});
test('Uso other than traslado on the field → no traslado pay', () => {
  const M2 = E.mapeosFromRows_([], [['2026466', 'Traslado ida', 'ignorar', '', 'OK']], []);
  assert.strictEqual(pay([cap], [IDA('true')], 'catamaran', M2).pay[0][18], 0);
});
test('buildDeps_ crew pay.tr = {ida, regreso, monto, ways}; null when nothing ticked; Eventuales adjustment rows keep 20 columns', () => {
  const ev = J(E.payForSalida_(sal, [cap], [IDA('true'), REG('true')], TAR, 'sup', cfM(), NOW)).pay[0];
  const row = ev.slice(); row.length = E.EV_HEADERS.length; row[17] = '';
  assert.deepStrictEqual(J(E.trFrom_(row)), { ida: true, regreso: true, monto: 0, ways: 2 });
  const ev2 = J(E.payForSalida_(sal, [cap], [IDA('true')], TAR, 'catamaran', cfM(), NOW)).pay[0]; ev2[17] = '';
  assert.deepStrictEqual(J(E.trFrom_(ev2)), { ida: true, regreso: false, monto: 100, ways: 1 });
  const ev3 = J(E.payForSalida_(sal, [cap], [], TAR, 'catamaran', cfM(), NOW)).pay[0]; ev3[17] = '';
  assert.strictEqual(E.trFrom_(ev3), null);
  assert.strictEqual(E.EV_HEADERS.length, 20); assert.strictEqual(E.EV_HEADERS[18], 'Traslado (MXN)'); assert.strictEqual(E.EV_HEADERS[19], 'Traslado vías');
  const aj = J(E.ajusteEvRows_([{ tipo: 'pago', persona: 'Ana', fecha: '2026-03-10', av: '9200', id: 'a1', concepto: 'Bono', monto: 50 }], {}, 4, '2026-03-11'));
  assert.strictEqual(aj[0].length, 20);
});
test('rateLabel_: traslado rows show the boat', () => {
  assert.strictEqual(E.rateLabel_(['traslado', 'ponton', '', '', '', '', 50]), 'Traslado por trayecto · pontón');
  assert.ok(/otros barcos/.test(E.rateLabel_(['traslado', '*', '', '', '', '', 0])));
});

// ---------- migrations ----------
const CF_H = () => J(N.get('CF_HEADERS')), TAR_H = () => J(N.get('TAR_HEADERS'));
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  return { ss, fe, G: loadNew(fe) };
}
test('planTrasladoCampos_: appends missing, updates existing that are not traslado/OK, leaves done rows', () => {
  assert.deepStrictEqual(J(E.planTrasladoCampos_([])).appends.map(r => [r[0], r[1], r[2], r[4], r[8]]), [['2026466', 'Traslado ida', 'traslado', 'OK', 'Round 21'], ['2026467', 'Traslado regreso', 'traslado', 'OK', 'Round 21']]);
  assert.deepStrictEqual(J(E.planTrasladoCampos_([['1', 'x', 'ignorar'], ['2026466', 'Traslado ida', 'ignorar', '', 'Nuevo – revisar'], ['2026467', 'Traslado regreso', 'traslado', '', 'OK']])), { updates: [3], appends: [] });
});
test('migrateTrasladoCampos: sets Uso/Estado/Notas on existing rows, appends missing ones, REBUILD_PENDING, once; retries when the tab does not exist', () => {
  const e = env();
  assert.deepStrictEqual(J(e.G.ex.migrateTrasladoCampos20261126_(e.ss)), { found: false }); assert.ok(!e.fe.props.MIG_R21_TR_CF);
  const sh = e.ss.insertSheet('Campos'), H = CF_H();
  sh.getRange(1, 1, 2, H.length).setValues([H, ['2026466', 'Traslado ida', 'ignorar', '', 'Nuevo – revisar', '', '', '', 'previa', '', '']]);
  const r = J(e.G.ex.migrateTrasladoCampos20261126_(e.ss));
  assert.deepStrictEqual(r, { found: true, updated: 1, appended: 1 });
  const rows = sh._d.rows;
  assert.deepStrictEqual([rows[1][2], rows[1][4], rows[1][8]], ['traslado', 'OK', 'previa | Round 21']);
  assert.deepStrictEqual([rows[2][0], rows[2][1], rows[2][2], rows[2][4]], ['2026467', 'Traslado regreso', 'traslado', 'OK']);
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1'); assert.strictEqual(e.fe.props.MIG_R21_TR_CF, '1');
  rows[1][2] = 'ignorar'; assert.deepStrictEqual(J(e.G.ex.migrateTrasladoCampos20261126_(e.ss)), { skipped: true }); assert.strictEqual(rows[1][2], 'ignorar');
  // the mapping now reads them as traslado (M) → first webhook is not "Nuevo – revisar"
  const M = J(e.G.ex.mapeosFromRows_([], rows.slice(1).map(r => r), []));
  assert.strictEqual(M.field['2026467'].uso, 'traslado'); assert.strictEqual(M.field['2026467'].estado, 'OK');
});
test('planTrasladoTarifas_: inserts only missing traslado·barco rows above the generic row; blank generic amount → 0; user rows untouched', () => {
  const old = [['capitan', 'ponton', '', '', '', '', 450, 'salida', ''], ['traslado', '*', '', '', '', '', '', 'salida', 'PENDIENTE: falta campo en FareHarbor'], ['otra', '*', '', '', '', '', 1, 'salida', '']];
  const p = J(E.planTrasladoTarifas_(old));
  assert.deepStrictEqual(p.inserts.map(r => [r[0], r[1], r[6]]), [['traslado', 'catamaran', 100], ['traslado', 'monocasco', 100], ['traslado', 'hobie', 100], ['traslado', 'ponton', 50], ['traslado', 'sup', 0]]);
  assert.strictEqual(p.at, 1); assert.strictEqual(p.starFix, 3);
  // a user's own ponton row (e.g. 60) is kept and not duplicated
  const p2 = J(E.planTrasladoTarifas_([['traslado', 'ponton', '', '', '', '', 60, 'salida', ''], ['traslado', '*', '', '', '', '', 0, 'salida', '']]));
  assert.ok(!p2.inserts.some(r => r[1] === 'ponton')); assert.strictEqual(p2.starFix, 0); assert.strictEqual(p2.at, 1);
  // no generic row → append at the end
  assert.strictEqual(J(E.planTrasladoTarifas_([['capitan', '*', '', '', '', '', 1, 'salida', '']])).at, 1);
});
test('migrateTrasladoTarifas: specific rows end up BEFORE the generic row, others unchanged, once', () => {
  const e = env();
  assert.deepStrictEqual(J(e.G.ex.migrateTrasladoTarifas20261126_(e.ss)), { found: false });
  const sh = e.ss.insertSheet('Tarifas'), H = TAR_H();
  const old = [['capitan', 'ponton', '', '', '', '', 450, 'salida', ''], ['traslado', '*', '', '', '', '', '', 'salida', 'PENDIENTE'], ['cancelado', '*', '', '', '', '', 0.5, 'factor', '']];
  sh.getRange(1, 1, 4, H.length).setValues([H].concat(old));
  const r = J(e.G.ex.migrateTrasladoTarifas20261126_(e.ss));
  assert.deepStrictEqual(r, { inserted: 5, starFix: true });
  const rows = sh._d.rows.slice(1).filter(x => x[0] !== '');
  assert.deepStrictEqual(rows.map(x => x[0] + '·' + x[1]), ['capitan·ponton', 'traslado·catamaran', 'traslado·monocasco', 'traslado·hobie', 'traslado·ponton', 'traslado·sup', 'traslado·*', 'cancelado·*']);
  assert.strictEqual(rows[6][6], 0);
  const lookup = b => E.trasladoRate_(rows, b);
  assert.deepStrictEqual(['catamaran', 'monocasco', 'hobie', 'ponton', 'sup', 'kayak'].map(lookup), [100, 100, 100, 50, 0, 0]);
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1'); assert.strictEqual(e.fe.props.MIG_R21_TR_TAR, '1');
  assert.deepStrictEqual(J(e.G.ex.migrateTrasladoTarifas20261126_(e.ss)), { skipped: true });
});
test('rebuildFinanzas runs both migrations (source) before the pending-rebuild check', () => {
  const src = read('apps-script/Code.gs'), j = src.lastIndexOf('if (seeded || isRebuildPending_())');
  ['migrateTrasladoCampos20261126_(ss); } catch', 'migrateTrasladoTarifas20261126_(ss); } catch'].forEach(k => { const i = src.indexOf(k); assert.ok(i > 0 && i < j, k); });
});

// ---------- client ----------
test('client: Traslado option in Por configurar, Eventuales line, crew note, slip; versions v18 together', () => {
  const html = read('docs/index.html'), sw = read('docs/sw.js');
  ["['traslado','Traslado']", 'const trTxt=', 'trTxt(l.pl.tr,l.d.barco)', 'incl. ${esc(trTxt(p.tr,d.barco).toLowerCase())}'].forEach(k => assert.ok(html.includes(k), k));
  {const v=(html.match(/const APP_VER='v(\d+)'/)||[])[1];assert.ok(v&&+v>=18&&sw.includes("const CACHE = 'al-ops-v"+v+"'"))};
  // run the pure formatters
  const m = /const trWays=[^\n]*\n[^\n]*\n/.exec(html); assert.ok(m);
  const fmt = n => '$' + n;
  const f = new Function('fmt', m[0] + 'return {trTxt, trWays}')(fmt);
  assert.strictEqual(f.trTxt({ ida: true, regreso: true, monto: 200 }, 'catamaran'), 'Traslado ida + regreso $200');
  assert.strictEqual(f.trTxt({ ida: true, regreso: false, monto: 50 }, 'ponton'), 'Traslado ida $50');
  assert.strictEqual(f.trTxt({ ida: true, regreso: false, monto: 0 }, 'sup'), 'Traslado (sup) $0');
  assert.strictEqual(f.trTxt(null, 'sup'), '');
});

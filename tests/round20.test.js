// Round 20: manual pay adjustments and extra departure costs (Ajustes salida / Conceptos), hora extra migration + checkbox, Eventuales per-tour lines, share slip.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const N = loadNew(), E = N.ex;
const TAR = N.get('TAR_SEED');

// ---------- A. hora extra: number of hours OR checkbox ----------
const hx = (q, t) => ['9100', '', '', '', 1, 'Regreso', 'Hora extra (staff)', '2021180', q, t];
test('horaExtraQty_: number of hours, checkbox true/yes/sí/checked = 1 h, false/no/empty = 0', () => {
  assert.strictEqual(E.horaExtraQty_(hx(2, '')), 2); assert.strictEqual(E.horaExtraQty_(hx(1.5, '')), 1.5); assert.strictEqual(E.horaExtraQty_(hx(0, '')), 0);
  ['true', 'True', 'Yes', 'yes', 'Sí', 'si', 'checked', 'x', '1', '✓'].forEach(t => assert.strictEqual(E.horaExtraQty_(hx('', t)), 1, t));
  ['false', 'No', 'no', '', '  ', 'maybe'].forEach(t => assert.strictEqual(E.horaExtraQty_(hx('', t)), 0, JSON.stringify(t)));
  assert.strictEqual(E.horaExtraQty_(hx('', null)), 0); assert.strictEqual(E.horaExtraQty_(hx(-3, '')), 0, 'never negative');
});
const sal = ['9100', 258806, 'Bacalar Lagoon Boat Tour', 'compartido', '2026-03-10', '09:00', '2026-03-10T14:00:00Z', '2026-03-10T17:00:00Z', 1];
const cap = ['9100', '', '', '', 'Capitan', 'Juan Pérez', 'juan', '', ''], gui = ['9100', '', '', '', 'Guia', 'Ana R', 'ana', '', ''];
const cfRows = uso => [['2021180', 'Hora extra (staff)', uso, '', 'OK', '', '', '', '', '', '']];
const Mof = uso => E.mapeosFromRows_([], cfRows(uso), []);
test('hora extra pay: Uso "hora extra" on Campos 2021180 → +100 per hour for capitán/marinero; works for a checkbox and for hours; "ignorar" pays nothing', () => {
  const pay = (bit, M) => J(E.payForSalida_(sal, [cap, gui], bit, TAR, 'ponton', M, new Date('2026-03-11T00:00:00Z'))).pay;
  const on = Mof('hora extra'), off = Mof('ignorar');
  const base = pay([], on)[0][14];
  assert.strictEqual(pay([hx('', 'true')], on)[0][14], base + 100, 'checkbox = 1 h');
  assert.strictEqual(pay([hx(2, '')], on)[0][14], base + 200, 'number of hours');
  assert.strictEqual(pay([hx('', 'No')], on)[0][14], base, 'unchecked');
  assert.strictEqual(pay([hx('', 'true')], off)[0][14], base, 'ignorar: not paid');
  assert.strictEqual(pay([hx('', 'true')], on)[1][12], 0, 'guía does not get hora extra (only capitán / marinero)');
  assert.strictEqual(pay([hx('', 'true')], on)[0][12], 1);
});
test('buildDeps_ source: d.hx uses horaExtraQty_ (checkbox counts in the app too)', () => {
  assert.ok(/hx \+= horaExtraQty_\(b\)/.test(read('apps-script/app.gs')) && /horasExtra \+= horaExtraQty_\(b\)/.test(read('apps-script/Code.gs')));
});

// ---------- B. one-time migration Campos 2021180 ----------
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const p2 = n => String(n).padStart(2, '0');
  fe.Utilities = { formatDate: (d, tz, pt) => { const x = new Date(new Date(d).getTime() - 5 * 3600000), P = { yyyy: x.getUTCFullYear(), MM: p2(x.getUTCMonth() + 1), dd: p2(x.getUTCDate()), HH: p2(x.getUTCHours()), mm: p2(x.getUTCMinutes()) }; return pt.replace(/yyyy|MM|dd|HH|mm/g, k => P[k]); },
    DigestAlgorithm: { SHA_1: 'SHA_1' }, Charset: {}, computeDigest: (alg, x) => Array.from(require('crypto').createHash('sha1').update(String(x), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)), base64Decode: s => Buffer.from(s, 'base64'), newBlob: (b, mt, name) => ({ b, mt, name }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : []; };
  return { ss, fe, G, rows, post: p => G.ex.doPost({ postData: { contents: JSON.stringify(p) } }) };
}
const CF_H = () => J(N.get('CF_HEADERS'));
function envWithCampos(uso, extra) {
  const e = env(); e.G.ex.ensureMapeos_ ? 0 : 0;
  const sh = e.ss.insertSheet('Campos'); const H = CF_H();
  sh.getRange(1, 1, 2, H.length).setValues([H, ['2021180', 'Hora extra (staff)', uso, '', 'Nuevo – revisar', '', '', '', extra || '', '', '']]);
  e.ss.insertSheet('Tipos de cliente'); e.ss.insertSheet('Roles');
  return e;
}
test('planHoraExtraMigration_: found / change only when Uso is ignorar', () => {
  assert.deepStrictEqual(J(E.planHoraExtraMigration_([['1', 'x', 'ignorar'], ['2021180', 'h', 'Ignorar ']])), { found: true, change: true, row: 3 });
  assert.deepStrictEqual(J(E.planHoraExtraMigration_([['2021180', 'h', 'hora extra']])), { found: true, change: false, row: 2 });
  assert.deepStrictEqual(J(E.planHoraExtraMigration_([['1', 'x', 'ignorar']])), { found: false, change: false, row: 0 });
});
test('migration: ignorar → hora extra, Estado OK, Notas, REBUILD_PENDING, once (property); retries until the row exists; never overrides another Uso', () => {
  const e = envWithCampos('ignorar', 'nota previa');
  const r = J(e.G.ex.migrateHoraExtra20261126_(e.ss));
  assert.deepStrictEqual(r, { found: true, changed: true });
  const row = e.ss.getSheetByName('Campos')._d.rows[1];
  assert.strictEqual(row[2], 'hora extra'); assert.strictEqual(row[4], 'OK'); assert.strictEqual(row[8], 'nota previa | Round 20: activado');
  assert.strictEqual(e.fe.props.MIG_R20_HX, '1'); assert.ok((e.fe.props.REBUILD_PENDING === '1'));
  row[2] = 'ignorar'; // the owner sets it back later: the migration does not run again
  assert.deepStrictEqual(J(e.G.ex.migrateHoraExtra20261126_(e.ss)), { skipped: true }); assert.strictEqual(row[2], 'ignorar');
  // row missing → not marked done (retry next run)
  const e2 = env(); const sh = e2.ss.insertSheet('Campos'); sh.getRange(1, 1, 1, CF_H().length).setValues([CF_H()]);
  assert.deepStrictEqual(J(e2.G.ex.migrateHoraExtra20261126_(e2.ss)), { found: false }); assert.ok(!e2.fe.props.MIG_R20_HX);
  // already another Uso: nothing changed, done, no rebuild
  const e3 = envWithCampos('extras'); assert.deepStrictEqual(J(e3.G.ex.migrateHoraExtra20261126_(e3.ss)), { found: true, changed: false });
  assert.strictEqual(e3.ss.getSheetByName('Campos')._d.rows[1][2], 'extras'); assert.ok(e3.fe.props.REBUILD_PENDING !== '1');
});
test('rebuildFinanzas runs the migration (source) before the pending-rebuild check', () => {
  const src = read('apps-script/Code.gs'), i = src.indexOf('migrateHoraExtra20261126_(ss); } catch'), j = src.lastIndexOf('if (seeded || isRebuildPending_())');
  assert.ok(i > 0 && j > i);
});

// ---------- C. pure validators ----------
test('normAjusteSalida_: tipo pago needs persona; monto non-zero number (signed, "$1,500", "−50"); concepto required; tipo strict', () => {
  const ok = { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, motivo: ' fin de semana largo ' };
  assert.deepStrictEqual(J(E.normAjusteSalida_(ok)), { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, motivo: 'fin de semana largo' });
  assert.strictEqual(E.normAjusteSalida_(Object.assign({}, ok, { monto: '−50' })).monto, -50);
  assert.strictEqual(E.normAjusteSalida_(Object.assign({}, ok, { monto: '$1,500.50' })).monto, 1500.5);
  assert.deepStrictEqual(J(E.normAjusteSalida_({ av: 1, tipo: 'costo', persona: 'ignorada', concepto: 'Hielo extra', monto: 90 })), { av: '1', tipo: 'costo', persona: '', concepto: 'Hielo extra', monto: 90, motivo: '' });
  const bad = (o, re) => assert.throws(() => E.normAjusteSalida_(Object.assign({}, ok, o)), re);
  bad({ persona: '' }, /Elige la persona/); bad({ concepto: ' ' }, /Elige el concepto/); bad({ monto: 0 }, /distinto de 0/); bad({ monto: '' }, /distinto de 0/);
  bad({ monto: 'abc' }, /distinto de 0/); bad({ monto: null }, /distinto de 0/); bad({ tipo: 'otro' }, /Tipo inválido/); bad({ av: '' }, /Falta la salida/); bad({ monto: 5e6 }, /demasiado grande/);
  assert.throws(() => E.normAjusteSalida_(null), /Falta la salida/);
});
test('validateConcepto_: unique per tipo (case-insensitive), edit/rename, retry of an applied rename never duplicates, monto optional but non-zero', () => {
  const rows = [['Día festivo', 'pago', 150, 'sí'], ['Otro', 'pago', '', 'sí'], ['Otro', 'costo', '', 'sí']];
  assert.deepStrictEqual(J(E.validateConcepto_({ concepto: 'Propina', tipo: 'pago', monto: '', activo: true }, rows)), { row: 0, values: ['Propina', 'pago', '', 'sí'] });
  assert.deepStrictEqual(J(E.validateConcepto_({ concepto: 'otro', tipo: 'costo', monto: '' , original: { concepto: 'Otro', tipo: 'costo' }, activo: false }, rows)), { row: 4, values: ['otro', 'costo', '', 'no'] });
  assert.throws(() => E.validateConcepto_({ concepto: 'día festivo', tipo: 'pago' }, rows), /Ya existe/);
  assert.doesNotThrow(() => E.validateConcepto_({ concepto: 'Otro', tipo: 'costo' }, rows.slice(0, 2)), 'same name in the other tipo is fine');
  assert.throws(() => E.validateConcepto_({ concepto: 'Otro', tipo: 'pago', original: { concepto: 'Día festivo', tipo: 'pago' } }, rows), /Ya existe/, 'rename onto an existing one');
  assert.deepStrictEqual(J(E.validateConcepto_({ concepto: 'Festivo', tipo: 'pago', monto: 200, original: { concepto: 'Día festivo', tipo: 'pago' } }, [['Festivo', 'pago', 200, 'sí']])).row, 2, 'retry after the rename was applied');
  assert.throws(() => E.validateConcepto_({ concepto: '', tipo: 'pago' }, rows), /nombre/); assert.throws(() => E.validateConcepto_({ concepto: 'X', tipo: 'z' }, rows), /Tipo inválido/);
  assert.throws(() => E.validateConcepto_({ concepto: 'X', tipo: 'pago', monto: 0 }, rows), /distinto de 0/);
  assert.strictEqual(E.validateConcepto_({ concepto: 'Descuento', tipo: 'pago', monto: -50 }, []).values[2], -50);
});
test('conceptosFromRows_ (inactive only for admin), staffFromCrew_ (last 90 days, no externals, distinct, sorted), ajustesActivos_ / ajustesPorSalida_ / ajusteEvRows_', () => {
  const c = J(E.conceptosFromRows_([['A', 'pago', 150, 'sí'], ['B', 'costo', '', 'no'], ['', 'pago', '', 'sí']], false)); assert.deepStrictEqual(c, [{ n: 'A', t: 'pago', m: 150, a: true }]);
  assert.deepStrictEqual(J(E.conceptosFromRows_([['B', 'costo', '', 'no']], true)), [{ n: 'B', t: 'costo', m: null, a: false }]);
  const crew = [['1', '2026-11-20', '', '', 'Capitan', 'Zoe', 'zoe'], ['2', '2026-11-21', '', '', 'Marinero', 'ana', 'ana'], ['3', '2026-11-21', '', '', 'Marinero', 'Ana', 'ana2'], ['4', '2026-11-01', '', '', 'Capitan', 'Capitan Externo', 'capitan.externo'],
    ['5', '2026-05-01', '', '', 'Guia', 'Vieja', 'v'], ['6', '2026-11-22', '', '', 'Guia', 'Futuro', 'f']];
  assert.deepStrictEqual(J(E.staffFromCrew_(crew, '2026-11-21', 90)), ['ana', 'Zoe']);
  const rows = [['A1', '2026-11-20 10:00', '9100', '2026-03-10', 'Tour', 'pago', 'Luis M', 'Día festivo', 150, 'x', 'Jesús', '', '', '', 'c1'], ['A2', '', '9100', '2026-03-10', 'Tour', 'costo', '', 'Hielo extra', 90, '', 'Jesús', '', '', '', ''],
    ['A3', '', '9100', '2026-03-10', 'Tour', 'pago', 'Luis M', 'Descuento', -30, '', 'Jesús', 'sí', 'error', 'Omri', ''], ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']];
  const act = J(E.ajustesActivos_(rows)); assert.deepStrictEqual(act.map(a => a.id), ['A1', 'A2'], 'annulled and empty rows are out');
  assert.deepStrictEqual(J(E.ajustesPorSalida_(act)), { '9100': { pago: 150, costo: 90, total: 240 } });
  const evr = J(E.ajusteEvRows_(act, { '9100': sal }, 4, '2026-12-31'));
  assert.strictEqual(evr.length, 1); assert.deepStrictEqual([evr[0][0], evr[0][1], evr[0][4], evr[0][5], evr[0][7], evr[0][14], evr[0][15], evr[0][17]], ['2026-03-05', '2026-03-10', '9100', 'Luis M', 'Ajuste', 150, 'Ajuste: Día festivo', 'A1']);
  assert.strictEqual(evr[0].length, E.EV_HEADERS.length); assert.strictEqual(E.EV_HEADERS[17], 'Ajuste ID');
  assert.strictEqual(J(E.ajusteEvRows_(act, {}, 4, '2026-03-09')).length, 0, 'departures in the future are not paid yet');
});

// ---------- D. end to end: write API, Eventuales, Resumen, Costos salida, getData ----------
const crewE = [F.crew(F.role(11, 'Capitan', 'Captain'), 'Juan Pérez', 'juan'), F.crew(F.role(12, 'Marinero', 'Sailor'), 'Luis M', 'luis', 'Barco: El Cormoran')];
const mk = (pk, cust) => F.booking({ pk: pk, av: 9100, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-03-10T14:00:00Z', end: '2026-03-10T17:00:00Z', paid: 250000, crew: crewE, customers: cust });
function built() {
  const e = env();
  e.post(mk(7100, [F.cust(100, 'Adult'), F.cust(100, 'Adult')]));
  e.post(mk(7101, [F.cust(1331886, 'OPS · Salida', [F.cfv(2024601, 'Cerveza', '10')])]));
  e.post(mk(7102, [F.cust(1332005, 'OPS · Regreso', [F.cfv(2024601, 'Cerveza', '4')])]));
  e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  return e;
}
const EVH = J(N.get('EV_HEADERS')), CH = J(N.get('COSTO_HEADERS'));
test('addAjusteSalida: appends a row (Por = logged-in user, dates from Salidas), idempotent by cid, validation errors, perm "ajustes", rebuilds Eventuales', () => {
  const e = built(), G = e.G.ex;
  assert.strictEqual(e.rows('Eventuales').length, 2);
  const r = J(G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, motivo: 'domingo', cid: 'cid-1' }));
  assert.ok(r.ok && r.id && !r.dup);
  const row = e.rows('Ajustes salida')[0];
  assert.deepStrictEqual([row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[14]], ['9100', '2026-03-10', 'Bacalar Lagoon Boat Tour', 'pago', 'Luis M', 'Día festivo', 150, 'domingo', 'Omri', '', 'cid-1']);
  assert.strictEqual(J(e.ss.getSheetByName('Ajustes salida')._d.rows[0]).join('|'), J(N.get('AJS_HEADERS')).join('|'));
  assert.ok(J(G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, cid: 'cid-1' })).dup, 'retry with the same cid');
  assert.strictEqual(e.rows('Ajustes salida').length, 1, 'no duplicate');
  assert.throws(() => G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: '', concepto: 'x', monto: 1 }), /Elige la persona/);
  assert.throws(() => G.addAjusteSalida('0000', { av: '9100', tipo: 'costo', concepto: 'x', monto: 0 }), /distinto de 0/);
  assert.throws(() => G.addAjusteSalida('0000', { av: 'nope', tipo: 'costo', concepto: 'x', monto: 5 }), /No encontré la salida/);
  assert.throws(() => G.addAjusteSalida('9999', { av: '9100', tipo: 'costo', concepto: 'x', monto: 5 }), /PIN incorrecto/);
  assert.strictEqual(e.rows('Ajustes salida').length, 1, 'rejected writes append nothing');
  // an op user can (perm default sí), and is recorded as the author; without the perm → blocked
  G.saveUser('0000', { nombre: 'Jesús', pinNuevo: '3333', rol: 'op' });
  G.addAjusteSalida('3333', { av: '9100', tipo: 'costo', concepto: 'Hielo extra', monto: 90, cid: 'cid-2' });
  assert.strictEqual(e.rows('Ajustes salida')[1][10], 'Jesús');
  e.ss.getSheetByName('Permisos')._d.rows.forEach(x => { if (x[0] === 'ajustes') x[3] = 'no'; });
  assert.throws(() => G.addAjusteSalida('3333', { av: '9100', tipo: 'costo', concepto: 'x', monto: 5 }), /Tu rol no puede hacer esto/);
  assert.throws(() => G.anularAjusteSalida('3333', row[0], 'x'), /Tu rol no puede hacer esto/);
});
test('Eventuales: the pago adjustment is a line in the pay week of the departure date; Resumen semanal adds it; salidas count unchanged; crew pay lines in getData untouched', () => {
  const e = built(), G = e.G.ex;
  const before = e.rows('Resumen semanal').find(r => r[1] === 'Luis M');
  G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, cid: 'a' });
  G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Persona Nueva', concepto: 'Bono', monto: 200, cid: 'b' }); // not on the crew
  const ev = e.rows('Eventuales'), adj = ev.filter(r => r[17]);
  assert.strictEqual(adj.length, 2); assert.strictEqual(ev.length, 4);
  const luisAdj = adj.find(r => r[5] === 'Luis M'), luisTour = ev.find(r => r[5] === 'Luis M' && !r[17]);
  assert.strictEqual(luisAdj[0], luisTour[0], 'same pay week as the tour'); assert.strictEqual(luisAdj[1], luisTour[1]); assert.strictEqual(luisAdj[4], '9100'); assert.strictEqual(luisAdj[3], 'Bacalar Lagoon Boat Tour'); assert.strictEqual(luisAdj[14], 150);
  const after = e.rows('Resumen semanal').find(r => r[1] === 'Luis M');
  assert.strictEqual(after[3], before[3] + 150); assert.strictEqual(after[2], before[2], 'an adjustment is not a departure');
  const nuevo = e.rows('Resumen semanal').find(r => r[1] === 'Persona Nueva'); assert.deepStrictEqual([nuevo[2], nuevo[3]], [0, 200]);
  const d = J(G.getData('0000', '2026-03-01', '2026-03-31')).deps.find(x => x.id === '9100');
  const luis = d.crew.find(c => c.n === 'Luis M'); assert.strictEqual(luis.pay.tot, luisTour[14], 'getData keeps the tour pay, adjustment lines do not overwrite it');
  assert.deepStrictEqual(d.aj.map(a => [a.tipo, a.persona, a.concepto, a.monto, a.por]), [['pago', 'Luis M', 'Día festivo', 150, 'Omri'], ['pago', 'Persona Nueva', 'Bono', 200, 'Omri']]);
  // eventualesReport: adjustments count as earned, not as a day / departure
  const rep = J(G.eventualesReport('0000', '2026-03-01', '2026-03-31')), pn = rep.rows.find(x => x.n === 'Persona Nueva');
  assert.deepStrictEqual([pn.ganado, pn.dias, pn.salidas], [200, 0, 0]);
  assert.strictEqual(rep.rows.find(x => x.n === 'Luis M').salidas, 1);
});
test('Costos salida: new last column "Ajustes (MXN)" (pago + costo, signed); Costo total and Costo % include it; getData costs.aj', () => {
  const e = built(), G = e.G.ex, c0 = e.rows('Costos salida')[0];
  const tot0 = c0[CH.indexOf('Costo total (MXN)')], pct0 = c0[CH.indexOf('Costo %')];
  assert.strictEqual(c0[CH.indexOf('Ajustes (MXN)')], 0);
  G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, cid: 'a' });
  G.addAjusteSalida('0000', { av: '9100', tipo: 'costo', concepto: 'Hielo extra', monto: 90, cid: 'b' });
  G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Descuento', monto: -40, cid: 'c' });
  const c = e.rows('Costos salida')[0];
  assert.strictEqual(c[CH.indexOf('Ajustes (MXN)')], 200);
  assert.strictEqual(c[CH.indexOf('Costo total (MXN)')], Math.round((tot0 + 200) * 100) / 100);
  assert.strictEqual(c[CH.indexOf('Tripulación (MXN)')], c0[CH.indexOf('Tripulación (MXN)')], 'Tripulación = tour pay only; adjustments are their own column');
  const ing = c[CH.indexOf('Ingreso neto (MXN)')];
  if (ing) assert.strictEqual(c[CH.indexOf('Costo %')], Math.round((tot0 + 200) / ing * 1000) / 10);
  assert.strictEqual(J(G.getData('0000', '2026-03-01', '2026-03-31')).deps.find(x => x.id === '9100').costs.aj, 200);
});
test('anularAjusteSalida: motivo required, marks Anulado/motivo/por (row kept), twice is a no-op, annulled no longer counts anywhere; unknown id fails', () => {
  const e = built(), G = e.G.ex;
  const id = G.addAjusteSalida('0000', { av: '9100', tipo: 'pago', persona: 'Luis M', concepto: 'Día festivo', monto: 150, cid: 'a' }).id;
  const c1 = e.rows('Costos salida')[0][CH.indexOf('Ajustes (MXN)')]; assert.strictEqual(c1, 150);
  assert.throws(() => G.anularAjusteSalida('0000', id, '  '), /motivo/);
  assert.throws(() => G.anularAjusteSalida('0000', 'nope', 'x'), /No encontré el ajuste/);
  assert.ok(J(G.anularAjusteSalida('0000', id, 'Error de captura')).ok);
  const row = e.rows('Ajustes salida')[0];
  assert.deepStrictEqual([row[11], row[12], row[13]], ['sí', 'Error de captura', 'Omri']); assert.strictEqual(row[8], 150, 'nothing is deleted');
  assert.ok(J(G.anularAjusteSalida('0000', id, 'otra vez')).dup); assert.strictEqual(e.rows('Ajustes salida')[0][12], 'Error de captura');
  assert.strictEqual(e.rows('Eventuales').filter(r => r[17]).length, 0); assert.strictEqual(e.rows('Costos salida')[0][CH.indexOf('Ajustes (MXN)')], 0);
  assert.deepStrictEqual(J(G.getData('0000', '2026-03-01', '2026-03-31')).deps.find(x => x.id === '9100').aj, []);
});
test('Conceptos: seeded once with the agreed list, getData returns them (admin also inactive), saveConcepto admin only; staff list; permiso "ajustes" seeded', () => {
  const e = built(), G = e.G.ex;
  const d = J(G.getData('0000', '2026-03-01', '2026-03-31'));
  assert.deepStrictEqual(d.conceptos.filter(c => c.t === 'pago').map(c => [c.n, c.m]), [['Día festivo', 150], ['Cancelación 50%', null], ['Bono', null], ['Descuento', null], ['Otro', null]]);
  assert.deepStrictEqual(d.conceptos.filter(c => c.t === 'costo').map(c => c.n), ['Hielo extra', 'Gasolina extra', 'Comida tripulación', 'Reparación', 'Otro']);
  assert.strictEqual(e.rows('Conceptos').length, 10);
  assert.deepStrictEqual(d.perms.admin.ajustes, true); assert.deepStrictEqual(d.perms.op.ajustes, true);
  // staff = crew of the last 90 days (these fixtures are from March: out of range) → empty here, and not including externals
  assert.deepStrictEqual(d.staff, []);
  const r = J(G.saveConcepto('0000', { concepto: 'Propina', tipo: 'pago', monto: '', activo: true }));
  assert.ok(r.ok && r.conceptos.some(c => c.n === 'Propina')); assert.strictEqual(e.rows('Conceptos').length, 11);
  G.saveConcepto('0000', { concepto: 'Bono', tipo: 'pago', monto: 300, activo: false, original: { concepto: 'Bono', tipo: 'pago' } });
  assert.deepStrictEqual(e.rows('Conceptos').find(r => r[0] === 'Bono').slice(0, 4), ['Bono', 'pago', 300, 'no']);
  assert.strictEqual(e.rows('Conceptos').length, 11, 'edit updates in place');
  assert.ok(!J(G.getData('0000', '2026-03-01', '2026-03-31')).conceptos.find(c => c.n === 'Bono' && !c.a) === false, 'admin sees inactive');
  G.saveUser('0000', { nombre: 'Jesús', pinNuevo: '3333', rol: 'op' });
  assert.throws(() => G.saveConcepto('3333', { concepto: 'X', tipo: 'pago' }), /Solo el admin/);
  assert.ok(!J(G.getData('3333', '2026-03-01', '2026-03-31')).conceptos.some(c => c.n === 'Bono'), 'op only gets the active ones');
  assert.throws(() => G.saveConcepto('0000', { concepto: 'propina', tipo: 'pago' }), /Ya existe/);
});
test('api map exposes the three new functions; app.gs exports', () => {
  const src = read('apps-script/app.gs');
  assert.ok(/addAjusteSalida: addAjusteSalida, anularAjusteSalida: anularAjusteSalida, saveConcepto: saveConcepto/.test(src));
  assert.ok(/\['ajustes', 'Ajustes de pago y costos de salida', 'sí', 'sí'\]/.test(src));
});

// ---------- E. client (PURE block of docs/index.html) ----------
const html = read('docs/index.html'), sw = read('docs/sw.js');
const pm = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(pm[1] + '\n({extCompact,weekPeopleOf,paySlipText,ajCheck,ajMonto,ajSignOf,ajPeople,concCheck,conceptosOf,durH,wdd,ajMoney,ajSum,optApply,optMark,screenName,SCREENS})', {});
const dep = (id, date, time, crew, aj, costs) => ({ id, date, time, end: date + ' ' + String(Number(time.slice(0, 2)) + 3).padStart(2, '0') + time.slice(2), item: 'Shared Sailing Tour', crew, aj: aj || [], costs: costs || null, hx: 0 });
const cm = (n, tot, hx) => ({ n, r: 'Capitán', pay: { base: tot, hx: hx || 0, tot } });
const A = (id, tipo, persona, concepto, monto) => ({ id, tipo, persona, concepto, monto, motivo: 'm', por: 'Jesús' });
test('client weekPeopleOf: tour pay + pago adjustments (signed) per pay week; adjustment-only people; costo items ignored; future days out', () => {
  const deps = [dep('1', '2026-11-26', '09:00', [cm('Juan', 450, 100)], [A('a', 'pago', 'Juan', 'Día festivo', 150), A('b', 'pago', 'Nuevo', 'Bono', 200), A('c', 'costo', '', 'Hielo extra', 90), A('d', 'pago', 'Juan', 'Descuento', -40)]),
    dep('2', '2026-11-30', '09:00', [cm('Juan', 450)]), dep('3', '2026-12-05', '09:00', [cm('Juan', 450)])];
  const r = U.weekPeopleOf(deps, '2026-11-26', '2026-12-03'), j = J(r.map(p => [p.n, p.tot, p.lines.length, p.adj.length, p.hx]));
  assert.deepStrictEqual(j, [['Juan', 1010, 2, 2, 0], ['Nuevo', 200, 0, 1, 0]]);
  assert.deepStrictEqual(J(U.weekPeopleOf(deps, '2026-11-26', '2026-11-26').map(p => [p.n, p.tot])), [['Juan', 560], ['Nuevo', 200]], 'only departures up to today');
});
test('client: pay slip text, line helpers, durH, money format', () => {
  const p = U.weekPeopleOf([dep('1', '2026-11-26', '09:00', [cm('Juan', 550, 100)], [A('a', 'pago', 'Juan', 'Descuento', -40)])], '2026-11-26', '2026-12-03')[0];
  const t = U.paySlipText(p, 'Semana X');
  assert.deepStrictEqual(t.split('\n'), ['Eventuales · Juan', 'Semana X', '', 'jue 26 09:00 · Shared Sailing Tour · Capitán · $550 (incluye hora extra $100)', 'Ajuste · Descuento · jue 26 Shared Sailing Tour · (m) · −$40', '', 'Total: $510']);
  assert.strictEqual(U.durH({ date: '2026-11-26', time: '09:00', end: '2026-11-26 12:30' }), 3.5); assert.strictEqual(U.durH({ date: '2026-11-26', time: '09:00', end: '' }), 0);
  assert.strictEqual(U.ajMoney(150), '+$150'); assert.strictEqual(U.ajMoney(-40), '−$40'); assert.strictEqual(U.wdd('2026-11-26'), 'jue 26');
});
test('client: sheet validation, signed amount (pago toggle, costo always +), suggested sign, picker order, concepto check', () => {
  assert.strictEqual(U.ajCheck({ tipo: 'pago', persona: '', concepto: 'x', monto: '5' }), 'Elige la persona'); assert.strictEqual(U.ajCheck({ tipo: 'costo', concepto: '', monto: '5' }), 'Elige el concepto');
  assert.strictEqual(U.ajCheck({ tipo: 'costo', concepto: 'x', monto: '' }), 'Escribe el monto'); assert.strictEqual(U.ajCheck({ tipo: 'costo', concepto: 'x', monto: '0' }), 'Escribe el monto'); assert.strictEqual(U.ajCheck({ tipo: 'costo', concepto: 'x', monto: '90' }), null);
  assert.strictEqual(U.ajMonto({ tipo: 'pago', sign: -1, monto: '40' }), -40); assert.strictEqual(U.ajMonto({ tipo: 'pago', sign: 1, monto: '40.5' }), 40.5); assert.strictEqual(U.ajMonto({ tipo: 'costo', sign: -1, monto: '90' }), 90);
  assert.strictEqual(U.ajSignOf({ n: 'Descuento', m: null }), -1); assert.strictEqual(U.ajSignOf({ n: 'Bono', m: -5 }), -1); assert.strictEqual(U.ajSignOf({ n: 'Día festivo', m: 150 }), 1);
  const d = dep('1', '2026-11-26', '09:00', [cm('Juan', 1), { n: 'Ext', ext: true, pay: { tot: 0 } }, cm('Ana', 1)]);
  assert.deepStrictEqual(J(U.ajPeople(d, ['ana', 'Zoe', 'Juan'], '')), { crew: ['Juan', 'Ana'], otros: ['Zoe'] }, 'crew first, no externals, no repeats');
  assert.deepStrictEqual(J(U.conceptosOf([{ n: 'A', t: 'pago', a: true }, { n: 'B', t: 'pago', a: false }, { n: 'C', t: 'costo', a: true }], 'pago')).map(c => c.n), ['A']);
  const L = [{ n: 'Bono', t: 'pago' }];
  assert.ok(/Ya existe/.test(U.concCheck({ nombre: ' bono ', tipo: 'pago', monto: '' }, L, null))); assert.strictEqual(U.concCheck({ nombre: 'Bono', tipo: 'costo', monto: '' }, L, null), null);
  assert.strictEqual(U.concCheck({ nombre: 'Bono', tipo: 'pago', monto: '' }, L, { concepto: 'Bono', tipo: 'pago' }), null, 'editing itself');
  assert.ok(/distinto de 0/.test(U.concCheck({ nombre: 'X', tipo: 'pago', monto: '0' }, L, null))); assert.ok(U.concCheck({ nombre: '', tipo: 'pago' }, L, null));
});
test('client optApply: addAjusteSalida counts at once (aj + costs.tot), idempotent, not duplicated when the server already has the cid; anular removes; saveConcepto upserts; optMark flips label', () => {
  const mk = () => ({ deps: [dep('9', '2026-11-26', '09:00', [cm('Juan', 450)], [A('s1', 'pago', 'Juan', 'Bono', 10)], { tot: 1000, aj: 10 })], conceptos: [{ n: 'Bono', t: 'pago', m: null, a: true }], moves: [], purchases: [], items: [] });
  const ctx = { today: '2026-11-26', hm: '12:00', user: 'Jesús' }, S = mk();
  const q = { id: 'u1', fn: 'addAjusteSalida', args: [{ av: '9', tipo: 'costo', concepto: 'Hielo extra', monto: 90, cid: 'u1' }] };
  U.optApply(S, q, ctx); U.optApply(S, q, ctx);
  assert.strictEqual(S.deps[0].aj.length, 2); assert.strictEqual(S.deps[0].costs.tot, 1090); assert.strictEqual(S.deps[0].costs.aj, 100);
  assert.deepStrictEqual([S.deps[0].aj[1].pend, S.deps[0].aj[1].por], ['guardando…', 'Jesús']);
  q.fail = 'x'; U.optMark(S, q); assert.strictEqual(S.deps[0].aj[1].pend, 'no se guardó');
  const S2 = mk(); S2.deps[0].aj.push(Object.assign(A('s2', 'costo', '', 'Hielo extra', 90), { cid: 'u1' })); U.optApply(S2, { id: 'u1', fn: 'addAjusteSalida', args: q.args }, ctx);
  assert.strictEqual(S2.deps[0].aj.length, 2, 'server already has it: nothing added'); assert.strictEqual(S2.deps[0].costs.tot, 1000);
  U.optApply(S, { id: 'u2', fn: 'anularAjusteSalida', args: ['s1', 'error', 'u2'] }, ctx); U.optApply(S, { id: 'u2', fn: 'anularAjusteSalida', args: ['s1', 'error', 'u2'] }, ctx);
  assert.deepStrictEqual(S.deps[0].aj.map(a => a.id), ['q:u1']); assert.strictEqual(S.deps[0].costs.tot, 1080);
  U.optApply(S, { id: 'c1', fn: 'saveConcepto', args: [{ concepto: 'Propina', tipo: 'pago', monto: '', activo: true, original: null, cid: 'c1' }] }, ctx);
  U.optApply(S, { id: 'c1', fn: 'saveConcepto', args: [{ concepto: 'Propina', tipo: 'pago', monto: '', activo: true, original: null, cid: 'c1' }] }, ctx);
  U.optApply(S, { id: 'c2', fn: 'saveConcepto', args: [{ concepto: 'Bono extra', tipo: 'pago', monto: 20, activo: false, original: { concepto: 'Bono', tipo: 'pago' }, cid: 'c2' }] }, ctx);
  assert.deepStrictEqual(S.conceptos.map(c => [c.n, c.m, c.a]), [['Bono extra', 20, false], ['Propina', null, true]]);
});
test('client wiring: Crew "+ Ajuste" + tappable crew rows, Costos "+ Agregar", Conceptos screen/row, person lines → goDep, Compartir, versions v17', () => {
  ['data-ajnew="${esc(d.id)}|pago|"', 'data-ajnew="${esc(d.id)}|costo|"', '+ Ajuste', '+ Agregar', 'data-ajd=', 'data-evdep=', 'data-share=', "row('conceptos','tag','Conceptos'", "act2==='addconc'", 'async function goDep', 'navigator.share', "toast('Copiado')",
    "enqueue('addAjusteSalida'", "enqueue('anularAjusteSalida'", "enqueue('saveConcepto'", 'Motivo (obligatorio)', "can('ajustes')"].forEach(k => assert.ok(html.indexOf(k) >= 0, k));
  assert.ok(!/srv\('addAjusteSalida'|act\('addAjusteSalida'/.test(html), 'writes only through the queue');
  assert.strictEqual(U.SCREENS.conceptos, 'Conceptos');
  const vH = /const APP_VER='(v\d+)'/.exec(html)[1], vS = /const CACHE = 'al-ops-(v\d+)'/.exec(sw)[1]; assert.ok(vH === vS && +vH.slice(1) >= 17);
});
test('client: crew label is Tripulación; externo note shown compactly (no amount, no "(externo)")', () => {
  assert.strictEqual(U.extCompact('Barco: San Ángel (externo) – Juan Pérez – $3,500'), 'Barco: San Ángel · Juan Pérez');
  assert.strictEqual(U.extCompact('San Ángel – Juan Pérez'), 'San Ángel · Juan Pérez'); assert.strictEqual(U.extCompact(''), '');
  assert.ok(html.includes("gh('crew','Tripulación',") && !html.includes("gh('crew','Crew'"));
});

// ---------- F. Renta de barco (external boat cost in Costos, not on the crew row) ----------
test('getData costs.ext [{barco, persona, monto}] and costs.adic (Costos adicionales without the external cost); total unchanged; client renders Renta de barco', () => {
  const e = env(), G = e.G.ex;
  const crew2 = [F.crew(F.role(11, 'Capitan', 'Captain'), 'Capitan Externo', 'capitan.externo', 'Barco: San Ángel (externo) – Juan Pérez – $3,500'), F.crew(F.role(12, 'Marinero', 'Sailor'), 'Luis M', 'luis', 'Barco: El Cormoran')];
  const mk2 = (pk, cust) => F.booking({ pk: pk, av: 9100, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-03-10T14:00:00Z', end: '2026-03-10T17:00:00Z', paid: 250000, crew: crew2, customers: cust });
  e.post(mk2(7100, [F.cust(100, 'Adult')])); e.post(mk2(7101, [F.cust(1331886, 'OPS · Salida', [F.cfv(2024601, 'Cerveza', '10')])]));
  e.post(mk2(7102, [F.cust(1332005, 'OPS · Regreso', [F.cfv(2024601, 'Cerveza', '4'), F.cfv(2024642, 'Costos adicionales', 'gasolina extra $300')])]));
  G.ensureMapeos_(e.ss); G.rebuildAll();
  const d = J(G.getData('0000', '2026-03-01', '2026-03-31')).deps.find(x => x.id === '9100');
  assert.deepStrictEqual(d.costs.ext, [{ barco: 'San Ángel', persona: 'Juan Pérez', monto: 3500 }]);
  assert.strictEqual(d.costs.ca, 3800); assert.strictEqual(d.costs.adic, 300);
  const row = e.rows('Costos salida')[0], H = J(N.get('COSTO_HEADERS'));
  assert.strictEqual(row[H.indexOf('Costos adicionales (MXN)')], 3800, 'server total still counts the external once');
  assert.ok(/function rbRows/.test(html) && /Renta de barco/.test(html) && /Falta costo/.test(html) && /incluido en Renta de barco/.test(html));
  assert.ok(/caItems=d=>/.test(html) && /\$\{rbRows\(d\)\}\$\{caRows\(d\)\}/.test(html));
});

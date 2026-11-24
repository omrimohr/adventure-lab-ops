const assert = require('assert');
const { loadNew, J, test } = require('./lib');
const F = require('./fixtures');
const N = loadNew(), E = N.ex;
const NOW = new Date('2026-11-24T12:00:00Z');
const PROD_SEED = N.get('PROD_SEED'), TAR_SEED = N.get('TAR_SEED'), TOURS_SEED = N.get('TOURS_SEED');
const tours = J(E.toursFromRows_(TOURS_SEED));
const productos = PROD_SEED.map(r => ({ id: String(r[0]), campo: r[7] }));
const ctx = { campos: E.camposMap_(productos), peoplePks: { '876388': true } };
const seedM = () => {
  const entries = F.ALL.map((x, i) => ({ b: x.booking, t: new Date(Date.UTC(2026, 10, 1, 12, i)) }));
  const s = J(E.seedMapeos_(entries, PROD_SEED, TAR_SEED, tours, NOW));
  return E.mapeosFromRows_(s.ctype, s.field, s.role);
};

// ---------- keys ----------
test('Clave = pk, or n:+normalized name when there is no pk', () => {
  assert.strictEqual(E.ctKey_(F.cust(1331886, 'OPS · Salida')), '1331886');
  assert.strictEqual(E.ctKey_(F.cust(undefined, 'Adulto Ñandú')), 'n:adulto nandu');
  assert.strictEqual(E.cfKey_(F.cfv(2024634, 'Vino')), '2024634');
  assert.strictEqual(E.cfKey_({ name: 'Cerveza  Extra' }), 'n:cerveza extra');
  assert.strictEqual(E.roleKey_({ role: { pk: 11, short_name: 'Capitan' } }), '11');
  assert.strictEqual(E.roleKey_({ role: { short_name: ' Capitán ' } }), 'n:capitan');
  assert.strictEqual(E.roleKey_({}), 'n:');
});

test('renaming in FareHarbor does not break matching (matched by pk)', () => {
  const M = seedM();
  const b = J(F.booking({ pk: 1, av: 1, item: 258806, itemName: 'x', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z',
    customers: [F.cust(1331886, 'Bitácora · Salida (nuevo nombre)', [F.cfv(2024601, 'Cervezas', '9')])] })).booking;
  assert.strictEqual(E.opsType_(b, M), 'Salida');
  const u = J(E.collectUnknowns_(b, M, ctx, NOW));
  assert.strictEqual(u.ctype.length + u.field.length, 0, 'nothing new');
  assert.strictEqual(u.renames.length, 2);
});

// ---------- unknown detection ----------
const newBooking = () => J(F.booking({ pk: 77, av: 77, item: 555, itemName: 'Tour X', start: '2026-11-26T14:00:00Z', end: '2026-11-26T17:00:00Z',
  crew: [F.crew(F.role(55, 'Instructor Lider', 'Lead'), 'Ro', 'ro'), F.crew(F.role(56, 'Capitan Extra'), 'Z', 'z'), F.crew(F.role(0, 'Marinero 2'), 'W', 'w')],
  customers: [F.cust(777, 'Infant'), F.cust(778, 'OPS · Regreso Especial', [F.cfv(9001, 'Cerveza', '4', '4'), F.cfv(9002, 'Cerveza 2', '3'), F.cfv(9003, 'Costos adicionales extra', '10')]),
    F.cust(undefined, 'Sin pk')],
  cfs: [F.cfv(9004, 'Number of people', '5', '5'), F.cfv(9005, 'Cerveza', '1')] })).booking;

test('unknown customer type / field / role are kept, appended as "Nuevo – revisar" with safe defaults', () => {
  const M = seedM(), b = newBooking();
  const u = J(E.collectUnknowns_(b, M, ctx, NOW));
  const ct = Object.fromEntries(u.ctype.map(r => [r[0], r]));
  assert.deepStrictEqual(Object.keys(ct).sort(), ['777', '778', 'n:sin pk']);
  assert.strictEqual(ct['777'][2], 'pax');                          // new type → counts as a person
  assert.strictEqual(ct['778'][2], 'ops regreso');                  // OPS-like name → follows today's name rule
  assert.strictEqual(ct['777'][3], 'Nuevo – revisar');
  assert.strictEqual(ct['777'][5], '555 · Tour X');                 // Visto en = item pk + name
  const cf = Object.fromEntries(u.field.map(r => [r[0], r]));
  assert.deepStrictEqual(Object.keys(cf).sort(), ['9001', '9002', '9003', '9004', '9005']);
  assert.deepStrictEqual([cf['9001'][2], cf['9001'][3]], ['producto', 'cer']); // "Cerveza" on an OPS customer → product by name guess
  assert.strictEqual(cf['9002'][2], 'ignorar');                      // "Cerveza 2" with no match → ignorar
  assert.strictEqual(cf['9003'][2], 'costo adicional');
  assert.strictEqual(cf['9004'][2], 'personas');
  assert.strictEqual(cf['9005'][2], 'ignorar');                      // "Cerveza" outside an OPS customer: not a bitácora field
  assert.strictEqual(cf['9002'][7], '3');                            // Ejemplo
  assert.ok(cf['9001'].slice(4, 5)[0] === 'Nuevo – revisar');
  const rl = Object.fromEntries(u.role.map(r => [r[0], r]));
  assert.deepStrictEqual(Object.keys(rl).sort(), ['55', '56', 'n:marinero 2']);
  assert.strictEqual(rl['55'][3], 'instructor lider');
  assert.strictEqual(u.ctype[0].length, E.CT_HEADERS.length); assert.strictEqual(u.field[0].length, E.CF_HEADERS.length); assert.strictEqual(u.role[0].length, E.ROL_HEADERS.length);
});

test('unknowns are added once (M is updated); known ones are not re-added; results use the default until configured', () => {
  const M = seedM(), b = newBooking();
  const first = J(E.collectUnknowns_(b, M, ctx, NOW)), second = J(E.collectUnknowns_(b, M, ctx, NOW));
  assert.ok(first.ctype.length && first.field.length && first.role.length);
  assert.deepStrictEqual([second.ctype.length, second.field.length, second.role.length], [0, 0, 0]);
  assert.strictEqual(E.typeUso_(M, b.customers[0]), 'pax');
  assert.strictEqual(E.collectUnknowns_(b, null, ctx, NOW).ctype.length, 0);
});

test('known Clave with another name: only Nombre changes (+ "Antes:" in Notas); Uso/Estado untouched', () => {
  const M = seedM();
  const b = J(F.booking({ pk: 2, av: 2, item: 258806, itemName: 'x', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z', customers: [F.cust(100, 'Adulto')] })).booking;
  const before = J(M.ctype['100']);
  const u = J(E.collectUnknowns_(b, M, ctx, NOW));
  assert.deepStrictEqual(u.renames, [{ kind: 'ctype', row: before.row, nuevo: 'Adulto', antes: 'Adult' }]);
  assert.strictEqual(M.ctype['100'].nombre, 'Adulto'); assert.strictEqual(M.ctype['100'].uso, before.uso); assert.strictEqual(M.ctype['100'].estado, before.estado);
  assert.ok(/Antes: Adult/.test(M.ctype['100'].notas));
  assert.strictEqual(J(E.collectUnknowns_(b, M, ctx, NOW)).renames.length, 0); // same name again: nothing
});

test('mapping changes results: "no cuenta" type is excluded from pax; field/role mappings apply', () => {
  const M = seedM(), b = F.DEPARTURES[9001][0].booking, tour = tours['258806'];
  assert.strictEqual(J(E.bookingPax_(b, tour, M)).pax, 5);          // Adult×3 + Child + Senior
  M.ctype['102'].uso = 'no cuenta';
  assert.strictEqual(J(E.bookingPax_(b, tour, M)).pax, 4);
  M.ctype['101'].uso = 'ops salida';                                // now this booking looks like an OPS salida booking
  assert.strictEqual(E.opsType_(b, M), 'Salida');
  M.field['2024650'].uso = 'producto'; M.field['2024650'].prod = 'cer'; // "Cerveza 2" mapped by Omri → counts as beer
  const bits = [['1', '', '', '', 1, 'Salida', 'Cerveza 2', '2024650', 7, '']];
  assert.deepStrictEqual(J(E.consumoSalida_(bits, productos, M)), { cer: 7 });
  M.role['11'].tarifa = 'externo';
  const crew = [['1', '', '', '', 'Capitan', 'Juan', 'juan', '', '11']];
  const sal = ['1', 258806, 'x', 'compartido', '2026-11-20', '09:00', '2026-11-20T14:00:00Z', '2026-11-20T17:00:00Z', 1];
  assert.strictEqual(J(E.payForSalida_(sal, crew, [], TAR_SEED, 'ponton', M)).ext.length, 1);
  M.role['11'].tarifa = 'ignorar';
  const r = J(E.payForSalida_(sal, crew, [], TAR_SEED, 'ponton', M)); assert.strictEqual(r.pay.length + r.ext.length, 0);
});

test('private people field: Tours col D first, else fields with Uso personas', () => {
  const M = seedM(), mk = cfs => J(F.booking({ pk: 3, av: 3, item: 1, itemName: 'x', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z', customers: [F.cust(200, 'Private')], cfs })).booking;
  const b = mk([F.cfv(5001, 'Gente', '7', '7'), F.cfv(5002, 'Number of people', '2', '2')]);
  assert.strictEqual(J(E.bookingPax_(b, { tipo: 'privado', fields: ['5001'] }, M)).pax, 7);   // col D wins
  assert.strictEqual(J(E.bookingPax_(b, { tipo: 'privado', fields: [] }, M)).pax, 2);          // default personas by name rule (unknown field)
  M.field['5001'] = { uso: 'personas', prod: '', estado: 'OK', nombre: 'Gente' };
  assert.strictEqual(J(E.bookingPax_(b, { tipo: 'privado', fields: [] }, M)).pax, 9);          // both Uso personas
});

// ---------- Por configurar / setMapeo validation ----------
test('validateMapeo_: allowed values only', () => {
  const ctx2 = { prodIds: ['cer', 'agu'], barcos: ['ponton', 'sup'] }, v = (k, x) => E.validateMapeo_ ? J(E.validateMapeo_(k, x, ctx2)) : null;
  assert.deepStrictEqual(v('tipo', { uso: 'No cuenta' }), { uso: 'no cuenta' });
  assert.throws(() => v('tipo', { uso: 'otro' }), /inválido/);
  assert.deepStrictEqual(v('campo', { uso: 'producto', prod: 'cer' }), { uso: 'producto', prod: 'cer' });
  assert.throws(() => v('campo', { uso: 'producto', prod: 'zzz' }), /Producto desconocido/);
  assert.throws(() => v('campo', { uso: 'producto' }), /Elige el producto/);
  assert.deepStrictEqual(v('campo', { uso: 'hora extra', prod: 'cer' }), { uso: 'hora extra', prod: '' });
  assert.throws(() => v('campo', { uso: 'foo' }), /inválido/);
  assert.deepStrictEqual(v('rol', { tarifa: ' Capitán ' }), { tarifa: 'capitan' });
  assert.deepStrictEqual(v('rol', { tarifa: 'Externo' }), { tarifa: 'externo' });
  assert.throws(() => v('rol', { tarifa: '  ' }), /Falta el rol/);
  assert.deepStrictEqual(v('item', { tipo: 'privado', barco: 'ponton', fields: '1, 2,2', bitacora: 'sí' }), { tipo: 'privado', barco: 'ponton', fields: '1,2', bitacora: 'sí' });
  assert.deepStrictEqual(v('item', { tipo: 'renta', barco: 'sup', fields: [], bitacora: 'no' }), { tipo: 'renta', barco: 'sup', fields: '', bitacora: 'no' });
  assert.throws(() => v('item', { tipo: 'x', barco: 'ponton', bitacora: 'no' }), /Tipo de tour/);
  assert.throws(() => v('item', { tipo: 'privado', barco: 'lancha', bitacora: 'no' }), /barco/);
  assert.throws(() => v('item', { tipo: 'privado', barco: 'sup', fields: 'abc', bitacora: 'no' }), /números/);
  assert.throws(() => v('item', { tipo: 'privado', barco: 'sup', bitacora: 'quizá' }), /sí o no/);
  assert.throws(() => v('cosa', {}), /desconocido/);
});

test('buildPend_ lists only "Nuevo – revisar", with name+pk, where/when seen, example, current default', () => {
  const entries = F.ALL.map((x, i) => ({ b: x.booking, t: new Date(Date.UTC(2026, 10, 1, 12, i)) }));
  const sd = J(E.seedMapeos_(entries, PROD_SEED, TAR_SEED, tours, NOW)), M0 = E.mapeosFromRows_(sd.ctype, sd.field, sd.role);
  const u = E.collectUnknowns_(newBooking(), M0, ctx, new Date('2026-11-23T10:00:00Z'));   // rows as they would be appended to the tabs
  const M = E.mapeosFromRows_(sd.ctype.concat(u.ctype), sd.field.concat(u.field), sd.role.concat(u.role));
  const toursRows = [[999, 'Tour Nuevo', 'compartido', '', 'no', 'AUTO: revisar tipo y campo de personas', '', 'Nuevo – revisar', new Date('2026-11-22T10:00:00Z')],
    [258806, 'Bacalar Lagoon Boat Tour', 'compartido', '', 'sí', '', 'ponton', 'OK', '']];
  const pend = J(E.buildPend_({ M, toursRows, barcos: {}, seen: { '999': [{ pk: '1', name: 'Number of people', ejemplo: '4' }] } }));
  const by = k => pend.filter(x => x.kind === k);
  assert.deepStrictEqual([by('tipo').length, by('campo').length, by('rol').length, by('item').length], [3, 5, 3, 1]);
  const f = by('campo').find(x => x.clave === '9002');
  assert.deepStrictEqual([f.name, f.pk, f.ejemplo, f.en, f.actual.uso, f.visto], ['Cerveza 2', '9002', '3', '555 · Tour X', 'ignorar', '2026-11-23 05:00']);
  assert.strictEqual(by('tipo').find(x => x.clave === 'n:sin pk').pk, '');
  const it = by('item')[0];
  assert.deepStrictEqual([it.clave, it.name, it.actual.tipo, it.actual.bitacora, it.opciones.campos.length], ['999', 'Tour Nuevo', 'compartido', 'no', 1]);
  assert.ok(it.ms > 0 && it.opciones.barcos.indexOf('ponton') >= 0);
});

test('tour Estado: AUTO rows → Nuevo – revisar, all others OK; explicit value wins; idempotent', () => {
  assert.strictEqual(E.tourEstado_('', 'AUTO: revisar tipo'), 'Nuevo – revisar');
  assert.strictEqual(E.tourEstado_('', 'Check: QTY'), 'OK');
  assert.strictEqual(E.tourEstado_('OK', 'AUTO: revisar tipo'), 'OK');
  assert.strictEqual(E.tourEstado_('Nuevo – revisar', ''), 'Nuevo – revisar');
});

// ---------- health ----------
const H = (o) => J(E.saludAlerts_(Object.assign({ nowMs: Date.parse('2026-11-24T17:00:00Z'), today: '2026-11-24', hhmm: '12:00', dow: 2, lastRawMs: Date.parse('2026-11-24T16:30:00Z'),
  salidas: [], control: [], pendMs: [], erroresHoy: 0, ctrlFrom: '2026-11-16' }, o)));
const types = a => a.map(x => x.tipo);
test('health 1: webhook silence > 4 h, 07:00–21:00 only, not on Wednesday, overnight gap ignored', () => {
  assert.deepStrictEqual(H({}), []);
  const a = H({ lastRawMs: Date.parse('2026-11-24T10:00:00Z') });                // 07 h ago (05:00 local)… window starts 07:00 → 5 h of silence
  assert.deepStrictEqual(a.map(x => [x.tipo, x.rol, x.nivel, x.texto]), [['webhook', 'admin', 'warn', 'Sin eventos de FareHarbor hace 7 h']]);
  assert.deepStrictEqual(H({ lastRawMs: Date.parse('2026-11-24T10:00:00Z'), dow: 3 }), []);        // Wednesday
  assert.deepStrictEqual(H({ lastRawMs: Date.parse('2026-11-24T10:00:00Z'), hhmm: '06:59', nowMs: Date.parse('2026-11-24T11:59:00Z') }), []); // before 07:00
  assert.deepStrictEqual(H({ lastRawMs: Date.parse('2026-11-23T10:00:00Z'), hhmm: '21:00', nowMs: Date.parse('2026-11-25T02:00:00Z') }), []); // after 21:00
  // 07:30, last event last night: not an alert yet (only 0.5 h into the day)…
  assert.deepStrictEqual(H({ lastRawMs: Date.parse('2026-11-24T03:00:00Z'), hhmm: '07:30', nowMs: Date.parse('2026-11-24T12:30:00Z') }), []);
  // … but at 11:30 it is
  assert.deepStrictEqual(types(H({ lastRawMs: Date.parse('2026-11-24T03:00:00Z'), hhmm: '11:30', nowMs: Date.parse('2026-11-24T16:30:00Z') })), ['webhook']);
  assert.deepStrictEqual(H({ lastRawMs: null }), []);
});
const sal = (fecha, hora, o) => Object.assign({ fecha, hora, item: 'Tour', activas: 2, bitacora: 'Falta regreso', lleva: true, hasOps: false }, o || {});
test('health 2: bitácora missing — last 7 days, today only after 21:00, needs active bookings and (lleva bitácora or an OPS booking)', () => {
  const a = H({ salidas: [sal('2026-11-23', '09:00'), sal('2026-11-17', '09:00'), sal('2026-11-16', '09:00'), sal('2026-11-22', '10:00', { bitacora: 'Completa' }),
    sal('2026-11-22', '11:00', { activas: 0 }), sal('2026-11-21', '09:00', { lleva: false, hasOps: false }), sal('2026-11-21', '10:00', { lleva: false, hasOps: true, bitacora: 'Falta salida' }),
    sal('2026-11-24', '09:00')] });
  assert.deepStrictEqual(a.map(x => x.texto), ['Falta bitácora: 2026-11-23 09:00 Tour', 'Falta bitácora: 2026-11-21 10:00 Tour', 'Falta bitácora: 2026-11-17 09:00 Tour']);
  assert.ok(a.every(x => x.rol === 'todos' && x.tipo === 'bitacora'));
  assert.deepStrictEqual(types(H({ hhmm: '21:00', salidas: [sal('2026-11-24', '09:00')] })), ['bitacora']);
  assert.strictEqual(H({ salidas: Array.from({ length: 11 }, (_, i) => sal('2026-11-2' + (i % 3), '0' + (i % 9) + ':00', { item: 'T' + i })) }).length <= 9, true);
});
test('health 3: Comercial report missing — day with "estimado" bookings, from 12:00 of the next day, within 14 days, ≥ control start', () => {
  const ctl = [{ d: '2026-11-23', est: 2 }, { d: '2026-11-22', est: 1 }, { d: '2026-11-21', est: 0 }, { d: '2026-11-15', est: 3 }];
  assert.deepStrictEqual(H({ control: ctl, hhmm: '12:00' }).map(x => [x.texto, x.rol]), [['Falta reporte de Comercial del 2026-11-23', 'admin'], ['Falta reporte de Comercial del 2026-11-22', 'admin']]);
  assert.deepStrictEqual(H({ control: ctl, hhmm: '11:59' }).map(x => x.texto), ['Falta reporte de Comercial del 2026-11-22']);
  assert.deepStrictEqual(H({ control: [{ d: '2026-11-09', est: 1 }], ctrlFrom: '2026-11-01', today: '2026-11-24' }), []); // older than 14 days
});
test('health 4+5: things to configure > 2 days, errors today (admin only); nothing blocks', () => {
  const a = H({ pendMs: [Date.parse('2026-11-21T00:00:00Z'), Date.parse('2026-11-24T00:00:00Z'), Date.parse('2026-11-20T00:00:00Z')], erroresHoy: 1 });
  assert.deepStrictEqual(a.map(x => [x.tipo, x.texto, x.rol]), [['config', '2 cosas por configurar desde hace más de 2 días', 'admin'], ['errores', '1 error hoy en la conexión', 'admin']]);
  assert.strictEqual(H({ erroresHoy: 4 })[0].texto, '4 errores hoy en la conexión');
  assert.deepStrictEqual(H({ pendMs: [Date.parse('2026-11-23T12:00:00Z')] }), []);
  assert.ok(H({ erroresHoy: 4 }).every(x => x.nivel === 'warn'));
});

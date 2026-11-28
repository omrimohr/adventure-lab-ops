// Round 27: Más › Configuración avanzada — 6-digit code (hashed in a Script Property), token (CacheService 15 min), 5 tries → 10-min lockout,
// owner-only (user "Omri", admin), setConfigAvanzada / revert / "Cambios config" log, REBUILD_PENDING, older writers gated once a code exists.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'docs/sw.js'), 'utf8');
const gs = fs.readFileSync(path.join(ROOT, 'apps-script/app.gs'), 'utf8');

test('APP_VER = CACHE = v24', () => {
  const v = /const APP_VER='(v\d+)'/.exec(html); assert.ok(v && sw.indexOf("const CACHE = 'al-ops-" + v[1] + "'") >= 0);
});

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss), store = {};
  fe.CacheService = { getScriptCache: () => ({ get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = String(v); }, remove: k => { delete store[k]; } }) };
  const p2 = n => String(n).padStart(2, '0');
  fe.Utilities = { formatDate: (d, tz, pt) => { const x = new Date(new Date(d).getTime() - 5 * 3600000), P = { yyyy: x.getUTCFullYear(), MM: p2(x.getUTCMonth() + 1), dd: p2(x.getUTCDate()), HH: p2(x.getUTCHours()), mm: p2(x.getUTCMinutes()) }; return pt.replace(/yyyy|MM|dd|HH|mm/g, k => P[k]); },
    DigestAlgorithm: { SHA_256: 'SHA_256', SHA_1: 'SHA_1' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg === 'SHA_256' ? 'sha256' : 'sha1').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID() };
  const G = loadNew(fe);
  const ex = G.ex;
  // mapping tabs + Tours
  const tab = (name, headers, rows) => { const sh = ss.insertSheet(name); sh.getRange(1, 1, 1 + rows.length, headers.length).setValues([headers].concat(rows)); };
  tab('Tours', G.get('TOURS_HEADERS').concat(['Barco', 'Estado', 'Visto primero']), [
    ['244132', 'Private Boat Tour', 'privado', '1463805', 'sí', '', 'catamaran', 'OK', ''],
    ['337344', 'Velero Monocasco', 'privado', '', 'sí', '', 'monocasco', 'Nuevo – revisar', '']]);
  tab('Tipos de cliente', ex.CT_HEADERS, [['1105001', 'Adult', 'pax', 'OK', '', '', '', '', ''], ['1331886', 'OPS · Salida', 'ops salida', 'OK', '', '', '', '', '']]);
  tab('Campos', ex.CF_HEADERS, [['1889802', 'Number of people', 'personas', '', 'OK', '', '', '4', '', '', ''], ['2024634', 'Vino', 'ignorar', '', 'Nuevo – revisar', '', '', '2', '', '', '']]);
  tab('Roles', ex.ROL_HEADERS, [['11', 'Capitan', 'Capitán', 'capitan', 'OK', '', '', '', '', ''], ['13', 'Guia', 'Guía', '', 'Nuevo – revisar', '', '', '', '', '']]);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : []; };
  return { ss, fe, G: ex, ctx: G, store, rows };
}
const add = (e, nombre, pin, rol) => e.G.saveUser('0000', { nombre, pinNuevo: pin, rol });
const unlock = (e, code) => J(e.G.cfgAvUnlock('0000', code || '123456', code || '123456'));

test('owner only: "Omri" + admin; getData / login carry the flag; other admins and ops are refused everywhere', () => {
  const e = env(), G = e.G;
  add(e, 'Carlos', '1111', 'admin'); add(e, 'Jesús', '2222', 'op');
  assert.strictEqual(J(G.login('0000')).cfgAv, true); assert.strictEqual(J(G.login('1111')).cfgAv, false); assert.strictEqual(J(G.login('2222')).cfgAv, false);
  assert.strictEqual(J(G.getData('0000')).user.cfgAv, true); assert.strictEqual(J(G.getData('1111')).user.cfgAv, false);
  ['cfgAvEstado', 'cfgAvUnlock'].forEach(fn => { assert.throws(() => G[fn]('1111', '123456', '123456'), /No disponible/); assert.throws(() => G[fn]('2222', '123456', '123456'), /No disponible/); });
  assert.throws(() => G.cfgAvEstado('9999'), /PIN incorrecto/);
  assert.strictEqual(G.isCfgOwner_({ nombre: ' omri ', rol: 'admin' }), true); assert.strictEqual(G.isCfgOwner_({ nombre: 'Omri', rol: 'op' }), false);
});

test('first time: Omri creates the code (6 digits + confirm); it is stored hashed + salted in a Script Property, never in a sheet or returned', () => {
  const e = env(), G = e.G;
  assert.deepStrictEqual(J(G.cfgAvEstado('0000')), { ok: true, set: false, bloqueado: false });
  assert.throws(() => G.cfgAvUnlock('0000', '12345', '12345'), /6 dígitos/);
  assert.throws(() => G.cfgAvUnlock('0000', '12345a', '12345a'), /6 dígitos/);
  assert.throws(() => G.cfgAvUnlock('0000', '123456', '654321'), /no coinciden/);
  assert.strictEqual(e.fe.props.CFG_CODE_HASH, undefined, 'nothing stored after a failed attempt');
  const r = unlock(e);
  assert.ok(r.ok && r.creado && r.token && r.segundos === 900);
  const salt = e.fe.props.CFG_CODE_SALT, hash = e.fe.props.CFG_CODE_HASH;
  assert.ok(salt && /^[0-9a-f]{64}$/.test(hash));
  assert.strictEqual(hash, crypto.createHash('sha256').update(salt + ':123456').digest('hex'));
  assert.ok(!JSON.stringify(e.fe.props).includes('"123456"') && !JSON.stringify(e.ss._sheets, (k, v) => (k === 'getParent' ? undefined : v)).includes('123456'), 'plain code never persisted');
  assert.strictEqual(J(G.cfgAvEstado('0000')).set, true);
  // afterwards the code is needed (no more "create")
  assert.throws(() => G.cfgAvUnlock('0000', '999999', '999999'), /Código incorrecto/);
  assert.ok(J(G.cfgAvUnlock('0000', '123456')).token);
});

test('wrong code: 5 tries then a 10-minute lockout (even the right code is refused); success resets the counter; token is bound to the user', () => {
  const e = env(), G = e.G; unlock(e);
  for (let i = 1; i <= 3; i++) assert.throws(() => G.cfgAvUnlock('0000', '000000'), new RegExp('Te quedan ' + (5 - i) + ' intento'));
  assert.ok(J(G.cfgAvUnlock('0000', '123456')).ok, 'success resets');
  for (let i = 1; i <= 4; i++) assert.throws(() => G.cfgAvUnlock('0000', '000000'), /Te quedan/);
  assert.throws(() => G.cfgAvUnlock('0000', '000000'), /Demasiados intentos\. Espera 10 minutos/);
  assert.throws(() => G.cfgAvUnlock('0000', '123456'), /Demasiados intentos/, 'locked: the right code is refused too');
  assert.strictEqual(J(G.cfgAvEstado('0000')).bloqueado, true);
  delete e.store.cfglock; // the 10 minutes pass (cache TTL)
  assert.ok(J(G.cfgAvUnlock('0000', '123456')).ok);
});

test('token: every config write needs pin + live token (15 min); an expired / wrong token is refused', () => {
  const e = env(), G = e.G, t = unlock(e).token;
  assert.ok(J(G.cfgAvGet('0000', t)).ok);
  assert.throws(() => G.cfgAvGet('0000', ''), /vencida/); assert.throws(() => G.cfgAvGet('0000', 'nope'), /vencida/);
  assert.throws(() => G.setConfigAvanzada('0000', 'nope', 'items', '244132', 'barco', 'ponton'), /vencida/);
  assert.throws(() => G.cfgAvRevertir('0000', 'nope', 2), /vencida/);
  assert.throws(() => G.cfgAvItemCampos('0000', 'nope', '244132'), /vencida/);
  add(e, 'Carlos', '1111', 'admin');
  assert.throws(() => G.setConfigAvanzada('1111', t, 'items', '244132', 'barco', 'ponton'), /No disponible/, 'another admin can not reuse the token');
  delete e.store['cfgtok:' + t];
  assert.throws(() => G.setConfigAvanzada('0000', t, 'items', '244132', 'barco', 'ponton'), /vencida/);
  assert.strictEqual(e.rows('Cambios config').length, 0);
});

test('cambiar código: needs a live token AND the current code; new code 6 digits + confirm; old code stops working', () => {
  const e = env(), G = e.G, t = unlock(e).token;
  assert.throws(() => G.cfgAvChangeCode('0000', t, '000000', '654321', '654321'), /Código incorrecto/);
  assert.throws(() => G.cfgAvChangeCode('0000', t, '123456', '65432', '65432'), /6 dígitos/);
  assert.throws(() => G.cfgAvChangeCode('0000', t, '123456', '654321', '111111'), /no coinciden/);
  assert.throws(() => G.cfgAvChangeCode('0000', 'nope', '123456', '654321', '654321'), /vencida/);
  const r = J(G.cfgAvChangeCode('0000', t, '123456', '654321', '654321')); assert.ok(r.ok && r.token);
  assert.throws(() => G.cfgAvUnlock('0000', '123456'), /Código incorrecto/);
  assert.ok(J(G.cfgAvUnlock('0000', '654321')).ok);
});

test('cfgAvGet: items, campos, tipos, roles (with Estado), conceptos, config, historial and options', () => {
  const e = env(), G = e.G, t = unlock(e).token, d = J(G.cfgAvGet('0000', t));
  assert.deepStrictEqual(d.items.map(x => [x.pk, x.tipo, x.barco, x.fields, x.estado]), [['244132', 'privado', 'catamaran', ['1463805'], 'OK'], ['337344', 'privado', 'monocasco', [], 'Nuevo – revisar']]);
  assert.deepStrictEqual(d.campos.map(x => [x.clave, x.uso, x.estado]), [['1889802', 'personas', 'OK'], ['2024634', 'ignorar', 'Nuevo – revisar']]);
  assert.deepStrictEqual(d.tipos.map(x => [x.clave, x.uso]), [['1105001', 'pax'], ['1331886', 'ops salida']]);
  assert.deepStrictEqual(d.roles.map(x => [x.clave, x.tarifa, x.estado]), [['11', 'capitan', 'OK'], ['13', '', 'Nuevo – revisar']]);
  assert.deepStrictEqual(d.config, [{ key: 'semana_pago', label: 'Semana de pago de eventuales', valor: 'jueves' }, { key: 'semana_inicio', label: 'Semana del reporte de stock', valor: 'jueves' }, { key: 'gasolina_desde', label: 'Gasolina real desde (bitácora)', valor: '2026-11-28' }, { key: 'gasolina_precio', label: 'Precio de gasolina (MXN por litro)', valor: '25' }]);
  assert.ok(d.conceptos.length >= 5 && d.opciones.tarifas.indexOf('capitan') >= 0 && d.opciones.prods.length >= 1 && Array.isArray(d.historial));
});

test('setConfigAvanzada: items (tipo / barco / fields / estado) — validated with validateMapeo_, logged, REBUILD_PENDING', () => {
  const e = env(), G = e.G, t = unlock(e).token;
  assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined);
  const r = J(G.setConfigAvanzada('0000', t, 'items', '244132', 'barco', 'ponton'));
  assert.deepStrictEqual([r.ok, r.changed, r.rebuildPending], [true, true, true]);
  const tr = e.rows('Tours').find(x => x[0] === '244132'); assert.strictEqual(tr[6], 'ponton'); assert.strictEqual(tr[2], 'privado'); assert.strictEqual(tr[3], '1463805', 'other fields untouched');
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1');
  G.setConfigAvanzada('0000', t, 'items', '244132', 'fields', '1463805,1463814');
  assert.strictEqual(e.rows('Tours').find(x => x[0] === '244132')[3], '1463805,1463814');
  G.setConfigAvanzada('0000', t, 'items', '244132', 'tipo', 'renta');
  G.setConfigAvanzada('0000', t, 'items', '337344', 'estado', 'OK');
  assert.strictEqual(e.rows('Tours').find(x => x[0] === '337344')[7], 'OK');
  const log = e.rows('Cambios config').map(x => x.slice(1, 8));
  assert.deepStrictEqual(log[0], ['Omri', 'items', '244132', 'Private Boat Tour', 'barco', 'catamaran', 'ponton']);
  assert.deepStrictEqual(log[1].slice(4), ['fields', '1463805', '1463805,1463814']);
  assert.deepStrictEqual(log[3].slice(2, 7), ['337344', 'Velero Monocasco', 'estado', 'Nuevo – revisar', 'OK'].slice(0, 5));
  assert.ok(e.rows('Cambios config').every(x => x[0] instanceof Date));
  assert.throws(() => G.setConfigAvanzada('0000', t, 'items', '244132', 'barco', 'submarino'), /barco inválido/i);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'items', '244132', 'tipo', 'raro'), /Tipo de tour inválido/);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'items', '244132', 'fields', 'abc'), /pk/);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'items', '999', 'barco', 'ponton'), /No encontré/);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'items', '244132', 'nombre', 'x'), /Campo inválido/);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'conceptos', 'x', 'monto', '1'), /Sección inválida/);
});

test('setConfigAvanzada: campos (uso, producto:<id>), tipos, roles, config — validated; no change = no row and no REBUILD_PENDING', () => {
  const e = env(), G = e.G, t = unlock(e).token;
  const same = J(G.setConfigAvanzada('0000', t, 'tipos', '1105001', 'uso', 'pax')); assert.strictEqual(same.changed, false);
  assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined); assert.strictEqual(e.rows('Cambios config').length, 0);
  G.setConfigAvanzada('0000', t, 'tipos', '1105001', 'uso', 'no cuenta');
  assert.strictEqual(e.rows('Tipos de cliente').find(x => x[0] === '1105001')[2], 'no cuenta');
  assert.throws(() => G.setConfigAvanzada('0000', t, 'tipos', '1105001', 'uso', 'otra'), /Uso inválido/);
  const prod = J(G.cfgAvGet('0000', t)).opciones.prods[0].id;
  G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'producto:' + prod);
  const cf = e.rows('Campos').find(x => x[0] === '2024634'); assert.deepStrictEqual([cf[2], cf[3]], ['producto', prod]);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'producto:zzz'), /Producto desconocido/);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'producto'), /Elige el producto/);
  G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'ignorar');
  assert.deepStrictEqual([e.rows('Campos').find(x => x[0] === '2024634')[2], e.rows('Campos').find(x => x[0] === '2024634')[3]], ['ignorar', '']);
  G.setConfigAvanzada('0000', t, 'roles', '13', 'tarifa', 'Guía');
  assert.strictEqual(e.rows('Roles').find(x => x[0] === '13')[3], 'guia');
  assert.throws(() => G.setConfigAvanzada('0000', t, 'roles', '13', 'tarifa', ''), /Falta el rol/);
  G.setConfigAvanzada('0000', t, 'config', 'semana_pago', 'valor', 'lunes');
  assert.strictEqual(e.rows('Config').find(x => x[0] === 'semana_pago')[1], 'lunes');
  assert.throws(() => G.setConfigAvanzada('0000', t, 'config', 'semana_pago', 'valor', 'ayer'), /inválido/);
  assert.throws(() => G.setConfigAvanzada('0000', t, 'config', 'otra_cosa', 'valor', 'x'), /desconocido/);
  const cfgLog = e.rows('Cambios config').filter(x => x[2] === 'config'); assert.deepStrictEqual(cfgLog[0].slice(3, 8), ['semana_pago', 'Semana de pago de eventuales', 'valor', 'jueves', 'lunes']);
  assert.ok(e.rows('Cambios config').length === 5 && e.fe.props.REBUILD_PENDING === '1');
});

test('Historial: cfgAvGet lists newest first; Revertir writes the Antes back and logs a NEW row; conceptos rows are not revertible', () => {
  const e = env(), G = e.G, t = unlock(e).token;
  G.setConfigAvanzada('0000', t, 'items', '244132', 'barco', 'ponton');
  G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'personas');
  G.saveConcepto('0000', { concepto: 'Propina', tipo: 'pago', monto: '', activo: true, token: t });
  let h = J(G.cfgAvGet('0000', t)).historial;
  assert.deepStrictEqual(h.map(x => x.sec), ['conceptos', 'campos', 'items']);
  assert.deepStrictEqual(h.map(x => x.rev), [false, true, true]);
  assert.throws(() => G.cfgAvRevertir('0000', t, h[0].id), /no se puede revertir/);
  const it = h.find(x => x.sec === 'items');
  assert.ok(J(G.cfgAvRevertir('0000', t, it.id)).changed);
  assert.strictEqual(e.rows('Tours').find(x => x[0] === '244132')[6], 'catamaran');
  h = J(G.cfgAvGet('0000', t)).historial;
  assert.strictEqual(h.length, 4); assert.deepStrictEqual([h[0].sec, h[0].campo, h[0].antes, h[0].despues], ['items', 'barco', 'ponton', 'catamaran']);
  assert.strictEqual(J(G.cfgAvRevertir('0000', t, it.id)).changed, false, 'already at that value (second revert of the same row): no-op, nothing logged');
  assert.throws(() => G.cfgAvRevertir('0000', t, 999), /No encontré/);
  // campos uso with producto round-trips
  const prod = J(G.cfgAvGet('0000', t)).opciones.prods[0].id;
  G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'producto:' + prod);
  G.setConfigAvanzada('0000', t, 'campos', '2024634', 'uso', 'ignorar');
  const last = J(G.cfgAvGet('0000', t)).historial[0]; G.cfgAvRevertir('0000', t, last.id);
  const cf = e.rows('Campos').find(x => x[0] === '2024634'); assert.deepStrictEqual([cf[2], cf[3]], ['producto', prod]);
});

test('older writers: setConfig / saveConcepto work as before until a code exists, then need the live token; both are logged in Cambios config', () => {
  const e = env(), G = e.G;
  G.setConfig('0000', 'semana_inicio', 'lunes'); G.saveConcepto('0000', { concepto: 'Propina', tipo: 'pago', monto: '', activo: true });
  assert.deepStrictEqual(e.rows('Cambios config').map(x => [x[2], x[3], x[5], x[6], x[7]]), [['config', 'semana_inicio', 'valor', 'jueves', 'lunes'], ['conceptos', 'pago:Propina', 'nuevo', '', 'monto  · activo sí']]);
  const t = unlock(e).token;
  assert.throws(() => G.setConfig('0000', 'semana_inicio', 'jueves'), /vencida/);
  assert.throws(() => G.saveConcepto('0000', { concepto: 'Otro2', tipo: 'pago', monto: '', activo: true }), /vencida/);
  assert.ok(G.setConfig('0000', 'semana_inicio', 'jueves', t).ok);
  assert.ok(G.saveConcepto('0000', { concepto: 'Bono', tipo: 'pago', monto: 300, activo: false, original: { concepto: 'Bono', tipo: 'pago' }, token: t }).ok);
  const l = e.rows('Cambios config').filter(x => x[4] === 'Bono').map(x => [x[5], x[6], x[7]]); assert.deepStrictEqual(l, [['monto', '', '300'], ['activo', 'sí', 'no']]);
});

test('Por configurar (setMapeo) still works without the code and now also logs the change (+ Estado Nuevo → OK)', () => {
  const e = env(), G = e.G; unlock(e);
  const r = J(G.setMapeo('0000', 'campo', '2024634', { uso: 'personas' })); assert.ok(r.ok && r.rebuildPending);
  const log = e.rows('Cambios config').map(x => x.slice(2, 8));
  assert.deepStrictEqual(log, [['campos', '2024634', 'Vino', 'uso', 'ignorar', 'personas'], ['campos', '2024634', 'Vino', 'estado', 'Nuevo – revisar', 'OK']]);
  G.setMapeo('0000', 'item', '337344', { tipo: 'privado', barco: 'monocasco', fields: ['1463814'], bitacora: 'sí' });
  assert.strictEqual(e.rows('Tours').find(x => x[0] === '337344')[7], 'OK');
  assert.ok(e.rows('Cambios config').some(x => x[2] === 'items' && x[5] === 'fields' && x[7] === '1463814'));
  assert.throws(() => G.setMapeo('0000', 'rol', '999', { tarifa: 'capitan' }), /No encontré/);
});

test('mapeoDiff_ / cambiosFromRows_ (pure)', () => {
  const E = loadNew().ex;
  assert.deepStrictEqual(J(E.mapeoDiff_('campo', { uso: 'producto', prod: 'vin' }, { uso: 'personas', prod: '' })), [['uso', 'producto:vin', 'personas']]);
  assert.deepStrictEqual(J(E.mapeoDiff_('item', { tipo: 'a', barco: 'b', fields: '1', bitacora: 'sí' }, { tipo: 'a', barco: 'c', fields: '1', bitacora: 'sí' })), [['barco', 'b', 'c']]);
  assert.deepStrictEqual(J(E.mapeoDiff_('rol', { tarifa: 'x' }, { tarifa: 'x' })), []);
  const rows = [['2026-11-27 10:00', 'Omri', 'items', 1, 'N', 'barco', 'a', 'b'], ['2026-11-27 11:00', 'Omri', 'conceptos', 'k', 'N', 'monto', '', '5'], ['', '', '', '', '', '', '', '']];
  const h = J(E.cambiosFromRows_(rows, 10)); assert.deepStrictEqual(h.map(x => [x.id, x.sec, x.rev, x.clave]), [[3, 'conceptos', false, 'k'], [2, 'items', true, '1']]);
  assert.strictEqual(J(E.cambiosFromRows_(rows, 1)).length, 1);
});

test('API map exposes the new functions; every config writer goes through the token gate', () => {
  ['cfgAvEstado', 'cfgAvUnlock', 'cfgAvChangeCode', 'cfgAvGet', 'cfgAvItemCampos', 'setConfigAvanzada', 'cfgAvRevertir'].forEach(f => assert.ok(new RegExp(f + ': ' + f).test(gs), f));
  assert.ok(/CFG_CODE_HASH/.test(gs) && /SHA_256/.test(gs) && !/getRange\([^)]*\)\.setValue\([^)]*code/i.test(gs));
  assert.ok(/function setConfig\(pin, key, value, token\)[\s\S]*cfgGate_\(pin, token\)/.test(gs) && /function saveConcepto[\s\S]*cfgGate_\(pin/.test(gs));
});

// ---------- client ----------
const pm = html.match(/\/\/ ==PURE-BEGIN==[\s\S]*?\/\/ ==PURE-END==/);
const U = vm.runInNewContext(pm[0] + '\n({cfgChanges,cfgCode6,cfgOk,cfgSecOf})', {});
test('client pure helpers: cfgChanges per section, cfgCode6, cfgOk (token + expiry), cfgSecOf', () => {
  assert.deepStrictEqual(J(U.cfgChanges('items', { tipo: 'privado', barco: 'ponton', fields: '1', estado: 'OK' }, { tipo: 'privado', barco: 'hobie', fields: '1,2', estado: 'OK' })), [['barco', 'hobie'], ['fields', '1,2']]);
  assert.deepStrictEqual(J(U.cfgChanges('items', { tipo: 'a', barco: 'b', fields: '', estado: 'OK' }, { tipo: 'a', barco: 'b', fields: '', estado: 'OK' })), []);
  assert.deepStrictEqual(J(U.cfgChanges('campos', { uso: 'ignorar', prod: '', estado: 'Nuevo – revisar' }, { uso: 'producto', prod: 'vin', estado: 'OK' })), [['uso', 'producto:vin'], ['estado', 'OK']]);
  assert.deepStrictEqual(J(U.cfgChanges('tipos', { uso: 'pax', estado: 'OK' }, { uso: 'no cuenta', estado: 'OK' })), [['uso', 'no cuenta']]);
  assert.deepStrictEqual(J(U.cfgChanges('roles', { tarifa: '', estado: 'Nuevo – revisar' }, { tarifa: 'guia', estado: 'OK' })), [['tarifa', 'guia'], ['estado', 'OK']]);
  assert.deepStrictEqual(J(U.cfgChanges('config', { valor: 'jueves' }, { valor: 'lunes' })), [['valor', 'lunes']]);
  assert.ok(U.cfgCode6('012345') && !U.cfgCode6('12345') && !U.cfgCode6('1234567') && !U.cfgCode6('12a456') && !U.cfgCode6(''));
  assert.ok(U.cfgOk({ tok: 't', exp: 2000 }, 1000) && !U.cfgOk({ tok: 't', exp: 900 }, 1000) && !U.cfgOk({ tok: '', exp: 9999 }, 1000) && !U.cfgOk(null, 1));
  assert.deepStrictEqual(['tipo', 'campo', 'rol', 'item', 'x'].map(U.cfgSecOf), ['tipos', 'campos', 'roles', 'items', '']);
});
test('client wiring: Más row only for cfgAv (not for other admins), lock screen, sections, search, edit sheets, Historial/Revertir, token on writes, Conceptos redirect, Por configurar link', () => {
  assert.ok(/\$\{adm&&S\.cfgAv\?row\('cfgav','lock','Configuración avanzada'/.test(html), 'Más row');
  assert.ok(!/row\('conceptos','tag','Conceptos'/.test(html), 'Conceptos row moved');
  assert.ok(/S\.cfgAv=!!r\.cfgAv/.test(html) && /S\.cfgAv=!!d\.user\.cfgAv/.test(html), 'flag from login and getData');
  ['Crea el código de configuración', 'Confirma el código', 'data-cfgunlock', 'data-cfgsec=', 'data-cfgq', 'data-cfgedit=', 'data-ce=', 'data-cfgrev=', 'Historial de cambios', 'Revertir', 'Cambiar código', 'Bloquear ahora', 'Reglas generales', 'Conceptos de ajuste', 'Roles → Rol tarifa', 'Custom fields', 'Customer types']
    .forEach(k => assert.ok(html.indexOf(k) >= 0, k));
  ['cfgAvUnlock', 'cfgAvGet', 'cfgAvItemCampos', 'cfgAvChangeCode', 'cfgAvRevertir', 'setConfigAvanzada'].forEach(f => assert.ok(html.indexOf("srv('" + f + "'") >= 0, f));
  assert.ok(/srv\('setConfigAvanzada',S\.cfg\.tok,/.test(html) && /token:S\.cfg\.tok/.test(html), 'token on writes (incl. saveConcepto)');
  assert.ok(/conceptos\(\)\{[\s\S]*?cfgLock\('Conceptos'\)/.test(html) && /backView:'cfgav'/.test(html), 'old Conceptos entry point asks for the code');
  assert.ok(/data-pcadv/.test(html) && /cfgSecOf\(x\.kind\)/.test(html), 'Por configurar rows link into the same edit sheets');
  assert.ok(/data-view="\$\{view\}"/.test(html) && /\/\^\(cfgav\|conceptos\)\$\/\.test\(vw\.dataset\.view\)\)cfgEnter\(\)/.test(html));
  assert.ok(/cfgAv:false,cfg:/.test(html) && /S\.cfgAv=false;S\.cfg=\{/.test(html), 'logout clears the session');
  assert.ok(!/(S\.cfg\.code|localStorage\.setItem\([^)]*cfg)/.test(html), 'the code is never kept');
});

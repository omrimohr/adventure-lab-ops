// Round 17: Eventuales por periodo (eventualesReport_, UI helpers) + pantalla Usuarios (validateUser_, saveUser, listUsers, login) + quién escribe cada registro.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({evPreset,evChip,evLabel,evCount,userCheck,EVP,wkStart,screenName,SCREENS})', {});
const E = loadNew().ex;

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const p2 = n => String(n).padStart(2, '0');
  fe.Utilities = { formatDate: (d, tz, pt) => { const x = new Date(new Date(d).getTime() - 5 * 3600000), P = { yyyy: x.getUTCFullYear(), MM: p2(x.getUTCMonth() + 1), dd: p2(x.getUTCDate()), HH: p2(x.getUTCHours()), mm: p2(x.getUTCMinutes()) }; return pt.replace(/yyyy|MM|dd|HH|mm/g, k => P[k]); },
    DigestAlgorithm: {}, Charset: {}, computeDigest: () => [], base64Decode: s => Buffer.from(s, 'base64'), newBlob: (b, mt, name) => ({ b, mt, name }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : []; };
  return { ss, G, rows };
}
const ev = (fecha, pk, n, rol, tot) => ['2026-11-19', fecha, '09:00', 'Tour', pk, n, '', rol, 'pontón', 3, tot, 1, 0, 0, tot, '', ''];
const pago = (n, m, fecha) => ['2026-11-19', n, m, fecha, 'Omri', '', ''];

// ---------- A. Eventuales por periodo ----------
test('round 17: eventualesReport_ — días, salidas, ganado, pagado por fecha de pago, pendiente, total; bordes inclusivos', () => {
  const evs = [ev('2026-11-01', 'a1', 'Juan', 'Capitán', 450), ev('2026-11-01', 'a2', 'Juan', 'Capitán', 450), ev('2026-11-02', 'a3', 'Juan', 'Capitán', 450),
    ev('2026-11-30', 'a4', 'Luis', 'Marinero', 300), ev('2026-10-31', 'a0', 'Luis', 'Marinero', 300), ev('2026-12-01', 'a5', 'Luis', 'Marinero', 300), ev('2026-11-15', 'a6', 'Ana', 'Guía', 250)];
  const pg = [pago('Juan', 500, '2026-11-02'), pago('Juan', 400, '2026-11-30'), pago('Juan', 999, '2026-12-01'), pago('Pedro', 100, '2026-11-05')];
  const r = J(E.eventualesReport_(evs, pg, '2026-11-01', '2026-11-30'));
  const by = {}; r.rows.forEach(x => { by[x.n] = x; });
  assert.deepStrictEqual(by.Juan, { n: 'Juan', roles: ['Capitán'], dias: 2, salidas: 3, ganado: 1350, pagado: 900, pendiente: 450 });
  assert.strictEqual(by.Luis.salidas, 1, '30 nov in, 31 oct and 1 dic out'); assert.strictEqual(by.Luis.ganado, 300); assert.strictEqual(by.Luis.pendiente, 300);
  assert.deepStrictEqual([by.Pedro.ganado, by.Pedro.pagado, by.Pedro.pendiente], [0, 100, -100], 'payment without earnings is kept');
  assert.deepStrictEqual(r.rows.map(x => x.n), ['Juan', 'Luis', 'Ana', 'Pedro'].sort((a, b) => by[b].ganado - by[a].ganado || a.localeCompare(b)));
  assert.deepStrictEqual(r.totals, { personas: 4, salidas: 5, ganado: 1900, pagado: 1000, pendiente: 900 });
  assert.strictEqual(r.desde, '2026-11-01'); assert.strictEqual(r.hasta, '2026-11-30');
});
test('round 17: eventualesReport_ — one day = same edge twice; reversed dates are swapped; Date values and empty input work', () => {
  const evs = [ev('2026-11-10', 'x', 'Juan', 'Capitán', 450)];
  assert.strictEqual(E.eventualesReport_(evs, [], '2026-11-10', '2026-11-10').rows.length, 1);
  const sw = J(E.eventualesReport_(evs, [], '2026-11-12', '2026-11-01')); assert.strictEqual(sw.desde, '2026-11-01'); assert.strictEqual(sw.rows.length, 1);
  const d = J(E.eventualesReport_([['', new Date(Date.UTC(2026, 10, 10, 12)), '', 'x', 'k', 'Juan', '', 'Guía', '', '', '', '', '', '', 100]], [], '2026-11-10', '2026-11-10')); assert.strictEqual(d.rows[0].ganado, 100);
  assert.deepStrictEqual(J(E.eventualesReport_([], [], '2026-11-01', '2026-11-30').totals), { personas: 0, salidas: 0, ganado: 0, pagado: 0, pendiente: 0 });
});
test('round 17: eventualesReport API — admin or perm "pagar"; reads Eventuales + Pagos tabs (history beyond getData window)', () => {
  const e = env(), G = e.G.ex;
  assert.throws(() => G.eventualesReport('0000', '', ''), /Elige las fechas/);
  G.eventualesReport('0000', '2026-01-01', '2026-01-02'); // creates the (empty) tabs
  e.ss.getSheetByName('Eventuales')._d.rows.push(ev('2026-06-10', 'old', 'Juan', 'Capitán', 450), ev('2026-11-20', 'new', 'Juan', 'Capitán', 450));
  e.ss.getSheetByName('Pagos')._d.rows.push(pago('Juan', 450, '2026-06-18'));
  const r = J(G.eventualesReport('0000', '2026-06-01', '2026-06-30')); assert.ok(r.ok); assert.deepStrictEqual(r.rows.map(x => [x.n, x.ganado, x.pagado, x.pendiente]), [['Juan', 450, 450, 0]]);
  assert.strictEqual(J(G.eventualesReport('0000', '2026-06-10')).totals.salidas, 1, 'hasta defaults to desde');
  G.saveUser('0000', { nombre: 'Jesús', pinNuevo: '3333', rol: 'op' });
  assert.throws(() => G.eventualesReport('3333', '2026-06-01', '2026-06-30'), /no puede ver este reporte/, 'op without pagar');
  const sh = e.ss.getSheetByName('Permisos'); sh._d.rows.forEach(x => { if (x[0] === 'pagar') x[3] = 'sí'; });
  assert.ok(G.eventualesReport('3333', '2026-06-01', '2026-06-30').ok, 'op with pagar');
  assert.throws(() => G.eventualesReport('9999', '2026-06-01', '2026-06-30'), /PIN incorrecto/);
});
test('round 17: client pay-period helpers — week chips follow semana_pago, month chips are ranges, label, counts', () => {
  const today = '2026-11-26'; // jueves
  assert.deepStrictEqual(J(U.evPreset('sem', today, 'jueves')), ['2026-11-26', '2026-12-02']);
  assert.deepStrictEqual(J(U.evPreset('sempas', today, 'jueves')), ['2026-11-19', '2026-11-25']);
  assert.deepStrictEqual(J(U.evPreset('sem', today, 'lunes')), ['2026-11-23', '2026-11-29']);
  assert.deepStrictEqual(J(U.evPreset('mes', today, 'jueves')), ['2026-11-01', '2026-11-30']);
  assert.deepStrictEqual(J(U.evPreset('mespas', '2026-01-15', 'jueves')), ['2025-12-01', '2025-12-31']);
  assert.strictEqual(U.evChip(null, '2026-11-26', today, 'jueves'), 'sem'); assert.strictEqual(U.evChip(null, '2026-11-19', today, 'jueves'), 'sempas'); assert.strictEqual(U.evChip(null, '2026-11-12', today, 'jueves'), '');
  assert.strictEqual(U.evChip({ desde: '2026-11-01', hasta: '2026-11-30' }, '2026-11-26', today, 'jueves'), 'mes');
  assert.strictEqual(U.evChip({ desde: '2026-10-01', hasta: '2026-10-31' }, '2026-11-26', today, 'jueves'), 'mespas');
  assert.strictEqual(U.evChip({ desde: '2026-11-03', hasta: '2026-11-09' }, '2026-11-26', today, 'jueves'), '', 'custom range: no chip pressed');
  assert.strictEqual(U.evLabel('2026-11-03', '2026-11-03'), 'mar. 3/nov 2026'); assert.ok(/ – /.test(U.evLabel('2026-11-03', '2026-11-09')));
  assert.strictEqual(U.evCount(1, 1), '1 día · 1 salida'); assert.strictEqual(U.evCount(4, 6), '4 días · 6 salidas');
});
test('round 17: UI wiring — week view stays the default; Pagar only in week mode; calendar sheet shared; server call', () => {
  const evFn = /\nev\(\)\{[\s\S]*?\n\},\nevrange/.exec(html)[0];
  assert.ok(/if\(S\.evp\)return V\.evrange\(\)/.test(evFn), 'range mode only when a period is picked');
  assert.ok(evFn.indexOf('evHead()') > 0 && evFn.indexOf('data-person') > 0 && /data-wk="-1"/.test(html), 'week view still lists people (header moved to evHead in round 18)');
  const rng = /\nevrange\(\)\{[\s\S]*?\n\},\nperson/.exec(html)[0];
  assert.ok(rng.indexOf('data-pay') < 0 && rng.indexOf('data-person') < 0, 'no pay buttons in a period view');
  assert.ok(/openSrCal\('ev'\)/.test(html) && /srv\('eventualesReport'/.test(html) && /srPick\(sc/.test(html));
  assert.ok(/S\.sr=null;/.test(html), 'stock report state untouched');
});

// ---------- B. Usuarios ----------
const rowsU = () => [['Omri', '0000', 'admin', 'sí'], ['Carlos', 1111, 'admin', 'sí'], ['Jesús', '3333', 'op', 'sí'], ['Viejo', '4444', 'op', 'no']];
const me = { nombre: 'Omri', rol: 'admin' };
const V = (i, rows, a) => E.validateUser_(i, rows || rowsU(), a || me);
test('round 17: validateUser_ — name required and unique (case-insensitive); PIN exactly 4 digits and unique among active; rol admin|op', () => {
  assert.throws(() => V({ nombre: '  ', pinNuevo: '5555', rol: 'op' }), /Escribe el nombre/);
  assert.throws(() => V({ nombre: 'jesús', pinNuevo: '5555', rol: 'op' }), /Ya existe un usuario con ese nombre/);
  assert.throws(() => V({ nombre: 'Daniel', pinNuevo: '555', rol: 'op' }), /4 dígitos/); assert.throws(() => V({ nombre: 'Daniel', pinNuevo: '55a5', rol: 'op' }), /4 dígitos/);
  assert.throws(() => V({ nombre: 'Daniel', rol: 'op' }), /4 dígitos/, 'new user needs a PIN');
  assert.throws(() => V({ nombre: 'Daniel', pinNuevo: '3333', rol: 'op' }), /PIN ya lo usa/);
  assert.throws(() => V({ nombre: 'Daniel', pinNuevo: '1111', rol: 'op' }), /PIN ya lo usa/, 'numeric PIN cell from Sheets compares as string');
  assert.throws(() => V({ nombre: 'Daniel', pinNuevo: '5555', rol: 'jefe' }), /Rol inválido/);
  assert.strictEqual(J(V({ nombre: 'Daniel', pinNuevo: '4444', rol: 'op' })).create, true, 'PIN of an INACTIVE user can be reused');
  const ok = J(V({ nombre: ' Daniel  Ruiz ', pinNuevo: '5555', rol: 'Admin' })); assert.deepStrictEqual([ok.nombre, ok.rol, ok.activo, ok.pin, ok.create], ['Daniel Ruiz', 'admin', true, '5555', true]);
});
test('round 17: validateUser_ — edit: no rename, optional PIN, self-protection, at least one active admin, reactivation checks PIN', () => {
  assert.throws(() => V({ nombre: 'Otro', original: 'Jesús', rol: 'op', activo: true }), /No se puede cambiar el nombre/);
  assert.throws(() => V({ nombre: 'Nadie', original: 'Nadie', rol: 'op' }), /No encontré al usuario/);
  const keep = J(V({ nombre: 'jesús', original: 'Jesús', rol: 'admin', activo: true })); assert.strictEqual(keep.create, false); assert.strictEqual(keep.pin, ''); assert.strictEqual(keep.pinChanged, false); assert.strictEqual(keep.nombre, 'Jesús');
  assert.strictEqual(J(V({ nombre: 'Jesús', original: 'Jesús', rol: 'op', activo: true, pinNuevo: '7777' })).pinChanged, true);
  assert.throws(() => V({ nombre: 'Jesús', original: 'Jesús', rol: 'op', activo: true, pinNuevo: '0000' }), /PIN ya lo usa/);
  assert.throws(() => V({ nombre: 'Omri', original: 'Omri', rol: 'admin', activo: false }), /No puedes desactivarte a ti mismo/);
  assert.throws(() => V({ nombre: 'Omri', original: 'Omri', rol: 'op', activo: true }), /No puedes quitarte el rol de admin/);
  assert.ok(V({ nombre: 'Carlos', original: 'Carlos', rol: 'op', activo: false }), 'another admin may be demoted while Omri remains');
  const only = [['Omri', '0000', 'admin', 'sí'], ['Jesús', '3333', 'op', 'sí']];
  assert.throws(() => V({ nombre: 'Omri', original: 'Omri', rol: 'admin', activo: false }, only), /desactivarte/);
  assert.throws(() => V({ nombre: 'Omri', original: 'Omri', rol: 'op', activo: true }, only, { nombre: 'Jesús', rol: 'admin' }), /al menos un admin activo/, 'cannot leave zero active admins');
  assert.throws(() => V({ nombre: 'Viejo', original: 'Viejo', rol: 'op', activo: true }, [['Omri', '0000', 'admin', 'sí'], ['Viejo', '0000', 'op', 'no']]), /PIN ya lo usa/, 'reactivating with a PIN now taken');
});
test('round 17: validateUser_ — identical "add" again is an idempotent no-op (retry never double-adds)', () => {
  const rows = rowsU(); rows.push(['Daniel', '5555', 'op', 'sí']);
  const v = J(V({ nombre: 'daniel', pinNuevo: '5555', rol: 'op' }, rows)); assert.strictEqual(v.dup, true);
  assert.throws(() => V({ nombre: 'Daniel', pinNuevo: '6666', rol: 'op' }, rows), /Ya existe/);
});
test('round 17: usersFromRows_ never exposes the PIN; blank rows skipped; Activo parsed', () => {
  const l = J(E.usersFromRows_(rowsU().concat([['', '', '', '']])));
  assert.deepStrictEqual(l, [{ nombre: 'Omri', rol: 'admin', activo: true }, { nombre: 'Carlos', rol: 'admin', activo: true }, { nombre: 'Jesús', rol: 'op', activo: true }, { nombre: 'Viejo', rol: 'op', activo: false }]);
  assert.ok(JSON.stringify(l).indexOf('0000') < 0);
});
test('round 17: saveUser / listUsers — admin role only, writes the tab, PIN stays text, retry is a no-op, response has no PINs', () => {
  const e = env(), G = e.G.ex;
  assert.deepStrictEqual(J(G.listUsers('0000').users), [{ nombre: 'Omri', rol: 'admin', activo: true }]);
  const a = J(G.saveUser('0000', { nombre: 'Daniel', pinNuevo: '0123', rol: 'op' })); assert.ok(a.ok && !a.dup); assert.strictEqual(a.users.length, 2); assert.ok(JSON.stringify(a).indexOf('0123') < 0);
  assert.deepStrictEqual(J(e.rows('Usuarios')[1]), ['Daniel', '0123', 'op', 'sí']);
  const b = J(G.saveUser('0000', { nombre: 'Daniel', pinNuevo: '0123', rol: 'op' })); assert.ok(b.dup); assert.strictEqual(e.rows('Usuarios').length, 2, 'no double add');
  assert.throws(() => G.saveUser('0000', { nombre: 'daniel', pinNuevo: '9999', rol: 'op' }), /Ya existe/);
  assert.throws(() => G.listUsers('0123'), /Solo el admin/); assert.throws(() => G.saveUser('0123', { nombre: 'X', pinNuevo: '1212', rol: 'op' }), /Solo el admin/);
  G.saveUser('0000', { nombre: 'Carlos', pinNuevo: '1111', rol: 'admin' });
  G.saveUser('0000', { nombre: 'Daniel', original: 'Daniel', rol: 'admin', activo: true, pinNuevo: '2222' });
  assert.deepStrictEqual(J(e.rows('Usuarios')[1]), ['Daniel', '2222', 'admin', 'sí']);
  G.saveUser('0000', { nombre: 'Daniel', original: 'Daniel', rol: 'op', activo: false });
  assert.deepStrictEqual(J(e.rows('Usuarios')[1]), ['Daniel', '2222', 'op', 'no'], 'PIN kept when not changed');
  assert.throws(() => G.saveUser('0000', { nombre: 'Omri', original: 'Omri', rol: 'admin', activo: false }), /desactivarte/);
});
test('round 17: login ignores inactive users; a new user can log in; a changed PIN replaces the old', () => {
  const e = env(), G = e.G.ex;
  G.saveUser('0000', { nombre: 'Jesús', pinNuevo: '3333', rol: 'op' });
  assert.deepStrictEqual([J(G.login('3333')).ok, J(G.login('3333')).nombre, J(G.login('3333')).rol], [true, 'Jesús', 'op']);
  G.saveUser('0000', { nombre: 'Jesús', original: 'Jesús', rol: 'op', activo: false });
  assert.strictEqual(J(G.login('3333')).ok, false, 'inactive');
  G.saveUser('0000', { nombre: 'Jesús', original: 'Jesús', rol: 'op', activo: true, pinNuevo: '4321' });
  assert.strictEqual(J(G.login('3333')).ok, false); assert.strictEqual(J(G.login('4321')).nombre, 'Jesús');
  assert.throws(() => G.getData('3333', '', ''), /PIN incorrecto/);
});
test('round 17: UI — userCheck rules; Más › Usuarios admin only; PINs never rendered; one filled button per screen', () => {
  const us = [{ nombre: 'Omri' }, { nombre: 'Jesús' }];
  assert.strictEqual(U.userCheck({ nombre: '', pin: '1234' }, us, '').f, 'nombre');
  assert.strictEqual(U.userCheck({ nombre: ' jesús ', pin: '1234' }, us, '').m, 'Ya existe un usuario con ese nombre');
  assert.strictEqual(U.userCheck({ nombre: 'Ana', pin: '12' }, us, '').f, 'pin');
  assert.strictEqual(U.userCheck({ nombre: 'Ana', pin: '1234' }, us, ''), null);
  assert.strictEqual(U.userCheck({ nombre: 'Jesús', pin: '' }, us, 'Jesús'), null, 'editing: PIN optional');
  assert.strictEqual(U.userCheck({ nombre: 'Jesús', pin: '12' }, us, 'Jesús').f, 'pin');
  assert.strictEqual(U.screenName('mas', 'usuarios', {}), 'Usuarios');
  assert.ok(/\$\{adm\?row\('usuarios','users','Usuarios'/.test(html), 'Más row only for admin');
  const usr = /\nusuarios\(\)\{[\s\S]*?\n\},\npend/.exec(html)[0];
  assert.ok(usr.indexOf('PIN ••••') > 0 && usr.indexOf('.pin') < 0 && usr.indexOf('u.pin') < 0 && usr.indexOf('class="btn') < 0);
  assert.ok(/srv\('listUsers'\)/.test(html) && /srv\('saveUser',p\)/.test(html));
  const sheetSrc = /function userSheet\(u\)\{[\s\S]*?\nasync function saveUserSheet/.exec(html)[0];
  assert.ok(sheetSrc.indexOf('class="btn') < 0, 'the sheet uses the bar OK button, no extra filled .btn');
});

// ---------- C. Todo registro lleva el nombre de quien entró ----------
test('round 17: every write records the logged-in user (not a default): Pagos, Revisiones, Comida, Ajustes, Compras, Feedback, Config', () => {
  const e = env(), G = e.G.ex;
  G.saveUser('0000', { nombre: 'Carlos', pinNuevo: '1111', rol: 'admin' });
  G.markPaid('1111', '2026-11-19', 'Juan', 450, 'c1'); assert.strictEqual(e.rows('Pagos')[0][4], 'Carlos');
  G.addComida('1111', { nombre: 'Luis', tipo: 'desayuno', cantidad: 1, cid: 'c2' }); assert.strictEqual(e.rows('Comida empleado')[0][5], 'Carlos');
  G.addFeedback('1111', { texto: 'hola', cid: 'c3' }); assert.strictEqual(e.rows('Feedback')[0][2], 'Carlos');
  G.setConfig('1111', 'semana_pago', 'lunes'); assert.strictEqual(e.rows('Config').find(r => r[0] === 'semana_pago')[3], 'Carlos');
  G.addAjuste('1111', { i: 'cer', q: -1, motivo: 'Merma', nota: '', cid: 'c4' });
  const aj = e.rows('Ajustes')[0]; assert.ok(aj && aj.indexOf('Carlos') >= 0 && aj.indexOf('Omri') < 0);
  G.addCompra('1111', { d: '2026-11-20', sup: 'X', lines: [{ i: 'cer', q: 1, p: 10 }], cid: 'c5' }); assert.ok(e.rows('Compras')[0].indexOf('Carlos') >= 0);
});
test('round 17: no write path hardcodes a user name; only the first-run seed row names Omri', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'app.gs'), 'utf8').split('\n');
  const hits = src.map((l, i) => [i + 1, l]).filter(([, l]) => /'Omri'|"Omri"|'Sistema'|'admin'\)?\s*\]\s*;?\s*\/\/ por/.test(l) && !/^\s*\/\//.test(l));
  assert.strictEqual(hits.length, 1); assert.ok(/seed/.test(hits[0][1]));
  const gs = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  assert.ok(!/appendRow\([^)]*'Omri'/.test(gs));
  const c = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
  assert.ok(!/por:'Omri'|by:'Omri'|usuario:'Omri'/.test(c.replace(/\/\/[^\n]*/g, '')), 'client optimistic rows use S.user');
});
test('round 17: APP_VER matches the service-worker CACHE', () => {
  const v = /const APP_VER='(v\d+)'/.exec(html)[1];
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8').indexOf("const CACHE = 'al-ops-" + v + "'") >= 0);
});

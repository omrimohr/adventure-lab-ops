// Round 14: notification bell (notifBuild), no false "Sin recurso" for short-form imports, saludAlerts_ fecha/av, resKnown.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, test } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({notifBuild,noRes,depAlerts,depAlertN})', {});
const E = loadNew().ex;

const salud = [
  { tipo: 'bitacora', texto: 'Falta bitácora: 2026-11-24 14:00 Private Boat Tour', rol: 'todos', fecha: '2026-11-24', av: '9001' },
  { tipo: 'bitacora', texto: 'Faltan 3 bitácoras más', rol: 'todos' },
  { tipo: 'reporte', texto: 'Falta reporte de Comercial del 2026-11-23', rol: 'admin' },
  { tipo: 'webhook', texto: 'Sin eventos de FareHarbor hace 5 h', rol: 'admin' },
  { tipo: 'config', texto: '2 cosas por configurar desde hace más de 2 días', rol: 'admin' }];

test('round 14: notifBuild → [{id,kind,text,go}], admin gets pend first, dates fixed, navigation targets', () => {
  const l = U.notifBuild(salud, [{}, {}], 'admin');
  assert.strictEqual(l.length, 5, 'config alert folded into the pend notification');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l[0])), { id: 'pend', kind: 'pend', text: '2 elementos por configurar', go: { t: 'pend' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l[1].go)), { t: 'dep', date: '2026-11-24', av: '9001' });
  assert.ok(/mar\. 24\/nov 2026/.test(l[1].text), 'fixDates applied');
  assert.strictEqual(l[2].go, null, '"Faltan N bitácoras más" has no departure');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l[3].go)), { t: 'fh' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l[4].go)), { t: 'fh' });
  assert.strictEqual(U.notifBuild(salud, [{}], 'admin')[0].text, '1 elemento por configurar');
  const ids = l.map(x => x.id); assert.strictEqual(new Set(ids).size, ids.length);
});
test('round 14: notifBuild for op: only "todos" alerts, never pend; empty → []; config alert without pend goes to Por configurar', () => {
  const l = U.notifBuild(salud, [{}, {}], 'op');
  assert.deepStrictEqual(Array.from(l.map(x => x.kind)), ['bitacora', 'bitacora']);
  assert.strictEqual(U.notifBuild([], [], 'admin').length, 0);
  const c = U.notifBuild([salud[4]], [], 'admin');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c[0].go)), { t: 'pend' });
});
test('round 14: client noRes needs resKnown !== false', () => {
  const d = (x) => Object.assign({ bookings: [{}], res: [] }, x);
  assert.strictEqual(U.noRes(d({})), true);
  assert.strictEqual(U.noRes(d({ resKnown: true })), true);
  assert.strictEqual(U.noRes(d({ resKnown: false })), false);
  assert.strictEqual(U.depAlertN(d({ resKnown: false, crew: [] })), 0);
});
test('round 14: saludAlerts_ bitácora alerts carry fecha + av', () => {
  const out = E.saludAlerts_({ nowMs: Date.UTC(2026, 10, 25, 18), today: '2026-11-25', hhmm: '12:00', dow: 3, lastRawMs: null,
    salidas: [{ av: '9001', fecha: '2026-11-24', hora: '14:00', item: 'Private Boat Tour', activas: 2, bitacora: 'Falta regreso', tipo: 'privado', hasOps: true }], control: [], pendMs: [], erroresHoy: 0 });
  const b = out.find(a => a.tipo === 'bitacora');
  assert.strictEqual(b.fecha, '2026-11-24'); assert.strictEqual(b.av, '9001');
});
test('round 14: computeSalida_ "Sin recurso asignado" only when a customer booking has resource_uses; Recursos conocidos column', () => {
  const { J, loadNew } = require('./lib'), F = require('./fixtures'), N = loadNew(), E2 = N.ex;
  const tours = J(E2.toursFromRows_(N.get('TOURS_SEED')));
  const mk = pk => J(F.booking({ pk: pk, av: 9300, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: '2026-11-25T14:00:00Z', end: '2026-11-25T17:00:00Z',
    paid: 100000, customers: [F.cust(100, 'Adult')] })).booking;
  const run = bs => J(E2.computeSalida_('9300', bs.map((b, i) => ({ b: b, row: i + 2 })), tours, new Date('2026-11-24T12:00:00Z'), {}, null)).salida;
  const H = E2.SAL_HEADERS, iA = H.indexOf('Alertas'), iK = H.indexOf('Recursos conocidos');
  assert.strictEqual(iK, H.length - 1);
  const a = mk(1); a.resource_uses = [];
  let r = run([a]); assert.ok(/Sin recurso asignado/.test(r[iA])); assert.strictEqual(r[iK], 'sí'); assert.strictEqual(r.length, H.length);
  const b = mk(2); delete b.resource_uses; b._source = 'import';
  r = run([b]); assert.ok(!/Sin recurso/.test(r[iA]), 'short-form import: no false alert'); assert.strictEqual(r[iK], 'no');
  const c = mk(3); delete c.resource_uses;
  r = run([c, a]); assert.ok(/Sin recurso asignado/.test(r[iA]), 'one booking carries the key → known');
});
test('round 14: UI wiring — bell in top bar, no role switcher / health box, filters scroll to the list, sw CACHE bumped', () => {
  assert.ok(!/function saludBox|data-rolesw|Viendo como/.test(html));
  assert.ok(/function roleBar\(\)[^\n]*data-bell/.test(html) && /bell:'<path/.test(html));
  assert.ok(/Sin notificaciones/.test(html) && /'Notificaciones'/.test(html));
  assert.ok(/data-filter\]'\);if\(fl\)\{[^\n]*render\(\);goList\(\)/.test(html), 'summary taps and chips smooth-scroll to the departures list');
  assert.ok(/const goList=/.test(html) && /function flashDep/.test(html));
  assert.ok(/CACHE = 'al-ops-v11'/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8')));
});

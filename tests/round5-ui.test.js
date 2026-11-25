// Round 5 UI pure helpers (bitácora warning, Costos adicionales, externos) + PWA files.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { test } = require('./lib');
const docs = path.join(__dirname, '..', 'docs');
const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({bitAlert,depAlerts,depAlertN,DEP_FILTERS,depFilter,caHas,extAlerts})', {});

const dep = o => Object.assign({ date: '2026-11-24', time: '09:00', end: '2026-11-24 12:00', bit: 'Sin bitácora', bookings: [{ pax: 2 }], res: [{ name: 'B' }], crew: [], alerts: '', tipo: 'compartido' }, o);
const K = (hm) => '2026-11-24 ' + hm;

test('bitácora warning: Ida overdue after the start, Regreso overdue after the end (same rule as the red dots)', () => {
  assert.strictEqual(U.bitAlert(dep(), K('08:00')), '', 'future departure: nothing');
  assert.strictEqual(U.bitAlert(dep(), K('09:00')), 'Falta bitácora de ida', 'at the start Ida is due, Regreso is not');
  assert.strictEqual(U.bitAlert(dep(), K('12:00')), 'Falta bitácora de ida', 'Regreso is due only AFTER the end');
  assert.strictEqual(U.bitAlert(dep(), K('12:01')), 'Falta bitácora de ida y regreso');
  assert.strictEqual(U.bitAlert(dep({ bit: 'Falta regreso' }), K('10:00')), '', 'Ida done, Regreso not yet due');
  assert.strictEqual(U.bitAlert(dep({ bit: 'Falta regreso' }), K('12:30')), 'Falta bitácora de regreso');
  assert.strictEqual(U.bitAlert(dep({ bit: 'Falta salida' }), K('10:00')), 'Falta bitácora de ida');
  assert.strictEqual(U.bitAlert(dep({ bit: 'Completa' }), K('23:00')), '');
  assert.strictEqual(U.bitAlert(dep({ bit: 'No aplica' }), K('23:00')), '', 'rentals / day passes');
  assert.strictEqual(U.bitAlert(dep({ bookings: [] }), K('23:00')), '', 'no active bookings → nothing required');
  assert.strictEqual(U.bitAlert(dep(), ''), '', 'no clock → not evaluated');
  assert.strictEqual(U.bitAlert(dep({ date: '2026-11-25', end: '2026-11-25 12:00' }), K('23:00')), '', 'tomorrow');
  assert.strictEqual(U.bitAlert(dep({ date: '2026-11-23', end: '2026-11-23 12:00' }), K('00:10')), 'Falta bitácora de ida y regreso', 'yesterday');
});
test('bitácora warning counts in the ⚠️ number, the detail alerts and the "Con advertencias" filter', () => {
  const d = dep({ alerts: 'Más de una reserva de salida', crew: [{ r: 'Capitan' }, { r: '', n: 'X' }] });
  assert.deepStrictEqual(Array.from(U.depAlerts(d, K('13:00'))), ['Más de una reserva de salida', 'Falta bitácora de ida y regreso']);
  assert.strictEqual(U.depAlertN(d, K('13:00')), 3, '2 alerts + crew without role');
  assert.strictEqual(U.depAlertN(d, K('08:00')), 2, 'not due yet');
  assert.strictEqual(U.depAlertN(d), 2, 'old call signature unchanged');
  const f = U.depFilter('avisos');
  assert.strictEqual(f.test(dep(), { today: '2026-11-24', nowKey: K('13:00') }), true);
  assert.strictEqual(f.test(dep(), { today: '2026-11-24', nowKey: K('08:00') }), false);
  assert.strictEqual(f.test(dep({ bit: 'Completa' }), { today: '2026-11-24', nowKey: K('13:00') }), false);
  assert.strictEqual(f.test(dep({ bit: 'No aplica', tipo: 'renta' }), { today: '2026-11-24', nowKey: K('13:00') }), false);
});
test('costos adicionales / externos helpers', () => {
  assert.strictEqual(U.caHas(null), false);
  assert.strictEqual(U.caHas({ ca: { items: [], rest: [], total: 0 } }), false);
  assert.strictEqual(U.caHas({ ca: { items: [{ label: 'x', amount: 1 }], rest: [] } }), true);
  assert.strictEqual(U.caHas({ ca: { items: [], rest: ['solo texto'] } }), true, 'raw text with no amount is still shown');
  assert.deepStrictEqual(Array.from(U.extAlerts({ alert: 'Falta nota: ¿a quién se debe? | Falta monto en Costos adicionales' })), ['Falta monto en Costos adicionales']);
  assert.deepStrictEqual(Array.from(U.extAlerts({ alert: '' })), []);
});

test('PWA: manifest, icons, service worker, head links', () => {
  const mf = JSON.parse(fs.readFileSync(path.join(docs, 'manifest.webmanifest'), 'utf8'));
  assert.deepStrictEqual([mf.name, mf.short_name, mf.start_url, mf.scope, mf.display, mf.lang], ['Adventure Lab Ops', 'AL Ops', './', './', 'standalone', 'es']);
  assert.ok(mf.background_color && mf.theme_color);
  const dim = f => { const b = fs.readFileSync(path.join(docs, f)); assert.strictEqual(b.slice(1, 4).toString(), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepStrictEqual(dim('icon-192.png'), [192, 192]); assert.deepStrictEqual(dim('icon-512.png'), [512, 512]);
  assert.deepStrictEqual(dim('icon-512-maskable.png'), [512, 512]); assert.deepStrictEqual(dim('apple-touch-icon.png'), [180, 180]);
  mf.icons.forEach(i => assert.ok(fs.existsSync(path.join(docs, i.src)), i.src));
  assert.ok(mf.icons.some(i => i.purpose === 'maskable'));
  const sw = fs.readFileSync(path.join(docs, 'sw.js'), 'utf8');
  assert.ok(/const CACHE = 'al-ops-v\d+'/.test(sw), 'CACHE constant');
  assert.ok(/skipWaiting/.test(sw) && /clients\.claim/.test(sw) && /caches\.delete/.test(sw));
  assert.ok(/u\.origin !== self\.location\.origin\) return/.test(sw) && /r\.method !== 'GET'/.test(sw), 'API (other origin / POST) is never intercepted');
  assert.ok(!/script\.google\.com/.test(sw));
  ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png'].forEach(f => assert.ok(sw.indexOf("'./" + f + "'") >= 0, f + ' in the shell'));
  assert.ok(/rel="manifest" href="manifest.webmanifest"/.test(html) && /rel="apple-touch-icon" href="apple-touch-icon.png"/.test(html));
  assert.ok(/apple-mobile-web-app-capable/.test(html) && /apple-mobile-web-app-status-bar-style/.test(html) && /viewport-fit=cover/.test(html));
  assert.ok(/serviceWorker.*register\('sw.js'\)/s.test(html) && /controllerchange/.test(html));
});

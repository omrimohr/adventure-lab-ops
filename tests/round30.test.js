// Round 30: day passes are just a sale (no resource / crew alerts, no cancellation decision, sections hidden);
// Eventuales › person line opens the departure detail, ‹ returns to the person.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test } = require('./lib');
const F = require('./fixtures');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'docs/sw.js'), 'utf8');
const E = loadNew().ex;

test('APP_VER = CACHE = v26+, BITACORA_RULE_V >= 11', () => {
  const v = /const APP_VER='(v\d+)'/.exec(html)[1];
  assert.ok(sw.indexOf("const CACHE = 'al-ops-" + v + "'") >= 0 && Number(v.slice(1)) >= 26);
  assert.ok(Number(E.BITACORA_RULE_V) >= 11 && E.bitacoraRuleStale_('10'));
});

// ---- server: computeSalida_ ----
const mk = (crew) => F.booking({ pk: 7, av: 9500, item: 723914, itemName: 'Yak day pass', start: '2026-11-20T14:00:00Z', end: '2026-11-20T17:00:00Z',
  customers: [F.cust(1, 'Adult', [])], crew: crew || [{ user: { name: 'Pedro Staff', username: 'pedro' }, note: '' }] }).booking;
const run = (barco, resUses) => {
  const b = mk(); b.resource_uses = resUses;
  return J(E.computeSalida_('9500', [{ b: b, row: 2 }], { '723914': { tipo: 'compartido', barco: barco, fields: [], bitacora: false } }, new Date('2026-11-21T12:00:00Z'), {}, null)).salida[E.SAL_HEADERS.indexOf('Alertas')];
};
test('day pass (barco otro): no "Sin recurso asignado", no "Falta rol"; other boats still alert', () => {
  assert.ok(!/Sin recurso|Falta rol/.test(run('otro', [])));
  assert.ok(/Sin recurso asignado/.test(run('sup', [])));
  assert.ok(/Falta rol: Pedro Staff/.test(run('sup', [])));
});

// ---- client pure helpers ----
const pm = html.match(/\/\/ ==PURE-BEGIN==[\s\S]*?\/\/ ==PURE-END==/)[0];
const U = vm.runInNewContext(pm + '\n({noRes,depAlerts,depAlertN,cancPend,isPase,depBack,backTarget})', { document: {}, window: {} });
const dep = (o) => Object.assign({ barco: 'otro', bookings: [{ pax: 2 }], res: [], resKnown: true, crew: [{ n: 'X', r: '', alert: 'Sin tarifa' }], alerts: 'Sin recurso asignado | Falta rol: X | No show: 1' }, o);
test('client: day pass has no noRes, no crew/role alerts, no cancellation decision', () => {
  assert.strictEqual(U.noRes(dep()), false);
  assert.strictEqual(U.noRes(dep({ barco: 'sup' })), true);
  assert.deepStrictEqual(J(U.depAlerts(dep(), '2026-11-20 20:00')), ['No show: 1']);
  assert.strictEqual(U.depAlertN(dep(), '2026-11-20 20:00'), 1);
  assert.ok(U.depAlertN(dep({ barco: 'sup' }), '2026-11-20 20:00') > 1);
  const c = dep({ cn: { all: true, need: true }, aj: [] });
  assert.strictEqual(U.cancPend(c), false);
  assert.strictEqual(!!U.cancPend(Object.assign({}, c, { barco: 'sup' })), true);
});
test('depBack: Eventuales person → person view with id; stock; default Operación', () => {
  assert.deepStrictEqual(J(U.depBack('ev|Luis M')), { back: 'Luis M', backTo: 'ev', backView: 'person', backArg: 'Luis M' });
  assert.deepStrictEqual(J(U.backTarget({ back: 'ev', backview: 'person', backarg: 'Luis M' })), { tab: 'ev', sv: { name: 'person', arg: 'Luis M' } });
  assert.deepStrictEqual(J(U.depBack('stock')), { back: 'Stock', backTo: 'stock' });
  assert.deepStrictEqual(J(U.depBack('')), { back: 'Operación', backTo: 'op' });
});
test('wiring: detail hides Resources/Bitácora/Tripulación for day passes, keeps Costos "+ Agregar"; evdep opens the detail', () => {
  assert.ok(/if\(!isCanc\(d\)&&!pase\)h\+=`<div class="group">\$\{gh\('resources'/.test(html));
  assert.ok(/if\(!pase\)h\+=bitSection\(d,fut\)/.test(html));
  assert.ok(/if\(!pase\)h\+=`<div class="group">\$\{gh\('crew'/.test(html));
  assert.ok(/data-ajnew="\$\{esc\(d\.id\)\}\|costo\|"/.test(html));
  assert.ok(/S\.depFrom='ev\|'\+\(stackView&&stackView\.arg\|\|''\);stackView=\{name:'dep',arg:a\[1\]\}/.test(html));
  assert.ok(/backView:bk\.backView,backArg:bk\.backArg/.test(html));
});

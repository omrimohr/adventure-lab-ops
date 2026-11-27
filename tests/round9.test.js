// Round 9: Apariencia (theme), semana_pago (pay week setting), spacing, compact rows for rentals / day passes.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({wkStart,weekStartOf,PAYD,payDayName})', {});
const N = loadNew(), E = N.ex;

// ---------- semana_pago: server ----------
test('validateConfig_: semana_pago accepts lunes…domingo (case/accents ignored, stored without accents); default jueves; semana_inicio unchanged', () => {
  assert.deepStrictEqual(J(E.validateConfig_('semana_pago', 'Miércoles')), { key: 'semana_pago', value: 'miercoles' });
  assert.deepStrictEqual(J(E.validateConfig_('semana_pago', ' SÁBADO ')), { key: 'semana_pago', value: 'sabado' });
  ['lunes', 'martes', 'jueves', 'viernes', 'domingo'].forEach(d => assert.strictEqual(E.validateConfig_('semana_pago', d).value, d));
  assert.throws(() => E.validateConfig_('semana_pago', 'hoy'), /inválido/);
  assert.throws(() => E.validateConfig_('semana_pago', ''), /inválido/);
  assert.deepStrictEqual(J(E.configFromRows_([])), { semana_inicio: 'jueves', semana_pago: 'jueves' });
  assert.strictEqual(E.configFromRows_([['semana_pago', 'lunes']]).semana_pago, 'lunes');
  assert.strictEqual(E.configFromRows_([['semana_pago', 'xx']]).semana_pago, 'jueves');
  assert.throws(() => E.validateConfig_('semana_inicio', 'martes'), /inválido/);
});
test('weekStart_: default Thursday (unchanged); any start day; payDow_ from config', () => {
  // 2026-11-25 is a Wednesday
  assert.strictEqual(E.weekStart_('2026-11-25'), '2026-11-19');
  assert.strictEqual(E.weekStart_('2026-11-25', 4), '2026-11-19');
  assert.strictEqual(E.weekStart_('2026-11-25', 1), '2026-11-23');
  assert.strictEqual(E.weekStart_('2026-11-22', 1), '2026-11-16', 'Sunday belongs to the Monday week');
  assert.strictEqual(E.weekStart_('2026-11-22', 0), '2026-11-22');
  assert.strictEqual(E.weekStart_('2026-11-25', 3), '2026-11-25');
  assert.deepStrictEqual(['jueves', 'lunes', 'domingo', 'sabado', undefined].map(d => E.payDow_({ semana_pago: d })), [4, 1, 0, 6, 4]);
});
const sal = ['9100', 258806, 'Bacalar Lagoon Boat Tour', 'compartido', '2026-11-25', '09:00', '2026-11-25T14:00:00Z', '2026-11-25T17:00:00Z', 1];
const staff = ['9100', '', '', '', 'Marinero', 'Luis M', 'luis', 'Barco: El Cormoran', ''];
test('payForSalida_: Eventuales week start follows the pay day (default Thursday)', () => {
  const TAR = N.get('TAR_SEED'), NOW = new Date('2026-12-01T00:00:00Z');
  assert.strictEqual(J(E.payForSalida_(sal, [staff], [], TAR, 'ponton', null, NOW)).pay[0][0], '2026-11-19');
  assert.strictEqual(J(E.payForSalida_(sal, [staff], [], TAR, 'ponton', null, NOW, 1)).pay[0][0], '2026-11-23');
  assert.strictEqual(J(E.payForSalida_(sal, [staff], [], TAR, 'ponton', null, NOW, 3)).pay[0][0], '2026-11-25');
});
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const L = loadNew(fe);
  return { ss, fe, G: L.ex, ctx: L.ctx, rows: n => ss.getSheetByName(n)._d.rows.slice(1).filter(r => r.some(v => v !== '')) };
}
test('setConfig semana_pago: admin only, stored in Config, sets REBUILD_PENDING only when the value changes; stock-report setting untouched', () => {
  const e = env(), G = e.G;
  G.getData('0000', '', '');
  assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined);
  const same = J(G.setConfig('0000', 'semana_pago', 'jueves')); assert.ok(same.ok); assert.strictEqual(e.fe.props.REBUILD_PENDING, undefined, 'unchanged value → no rebuild');
  const r = J(G.setConfig('0000', 'semana_pago', 'Lunes'));
  assert.strictEqual(r.config.semana_pago, 'lunes'); assert.strictEqual(r.config.semana_inicio, 'jueves');
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1'); assert.strictEqual(J(G.getData('0000', '', '')).rebuildPending, true);
  assert.strictEqual(J(G.getData('0000', '', '')).config.semana_pago, 'lunes');
  assert.throws(() => G.setConfig('0000', 'semana_pago', 'ayer'), /inválido/);
  e.ss.getSheetByName('Usuarios').appendRow(['Jesús', '1234', 'op', 'sí']);
  e.ss.getSheetByName('Permisos')._d.rows.forEach(r => { if (r[0] === 'config') r[3] = 'sí'; });
  assert.throws(() => G.setConfig('1234', 'semana_pago', 'viernes'), /admin/i);
});
test('Pagos made under the old setting are still shown: attached to the week that contains their stored date (Resumen semanal + getData.paid + markPaid dup check)', () => {
  const e = env(), G = e.G;
  G.getData('0000', '', '');
  const SAL = require('fs').readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const nSal = N.get('SAL_HEADERS').length;
  const row = new Array(nSal).fill(''); row[0] = '9100'; row[1] = 258806; row[2] = 'Bacalar Lagoon Boat Tour'; row[3] = 'compartido'; row[4] = '2026-11-25'; row[5] = '09:00';
  row[6] = '2026-11-25T14:00:00Z'; row[7] = '2026-11-25T17:00:00Z'; row[8] = 1;
  const sh = e.ss.getSheetByName('Salidas') || e.ss.insertSheet('Salidas'); if (!sh._d.rows.length) sh.appendRow(N.get('SAL_HEADERS')); sh.appendRow(row);
  const cr = e.ss.getSheetByName('Tripulación') || e.ss.insertSheet('Tripulación'); if (!cr._d.rows.length) cr.appendRow(N.get('CREW_HEADERS')); cr.appendRow(staff);
  // a payment recorded while the week started on Thursday (week 2026-11-19), for Luis M and for Ana (no earnings at all)
  G.markPaid('0000', '2026-11-19', 'Luis M', 300, 'p1'); G.markPaid('0000', '2026-11-19', 'Ana', 150, 'p2');
  e.ctx.rebuildFinanzas_();
  let res = e.rows('Resumen semanal').map(r => [String(r[0]).slice(0, 10), r[1], r[2], r[4]]);
  assert.ok(res.some(r => r[0] === '2026-11-19' && r[1] === 'Luis M' && r[3] === 300), 'Thursday weeks: payment matches: ' + JSON.stringify(res));
  assert.deepStrictEqual(J(G.getData('0000', '', '')).paid['2026-11-19|Luis M'] !== undefined, true);
  // switch to Monday weeks
  G.setConfig('0000', 'semana_pago', 'lunes'); e.ctx.rebuildFinanzas_();
  res = e.rows('Resumen semanal').map(r => [String(r[0]).slice(0, 10), r[1], r[2], r[4]]);
  assert.ok(res.some(r => r[0] === '2026-11-23' && r[1] === 'Luis M' && r[2] === 1), 'new week with the departure: ' + JSON.stringify(res));
  assert.ok(res.some(r => r[0] === '2026-11-16' && r[1] === 'Luis M' && r[3] === 300), 'the old payment (19 Nov) is attached to Monday 16 Nov, not lost');
  assert.ok(res.some(r => r[0] === '2026-11-16' && r[1] === 'Ana' && r[3] === 150 && r[2] === 0), 'a payment without earnings in its week still shows');
  const paid = J(G.getData('0000', '', '')).paid;
  assert.ok(paid['2026-11-16|Luis M'] && paid['2026-11-16|Ana'], 'getData.paid keyed by the computed week: ' + Object.keys(paid));
  assert.strictEqual(paid['2026-11-19|Luis M'], undefined);
  assert.ok(e.rows('Pagos').some(r => String(r[0]).slice(0, 10) === '2026-11-19'), 'Pagos rows keep their stored week start');
  assert.strictEqual(e.rows('Pagos').length, 2);
  // paying again for the week that now contains the old payment is a duplicate (never double-paid)
  assert.ok(J(G.markPaid('0000', '2026-11-16', 'Luis M', 300, 'p3')).dup);
  assert.strictEqual(e.rows('Pagos').length, 2);
  // the new week is payable
  assert.ok(!J(G.markPaid('0000', '2026-11-23', 'Luis M', 300, 'p4')).dup); assert.strictEqual(e.rows('Pagos').length, 3);
});
test('headers are neutral and keep their positions', () => {
  assert.strictEqual(E.PAGO_HEADERS ? E.PAGO_HEADERS[0] : N.get('PAGO_HEADERS')[0], 'Semana');
  assert.strictEqual(N.get('EV_HEADERS')[0], 'Semana (inicio)'); assert.strictEqual(N.get('RESUMEN_HEADERS')[0], 'Semana (inicio)');
  assert.deepStrictEqual(J(N.get('RESUMEN_HEADERS').slice(1, 4)), ['Nombre', 'Salidas', 'Total (MXN)']);
  assert.ok(!/Semana \(jueves\)/.test(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8')));
});

// ---------- app: wkStart, Ajustes ----------
test('app wkStart(d, dia): follows semana_pago (default jueves); weekStartOf (stock report) independent', () => {
  assert.strictEqual(U.wkStart('2026-11-25'), '2026-11-19');
  assert.strictEqual(U.wkStart('2026-11-25', 'jueves'), '2026-11-19');
  assert.strictEqual(U.wkStart('2026-11-25', 'lunes'), '2026-11-23');
  assert.strictEqual(U.wkStart('2026-11-25', 'miercoles'), '2026-11-25');
  assert.strictEqual(U.wkStart('2026-11-24', 'miercoles'), '2026-11-18');
  assert.strictEqual(U.wkStart('2026-11-22', 'domingo'), '2026-11-22');
  assert.strictEqual(U.wkStart('2026-11-25', 'basura'), '2026-11-19');
  assert.strictEqual(U.weekStartOf('2026-11-25', 'lunes'), '2026-11-23');
  assert.strictEqual(U.payDayName('sabado'), 'sábado'); assert.strictEqual(U.PAYD.length, 7);
});
test('Ajustes screen: Apariencia (Automático | Claro | Oscuro), pay-week chips with confirm sheet, "Semana del reporte de stock"', () => {
  assert.ok(/data-theme-set="\$\{k\}"/.test(html) && /\['auto','Automático'\],\['light','Claro'\],\['dark','Oscuro'\]/.test(html));
  // round 27: the week settings moved to Más › Configuración avanzada › Reglas generales (locked with the code)
  assert.ok(!/data-payw=/.test(html) && !/askPayWeek/.test(html) && /Semana de pago de eventuales/.test(html) && /data-cfgedit=/.test(html) && /Semana del reporte de stock/.test(html));
  assert.ok(/Cambia cómo se agrupan Eventuales, Resumen semanal y Pagos/.test(html), 'rule text');
  assert.ok(/wkStart\(S\.wk\|\|TODAY,S\.config\.semana_pago\)/.test(html));
  assert.ok(!/SIEMPRE jueves|Se paga los jueves/.test(html));
});
test('theme: <html data-theme> forces light/dark, auto = prefers-color-scheme; localStorage in try/catch; theme-color metas follow', () => {
  const head = html.slice(0, html.indexOf('</script>') + 9);
  assert.ok(/id="tcL"/.test(head) && /id="tcD"/.test(head));
  const lsCalls = (head.match(/localStorage\./g) || []).length, tries = (head.match(/try\{/g) || []).length;
  assert.ok(lsCalls >= 3 && tries >= 2, 'localStorage guarded');
  // run the head script against a minimal DOM
  const attrs = {}, store = {};
  const meta = () => { const o = { content: '', _m: 'x', removeAttribute(k) { if (k === 'media') o._m = null; }, setAttribute(k, v) { if (k === 'media') o._m = v; } }; return o; };
  const L = meta(), D = meta(); L.content = '#F7F3EC'; D.content = '#1E1C18';
  const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; } }, getElementById: id => (id === 'tcL' ? L : D) };
  const ctx = { document: doc, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } } };
  ctx.window = ctx;
  vm.runInNewContext(head.slice(head.indexOf('<script>') + 8, head.lastIndexOf('</script>')), ctx);
  assert.strictEqual(ctx.getTheme(), 'auto'); assert.strictEqual(attrs['data-theme'], undefined);
  ctx.setTheme('dark'); assert.strictEqual(attrs['data-theme'], 'dark'); assert.strictEqual(store.adv_ops_theme, 'dark');
  assert.strictEqual(L.content, '#1E1C18'); assert.strictEqual(D.content, '#1E1C18'); assert.strictEqual(L._m, null);
  ctx.setTheme('light'); assert.strictEqual(attrs['data-theme'], 'light'); assert.strictEqual(D.content, '#F7F3EC'); assert.strictEqual(getComputedMedia(L), null);
  ctx.setTheme('auto'); assert.strictEqual(attrs['data-theme'], undefined); assert.strictEqual(store.adv_ops_theme, undefined);
  assert.strictEqual(L._m, '(prefers-color-scheme: light)'); assert.strictEqual(D._m, '(prefers-color-scheme: dark)'); assert.strictEqual(L.content, '#F7F3EC'); assert.strictEqual(D.content, '#1E1C18');
  store.adv_ops_theme = 'oscuro-raro'; assert.strictEqual(ctx.getTheme(), 'auto', 'garbage → auto');
  // storage that throws (private mode) must not break
  ctx.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.strictEqual(ctx.getTheme(), 'auto'); ctx.setTheme('dark'); assert.strictEqual(attrs['data-theme'], 'dark');
  function getComputedMedia(x) { return x._m; }
  const css = html.slice(html.indexOf('<style>\n/* Design system'));
  assert.ok(/:root:not\(\[data-theme="light"\]\)/.test(css) && /:root\[data-theme="dark"\]\{/.test(css) && /:root\[data-theme="light"\]\{color-scheme:light\}/.test(css));
});

// ---------- spacing + rows ----------
test('spacing: 28px between sections (group / sec / summaries / stack); hour 16px 500 ink on tour rows', () => {
  const css = html.slice(html.indexOf('<style>\n/* Design system'), html.indexOf('</style>', html.indexOf('<style>\n/* Design system')));
  for (const sel of ['.group{margin:0 0 28px}', '.sec{margin:0 0 28px}', '.stack{display:grid;gap:8px;margin:0 0 28px}']) assert.ok(css.includes(sel), sel);
  assert.ok(/\.dsum\{[^}]*28px/.test(css) && /\.today\{[^}]*28px/.test(css));
  assert.ok(/\.drow \.l1 \.hr\{font-size:16px;font-weight:500;color:var\(--ink\)/.test(css), 'hour 16/500 ink');
  assert.ok(/\.drow \.l1 \.st\.now|\.drow \.l1\{[^}]*font-size:12px/.test(css), 'status word stays 12');
});
test('rentals and day passes are one quiet gray line (round 11): kayak icon, hour, name, pax, gross; no resources, no check-in; only ⚠ keeps colour', () => {
  const i = html.indexOf('function depCard'), j = html.indexOf('// --- Detalle de una reserva');
  const src = html.slice(i, j);
  const compact = src.slice(src.indexOf("if(rent||d.barco==='otro')"), src.indexOf("return `<button class=\"drow dcard"));
  assert.ok(/dquiet/.test(compact) && /svgI\('kayak'/.test(compact) && /personasTxt\(pax\)/.test(compact));
  assert.strictEqual((compact.match(/class="l[0-9]"/g) || []).length, 1, 'one line');
  assert.ok(!/ciChip|\bres\b|nores|\$\{rt\}|netT/.test(compact), 'no resources / check-in / neto');
  assert.ok(/class="l3 l3a"/.test(src) && /class="l4"/.test(src), 'tour rows keep 4 lines');
  const css = html.slice(html.indexOf('<style>'));
  assert.ok(/\.drow\.dquiet\{[^}]*background:var\(--paper2\)/.test(css) && /\.drow\.dquiet \.cn,[^{]*\{color:var\(--ink3\)/.test(css));
});
test('sw CACHE bumped to v6', () => assert.ok(/'al-ops-v([6-9]|\d{2,})'/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8'))));

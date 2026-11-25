// Round 8: "Arena · salvia" design system (tokens, flat lists) + Ajustes › Inicio de semana (Config tab, setConfig admin-only, stock report presets).
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({weekStartOf,wkStart,addD,depSection})', {});
const E = loadNew().ex;

test('validateConfig_: semana_inicio accepts jueves | lunes (any case/accents), rejects the rest; unknown keys rejected', () => {
  assert.deepStrictEqual(J(E.validateConfig_('semana_inicio', 'Lunes')), { key: 'semana_inicio', value: 'lunes' });
  assert.deepStrictEqual(J(E.validateConfig_('semana_inicio', ' JUEVES ')), { key: 'semana_inicio', value: 'jueves' });
  assert.throws(() => E.validateConfig_('semana_inicio', 'martes'), /inválido/);
  assert.throws(() => E.validateConfig_('semana_inicio', ''), /inválido/);
  assert.throws(() => E.validateConfig_('otra', 'x'), /desconocido/);
});
test('configFromRows_: default jueves; valid rows apply; bad keys / values are ignored', () => {
  assert.deepStrictEqual(J(E.configFromRows_([])), { semana_inicio: 'jueves', semana_pago: 'jueves' });
  assert.strictEqual(E.configFromRows_([['semana_inicio', 'lunes', '', '']]).semana_inicio, 'lunes');
  assert.strictEqual(E.configFromRows_([['semana_inicio', 'sabado'], ['x', 'y']]).semana_inicio, 'jueves');
});
function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  return { ss, G: loadNew(fe).ex };
}
test('setConfig: admin sets it (stored in tab Config, upsert), getData returns config; default jueves before any write', () => {
  const { ss, G } = env();
  assert.strictEqual(J(G.getData('0000', '', '')).config.semana_inicio, 'jueves');
  const r = J(G.setConfig('0000', 'semana_inicio', 'lunes'));
  assert.ok(r.ok); assert.strictEqual(r.config.semana_inicio, 'lunes');
  assert.strictEqual(J(G.getData('0000', '', '')).config.semana_inicio, 'lunes');
  G.setConfig('0000', 'semana_inicio', 'jueves'); G.setConfig('0000', 'semana_inicio', 'lunes');
  const rows = ss.getSheetByName('Config')._d.rows.slice(1).filter(x => x.some(v => v !== ''));
  assert.strictEqual(rows.length, 1, 'one row per key (upsert)'); assert.deepStrictEqual(J(rows[0].slice(0, 2)), ['semana_inicio', 'lunes']);
  assert.throws(() => G.setConfig('0000', 'semana_inicio', 'martes'), /inválido/);
  assert.strictEqual(J(G.getData('0000', '', '')).config.semana_inicio, 'lunes', 'a rejected value changes nothing');
});
test('setConfig: only admin — an op user is refused even if the "config" permission were granted to op; wrong PIN refused', () => {
  const { ss, G } = env();
  G.getData('0000', '', '');
  ss.getSheetByName('Usuarios').appendRow(['Jesús', '1234', 'op', 'sí']);
  const pm = ss.getSheetByName('Permisos'); pm._d.rows.forEach(r => { if (r[0] === 'config') r[3] = 'sí'; });
  assert.throws(() => G.setConfig('1234', 'semana_inicio', 'lunes'), /admin/i);
  assert.throws(() => G.setConfig('9999', 'semana_inicio', 'lunes'), /PIN/);
  assert.strictEqual(J(G.getData('1234', '', '')).config.semana_inicio, 'jueves');
});
test('weekStartOf: report weeks start Thursday (default) or Monday; the pay week (wkStart) defaults to Thursday (own setting semana_pago since round 9)', () => {
  // 2026-11-25 is a Wednesday
  assert.strictEqual(U.weekStartOf('2026-11-25', 'jueves'), '2026-11-19');
  assert.strictEqual(U.weekStartOf('2026-11-25', undefined), '2026-11-19');
  assert.strictEqual(U.weekStartOf('2026-11-25', 'lunes'), '2026-11-23');
  assert.strictEqual(U.weekStartOf('2026-11-23', 'lunes'), '2026-11-23');
  assert.strictEqual(U.weekStartOf('2026-11-26', 'jueves'), '2026-11-26');
  assert.strictEqual(U.weekStartOf('2026-11-22', 'lunes'), '2026-11-16', 'Sunday belongs to the week that started on Monday');
  assert.strictEqual(U.wkStart('2026-11-25'), '2026-11-19');
});
test('app: srPreset uses the config, setConfig wiring + Ajustes screen, sw CACHE bumped', () => {
  assert.ok(/weekStartOf\(TODAY,S\.config&&S\.config\.semana_inicio\)/.test(html), 'presets read the setting');
  assert.ok(/srv\('setConfig'/.test(html) && /ajustes\(\)\{/.test(html) && /data-view="\$\{view\}"|data-view="ajustes"|row\('ajustes'/.test(html));
  assert.ok(/'al-ops-v([6-9]|\d{2,})'/.test(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8')));
});
test('design tokens: Arena · salvia light + dark, Lora loaded, no turquoise, no 34pt title, weights 400/500 only', () => {
  const css = html.slice(html.indexOf('<style>\n/* Design system'), html.indexOf('</style>', html.indexOf('<style>\n/* Design system')));
  for (const v of ['#F7F3EC', '#FFFDF8', '#FBF8F2', '#EAE2D4', '#F0E9DC', '#DCD2C0', '#2B2620', '#7A6F60', '#9C9183', '#3E4A3D', '#E6ECE2', '#3E6B48', '#5C8A5F', '#A8742A', '#B5532F', '#D6CCBB',
    '#1E1C18', '#2A2722', '#25221E', '#3A352E', '#E8E0D2', '#B3A895', '#8C826F', '#8FAF8C', '#7FB08A', '#D4A257', '#E0805F']) assert.ok(css.includes(v), 'token ' + v);
  assert.ok(/fonts\.googleapis\.com\/css2\?family=Lora:wght@400;500/.test(html) && /Georgia/.test(css));
  assert.ok(!/#00939c|#2cc4cc|--lagoon/.test(html), 'no turquoise left');
  assert.ok(!/font-size:34px/.test(css) && !/font-weight:(600|700|bold)/.test(css) && !/font-weight:[6-9]00/.test(html.slice(html.indexOf('<body>'))), 'weights 400/500 only');
  const sizes = [...new Set([...css.matchAll(/font-size:(\d+)px/g)].map(x => +x[1]))].sort((a, b) => a - b);
  assert.deepStrictEqual(sizes, [11, 12, 13, 14, 16, 20, 22, 26], 'type scale: 26 · 16 · 14 · 12 (+ 11 neto, 13 quiet rental rows, 22 figures, 20 product icons)');
});
test('flat layout: no radius on lists / rows / summaries; ONE filled button class; no colour emoji in UI chrome', () => {
  const css = html.slice(html.indexOf('<style>\n/* Design system'), html.indexOf('</style>', html.indexOf('<style>\n/* Design system')));
  for (const sel of ['.list{', '.cell{', '.drow{', '.dsum{', '.today{']) { const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel))); assert.ok(!/border-radius/.test(rule), sel + ' has no radius'); }
  const body = html.slice(html.indexOf('<body>')).replace(/const ICONS=[^\n]*\n/, '');
  const emoji = body.match(/[\u{1F300}-\u{1FAFF}✅❌]|⚠️|⛵|⛽/gu) || [];
  // product icons (🥫 📦 of stock quantities, item icon fallbacks, ⛽ in ICONS) are allowed; UI chrome emoji are not
  const chrome = emoji.filter(e => !['🥫', '📦', '🍶'].includes(e));
  assert.deepStrictEqual(chrome, [], 'chrome emoji: ' + chrome.join(' '));
});
test('departure row: 4 fixed lines (hora·estado + bruto / nombre + neto / recursos·tripulación / bitácora + check-in)', () => {
  assert.ok(/class="l1"/.test(html) && /class="l2"/.test(html) && /class="l3"/.test(html) && /class="l4"/.test(html));
  assert.ok(/terminado|en curso|próxima/.test(html));
  assert.strictEqual(U.depSection({ date: '2026-11-25', time: '09:00', end: '2026-11-25 12:00' }, '2026-11-25', '10:00'), 'live');
});

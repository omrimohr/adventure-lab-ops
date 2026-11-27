// Round 26: phone back button (History API) + Campos 1939722/1939723 → 'personas'.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'docs/sw.js'), 'utf8');
const N = loadNew(), E = N.ex;

test('APP_VER = CACHE = v23', () => {
  assert.ok(/const APP_VER='v23'/.test(html) && sw.indexOf("const CACHE = 'al-ops-v23'") >= 0);
});

// ---- backTarget (pure) ----
const pm = html.match(/\/\/ ==PURE-BEGIN==[\s\S]*?\/\/ ==PURE-END==/);
const U = vm.runInNewContext(pm[0] + '\n({backTarget})', {});
test('backTarget: tab + view, and the view id is restored (data-backarg)', () => {
  assert.deepStrictEqual(J(U.backTarget({ back: 'ev' })), { tab: 'ev', sv: null });
  assert.deepStrictEqual(J(U.backTarget({ back: 'mas', backview: 'feedback' })), { tab: 'mas', sv: { name: 'feedback' } });
  assert.deepStrictEqual(J(U.backTarget({ back: 'ev', backview: 'person', backarg: 'Luis M' })), { tab: 'ev', sv: { name: 'person', arg: 'Luis M' } });
  assert.deepStrictEqual(J(U.backTarget({})), { tab: '', sv: null });
});
test('topBar emits data-backarg only with backView + backArg; goBack uses backTarget', () => {
  assert.ok(/function topBar\(title,\{back,backTo,backView,backArg,/.test(html));
  assert.ok(/data-backarg="\$\{esc\(backArg\)\}"/.test(html));
  assert.ok(/function goBack\(bk\)\{const t=backTarget\(bk\.dataset\)/.test(html));
});

// ---- History module run against a fake history / DOM ----
const hm = html.match(/\/\/ ==HIST-BEGIN==[\s\S]*?\/\/ ==HIST-END==/)[0];
function rig() {
  const log = [], ls = {};
  let stack = [{ hd: 0 }], idx = 0;
  const history = {
    get state() { return stack[idx]; },
    pushState(s) { stack = stack.slice(0, idx + 1); stack.push(s); idx++; log.push('push'); },
    replaceState(s) { stack[idx] = s; },
    go(n) { const t = idx + n; setTimeout(() => { idx = t; fire(); }, 0); },
    back() { this.go(-1); }
  };
  const window = { addEventListener: (k, f) => { ls[k] = f; } };
  const fire = () => ls.popstate && ls.popstate();
  const c = { backs: [], closed: 0, sheetOpen: false, hasBack: false, stackView: null };
  const ctx = {
    history, window, setTimeout, clearTimeout, console,
    document: { querySelector: () => c.hasBack ? { dataset: {} } : null },
    goBack: () => { c.backs.push(1); c.stackView = null; ctx.stackView = null; c.hasBack = false; ctx.render(); },
    closeSheet: () => { c.closed++; ctx.hSheet(false); },
    render: () => ctx.histSync(), stackView: null
  };
  vm.createContext(ctx);
  vm.runInContext(hm.replace(/\blet (hd|hLoc|shOpen|hQ|hBusy|hTimer|inPop)/, 'var $1') + '\nhistInit();', ctx);
  vm.runInContext('var __s=0', ctx);
  // top-level let in the module: expose through accessors
  vm.runInContext('this.getHd=()=>hd;this.getInPop=()=>inPop;this.getShOpen=()=>shOpen;', ctx);
  return { ctx, c, history, tick: () => new Promise(r => setTimeout(r, 15)), idx: () => idx, len: () => stack.length };
}
test('history: opening a detail pushes ONE entry; phone back goes up one level (goBack) and does not push again', async () => {
  const r = rig(), { ctx, c } = r;
  ctx.stackView = { name: 'dep', arg: '1' }; c.hasBack = true; ctx.render();
  assert.strictEqual(r.idx(), 1); assert.strictEqual(ctx.getHd(), 1);
  r.history.back(); await r.tick();
  assert.strictEqual(c.backs.length, 1); assert.strictEqual(ctx.getHd(), 0); assert.strictEqual(r.idx(), 0);
  assert.strictEqual(r.len(), 2); // no extra pushes while popping
});
test('history: a sheet pushes one entry; back closes the sheet first, the detail stays', async () => {
  const r = rig(), { ctx, c } = r;
  ctx.stackView = { name: 'dep', arg: '1' }; c.hasBack = true; ctx.render();
  ctx.hSheet(true); assert.strictEqual(r.idx(), 2); ctx.hSheet(true); assert.strictEqual(r.idx(), 2); // re-opening does not stack
  r.history.back(); await r.tick();
  assert.strictEqual(c.closed, 1); assert.strictEqual(c.backs.length, 0); assert.strictEqual(ctx.getHd(), 1);
  r.history.back(); await r.tick();
  assert.strictEqual(c.backs.length, 1); assert.strictEqual(ctx.getHd(), 0);
});
test('history: closing a sheet in code pops its entry; closeSheet followed by a new view does not clash', async () => {
  const r = rig(), { ctx } = r;
  ctx.hSheet(true); assert.strictEqual(ctx.getHd(), 1);
  ctx.hSheet(false); ctx.stackView = { name: 'purchase', arg: 'p1' }; ctx.render(); // like "compra corregida"
  await r.tick(); await r.tick();
  assert.strictEqual(ctx.getHd(), 1); assert.strictEqual(r.idx(), 1); assert.strictEqual(r.len(), 2);
});
test('history: tab switch (stackView → null, not from a pop) does NOT pile up entries: returns to the base entry', async () => {
  const r = rig(), { ctx } = r;
  ctx.stackView = { name: 'dep', arg: '1' }; ctx.render();
  ctx.stackView = { name: 'person', arg: 'Luis' }; ctx.render(); assert.strictEqual(ctx.getHd(), 2);
  ctx.stackView = null; ctx.render(); await r.tick(); await r.tick();
  assert.strictEqual(ctx.getHd(), 0); assert.strictEqual(r.idx(), 0);
  // plain tab-to-tab at the root: nothing pushed
  const before = r.len(); ctx.render(); ctx.render(); assert.strictEqual(r.len(), before);
});
test('history: browser "forward" is undone, and the ‹ button uses history.back when there is history (hd > 0)', async () => {
  const r = rig(), { ctx, c } = r;
  ctx.stackView = { name: 'dep', arg: '1' }; c.hasBack = true; ctx.render();
  r.history.back(); await r.tick();
  r.history.go(1); await r.tick(); await r.tick();
  assert.strictEqual(ctx.getHd(), 0);
  assert.ok(/if\(hd>0\)history\.back\(\);else goBack\(bk\)/.test(html));
});
test('history wiring: sheet()/closeSheet() call hSheet, render() ends with histSync, logout resets, histInit at load; URL/hash untouched', () => {
  assert.ok(/inFn=input\|\|null;hSheet\(true\)/.test(html));
  assert.ok(/inFn=null;hSheet\(false\);flushRender\(\)/.test(html));
  assert.ok(/stkSync\(\);histSync\(\);/.test(html));
  assert.ok(/closeSheet\(\);histReset\(\);/.test(html));
  assert.ok(/\nhistInit\(\);/.test(html));
  assert.ok(!/pushState\([^)]*,[^)]*,/.test(hm) && !/location\.hash/.test(html)); // no URL argument: the Apps Script calls and sw.js scope are unaffected
  assert.ok(/popstate/.test(hm));
});

// ---- Campos 1939722 / 1939723 → personas ----
const CF_H = () => J(N.get('CF_HEADERS'));
function env() { const fe = fakeEnv(), ss = fakeSpreadsheet(); const G = loadNew(fe, ss); return { fe, ss, G }; }
test('planPersonasPrivado_: only pks found and not yet done; change only when Uso is ignorar', () => {
  assert.deepStrictEqual(J(E.planPersonasPrivado_([['1', 'x', 'ignorar'], ['1939722', 'a', 'Ignorar '], ['1939723', 'b', 'personas']], [])), [{ pk: '1939722', row: 3, change: true }, { pk: '1939723', row: 4, change: false }]);
  assert.deepStrictEqual(J(E.planPersonasPrivado_([['1939722', 'a', 'ignorar']], ['1939722'])), []);
  assert.deepStrictEqual(J(E.planPersonasPrivado_([], [])), []);
});
test('migratePersonasPrivado: ignorar → personas + OK + "Round 26", REBUILD_PENDING; other Uso untouched; retries until both exist; then skipped', () => {
  const e = env(), H = CF_H();
  assert.deepStrictEqual(J(e.G.ex.migratePersonasPrivado20261127_(e.ss)), { found: false });
  const sh = e.ss.insertSheet('Campos');
  sh.getRange(1, 1, 2, H.length).setValues([H, ['1939722', 'personas para el privado SUP', 'ignorar', '', 'Nuevo – revisar', '', '', '', 'previa', '', '']]);
  assert.deepStrictEqual(J(e.G.ex.migratePersonasPrivado20261127_(e.ss)), { found: 1, changed: 1 });
  const rows = sh._d.rows;
  assert.deepStrictEqual([rows[1][2], rows[1][4], rows[1][8]], ['personas', 'OK', 'previa | Round 26']);
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1'); assert.strictEqual(e.fe.props.MIG_R26_PERS, '1939722');
  // second field appears later with another Uso set by the user → marked done, not touched
  sh.getRange(3, 1, 1, H.length).setValues([['1939723', 'personas para el privado Kayak', 'seats', '', 'OK', '', '', '', '', '', '']]);
  rows[1][2] = 'ignorar'; // the first is never re-migrated
  assert.deepStrictEqual(J(e.G.ex.migratePersonasPrivado20261127_(e.ss)), { found: 1, changed: 0 });
  assert.strictEqual(rows[2][2], 'seats'); assert.strictEqual(rows[1][2], 'ignorar');
  assert.deepStrictEqual(J(e.G.ex.migratePersonasPrivado20261127_(e.ss)), { skipped: true });
});
test('rebuildFinanzas runs the Round 26 migration', () => {
  assert.ok(/migratePersonasPrivado20261127_\(ss\)/.test(fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8').split('function rebuildFinanzas')[1]));
});

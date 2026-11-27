// Round 25: current FareHarbor names everywhere (items, resources, roles, customer types), private pax from ANY "personas" field, pax on the card.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({personasTxt,depPax,paxChip})', {});
const N = loadNew(), E = N.ex;

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : null; };
  const post = payload => G.ex.doPost({ postData: { contents: JSON.stringify(payload) } });
  return { ss, fe, G, rows, post };
}
const cf = (pk, name, value, display) => { const o = { custom_field: { pk: pk, name: name }, value: value }; if (display !== undefined) o.display_value = display; return o; };
const sleep = ms => { const t = Date.now(); while (Date.now() - t < ms); };

// ---- private pax ----
const peopleM = () => E.mapeosFromRows_([], [['1463805', '[HBTS] - Sailboat (4 hours)', 'personas', '', 'OK'], ['1463814', '[HBTS] - Sailboat (3 hours)', 'personas', '', 'OK'],
  ['1889802', '# de personas para SUP [HBTS]', 'personas', '', 'OK'], ['1939722', 'personas para el privado SUP', 'ignorar', '', 'OK']], []);
const priv = (cfvs, tourFields) => {
  const b = F.booking({ pk: 1, av: 1, item: 337344, itemName: 'Velero Monocasco Privado [HBTS]', start: '2026-11-24T15:00:00Z', end: '2026-11-24T18:00:00Z', customers: [F.cust(660361, 'Private Tour', cfvs)] }).booking;
  return J(E.bookingPax_(b, { tipo: 'privado', fields: tourFields }, peopleM()));
};

test('private pax: Tours col D lists OTHER pks than the booking carries → any Uso personas field is used (real case 24 Nov: Velero Monocasco [HBTS], 1463814 = 2)', () => {
  const r = priv([cf(1463814, '[HBTS] - Sailboat (3 hours)', '9577862', '2')], ['1463805']);
  assert.deepStrictEqual([r.pax, r.alerta], [2, '']);
});
test('private pax: a col D field with value > 0 wins over other personas fields (not summed)', () => {
  assert.strictEqual(priv([cf(1463805, 'x', '4', '4'), cf(1463814, 'y', '9', '2')], ['1463805']).pax, 4);
});
test('private pax: col D field = 0 and another personas field > 0 → the other one', () => {
  assert.strictEqual(priv([cf(1889802, '# de personas para SUP [HBTS]', '0', '0'), cf(1463814, 'y', '9', '3')], ['1889802']).pax, 3);
});
test('private pax: value 0 / none everywhere → unknown (empty pax) + "Falta # de personas"; ignorar fields are never read', () => {
  const r = priv([cf(1889802, '# de personas para SUP [HBTS]', '0', '0'), cf(1939722, 'personas para el privado SUP', '5', '5')], ['1889802']);
  assert.deepStrictEqual([r.pax, r.alerta], ['', 'Falta # de personas']);
  assert.deepStrictEqual([priv([], []).pax, priv([], []).alerta], ['', 'Falta # de personas']);
});
test('private pax unknown → Salidas "N + pendiente"/"pendiente"; getData booking carries paxQ', () => {
  const e = env();
  const p = F.booking({ pk: 77, av: 9700, item: 337343, itemName: 'Sunrise SUP Tour [HBTS]', start: '2026-11-26T11:00:00Z', end: '2026-11-26T13:00:00Z',
    customers: [F.cust(660361, 'Private Tour', [cf(1889802, '# de personas para SUP [HBTS]', '0', '0')])] });
  e.post(p); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll(); e.G.ex.setMapeo('0000', 'item', '337343', { tipo: 'privado', barco: 'sup', bitacora: 'sí', fields: '1889802' }); e.G.ex.rebuildAll();
  const sal = e.rows('Salidas').find(r => String(r[0]) === '9700');
  assert.strictEqual(sal[e.G.ex.SAL_HEADERS.indexOf('Pax')], 'pendiente');
  const d = J(e.G.ex.getData('0000', '2026-11-20', '2026-12-05')).deps.find(x => x.id === '9700');
  assert.strictEqual(d.bookings[0].paxQ, true); assert.strictEqual(d.bookings[0].pax, 0);
});

// ---- names ----
test('observeNames_ keeps the LATEST name per pk by received time (order of arrival does not matter)', () => {
  const mk = (iname, rname) => { const b = F.booking({ pk: 1, av: 1, item: 5, itemName: iname, start: '2026-11-24T15:00:00Z', end: '2026-11-24T16:00:00Z' }).booking; b.resource_uses = [{ resource: { pk: 8, name: rname } }]; return b; };
  const acc = { items: {}, res: {} };
  E.observeNames_(acc, mk('Nuevo', 'Ramona'), new Date('2026-11-26T10:00:00Z'));
  E.observeNames_(acc, mk('Viejo', 'Tiamat'), new Date('2026-11-20T10:00:00Z'));
  assert.deepStrictEqual(J(acc), { items: { 5: { name: 'Nuevo', t: Date.parse('2026-11-26T10:00:00Z') } }, res: { 8: { name: 'Ramona', t: Date.parse('2026-11-26T10:00:00Z') } } });
});
test('mergeResNames_: new pk added; newer other name replaces + "Antes"; older never overwrites; unchanged → not changed', () => {
  const t1 = Date.parse('2026-11-20T10:00:00Z'), t2 = Date.parse('2026-11-26T10:00:00Z');
  let r = J(E.mergeResNames_([], { 8: { name: 'Tiamat', t: t1 } })); assert.strictEqual(r.changed, true); assert.deepStrictEqual(r.rows.map(x => [x[0], x[1], x[3]]), [['8', 'Tiamat', '']]);
  r = J(E.mergeResNames_(r.rows, { 8: { name: 'Ramona', t: t2 } })); assert.deepStrictEqual(r.rows.map(x => [x[1], x[3]]), [['Ramona', 'Tiamat']]);
  const cur = r.rows;
  r = J(E.mergeResNames_(cur, { 8: { name: 'Viejo', t: t1 } })); assert.strictEqual(r.rows[0][1], 'Ramona'); assert.strictEqual(r.changed, false);
  r = J(E.mergeResNames_(cur, { 8: { name: 'Ramona', t: t2 } })); assert.strictEqual(r.changed, false);
});
test('applyResNames_ / typeSummary_ / roleName_ use the mapping tabs\' current name, matched by pk', () => {
  const M = E.mapeosFromRows_([['1286977', 'Adult (nuevo)', 'pax', 'OK']], [], [['18184', 'Capitán', '', 'capitan', 'OK']], [['163580', 'Ramona', '', 'Tiamat']]);
  assert.deepStrictEqual(J(E.applyResNames_([{ pk: '163580', name: 'Tiamat', n: 2 }, { pk: '9', name: 'X', n: 1 }], M)), [{ pk: '163580', name: 'Ramona', n: 2 }, { pk: '9', name: 'X', n: 1 }]);
  const b = F.booking({ pk: 1, av: 1, item: 5, itemName: 'x', start: '2026-11-24T15:00:00Z', end: '2026-11-24T16:00:00Z', customers: [F.cust(1286977, 'Adult'), F.cust(1286977, 'Adult')] }).booking;
  assert.strictEqual(N.get('typeSummary_')(b, M), '2× Adult (nuevo)'); assert.strictEqual(N.get('typeSummary_')(b), '2× Adult');
  assert.strictEqual(N.get('roleName_')(['a', 'b', 'c', 'd', 'Capitan', 'n', 'u', '', '18184'], M), 'Capitán');
  assert.strictEqual(N.get('roleName_')(['a', 'b', 'c', 'd', 'Capitan', 'n', 'u', '', '777'], M), 'Capitan');
});
test('end to end: items and resources renamed in FareHarbor show the NEW name on older departures (Salidas, getData); Tours / Recursos tabs updated; history flagged', () => {
  const e = env();
  const bk = (pk, av, iname, rname, day) => { const p = F.booking({ pk: pk, av: av, item: 258806, itemName: iname, start: '2026-11-' + day + 'T14:00:00Z', end: '2026-11-' + day + 'T17:00:00Z', customers: [F.cust(100, 'Adult')], crew: [F.CREW[0]] });
    p.booking.resource_uses = [{ pk: 1, resource: { pk: 163580, name: rname }, use_count: 1 }]; return p; };
  e.post(bk(8001, 9801, 'Bacalar Lagoon Boat Tour', 'Tiamat', '20'));
  e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll(); delete e.fe.props.REBUILD_PENDING;
  assert.strictEqual(e.rows('Recursos').length, 1);
  assert.strictEqual(e.rows('Salidas').find(r => String(r[0]) === '9801')[2], 'Bacalar Lagoon Boat Tour');
  sleep(5);
  e.post(bk(8002, 9802, 'Bacalar Lagoon Tour (renombrado)', 'Ramona', '21'));
  assert.strictEqual(e.fe.props.REBUILD_PENDING, '1', 'a rename asks for a history refresh');
  const rec = e.rows('Recursos'); assert.deepStrictEqual(rec.map(r => [String(r[0]), r[1], r[3]]), [['163580', 'Ramona', 'Tiamat']]);
  const tour = e.rows('Tours').find(r => r[0] === 258806); assert.strictEqual(tour[1], 'Bacalar Lagoon Tour (renombrado)'); assert.ok(/Antes: Bacalar Lagoon Boat Tour/.test(tour[5]));
  // the OLD departure shows the new names at once (getData override) …
  const d = J(e.G.ex.getData('0000', '2026-11-15', '2026-11-30')).deps;
  const o = d.find(x => x.id === '9801'); assert.strictEqual(o.item, 'Bacalar Lagoon Tour (renombrado)'); assert.deepStrictEqual(o.res.map(r => r.name), ['Ramona']);
  // … and after the history refresh the stored tabs agree
  e.G.ex.rebuildAll();
  const s1 = e.rows('Salidas').find(r => String(r[0]) === '9801'), H = e.G.ex.SAL_HEADERS;
  assert.strictEqual(s1[2], 'Bacalar Lagoon Tour (renombrado)'); assert.ok(String(s1[H.indexOf('Recursos')]).indexOf('Ramona') === 0);
  assert.strictEqual(e.rows('Reservas').find(r => r[0] === 8001)[8], 'Bacalar Lagoon Tour (renombrado)');
  assert.ok(e.rows('Tripulación').every(r => r[3] === 'Bacalar Lagoon Tour (renombrado)'));
});
test('role short name renamed in the Roles tab → getData crew shows it (matched by Rol clave)', () => {
  const e = env();
  e.post(F.DEPARTURES[9001][0]); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  const sh = e.ss.getSheetByName('Roles'); const i = sh._d.rows.findIndex(r => String(r[0]) === '11');
  assert.ok(i > 0); sh._d.rows[i][1] = 'Capitán de barco';
  const crew = J(e.G.ex.getData('0000', '2026-11-15', '2026-11-30')).deps.find(x => x.id === '9001').crew;
  assert.ok(crew.some(c => /Capit/.test(c.r) && c.r.indexOf('barco') >= 0), JSON.stringify(crew.map(c => c.r)));
});
test('history rule version bumped (recalculates Salidas / Bitácora / Reservas from Raw once)', () => {
  assert.strictEqual(E.BITACORA_RULE_V, '9');
});

// ---- UI ----
test('personasTxt: known → "8 pax", unknown → "? pax", partial → "5 + ? pax"', () => {
  assert.strictEqual(U.personasTxt(8), '8 pax'); assert.strictEqual(U.personasTxt(0, true), '? pax'); assert.strictEqual(U.personasTxt(5, true), '5 + ? pax');
});
test('depPax / paxChip: sum of the bookings, "? pax" in orange, separator only when there is a check-in chip, nothing without pax', () => {
  const d = { bookings: [{ pax: 8 }] };
  assert.deepStrictEqual(J(U.depPax(d)), { n: 8, q: false });
  assert.ok(/8 pax/.test(U.paxChip(d, true)) && /class="sp"/.test(U.paxChip(d, true)) && !/class="sp"/.test(U.paxChip(d, false)));
  const q = { bookings: [{ pax: 0, paxQ: true }] };
  assert.ok(/pxc q/.test(U.paxChip(q, false)) && /\? pax/.test(U.paxChip(q, false)));
  assert.strictEqual(U.paxChip({ bookings: [] }, false), '');
});
test('card wiring: pax sits in the last line (.rt) before the check-in chip; booking line + total use personasTxt with paxQ; APP_VER = CACHE = v22', () => {
  assert.ok(/let rt=paxChip\(d,!!ciH\)\+ciH;/.test(html));
  assert.ok(/b\.paxQ\?`<span class="pq">/.test(html) && /Total · \$\{personasTxt\(paxOf\(d\),depPax\(d\)\.q\)\}/.test(html));
  assert.ok(/const APP_VER='v22'/.test(html) && sw.indexOf("const CACHE = 'al-ops-v22'") >= 0);
});

// ---- scroll memory ----
const U2 = vm.runInNewContext(m[1] + '\n({scrollKey,scrollFor})', {});
test('scrollKey: Operación by day + filter, Eventuales by week/period, tabs, detail views by name + arg; scrollFor defaults to 0', () => {
  const S = { date: '2026-11-27', filter: 'todas', wk: '2026-11-26', evp: null };
  assert.strictEqual(U2.scrollKey('op', null, S), 'op:2026-11-27:todas');
  assert.notStrictEqual(U2.scrollKey('op', null, S), U2.scrollKey('op', null, Object.assign({}, S, { date: '2026-11-28' })));
  assert.notStrictEqual(U2.scrollKey('op', null, S), U2.scrollKey('op', null, Object.assign({}, S, { filter: 'tours' })));
  assert.strictEqual(U2.scrollKey('ev', null, S), 'ev:2026-11-26'); assert.strictEqual(U2.scrollKey('mas', null, S), 'mas');
  assert.strictEqual(U2.scrollKey('op', { name: 'dep', arg: '9201' }, S), 'v:dep:9201');
  assert.strictEqual(U2.scrollFor({ a: 120 }, 'a'), 120); assert.strictEqual(U2.scrollFor({}, 'a'), 0);
});
test('scroll wiring: positions recorded per view, restored only by the back button, same-view re-render keeps scrollY, new views still goTop', () => {
  assert.ok(/scrollMem\[curKey\]=window\.scrollY/.test(html));
  assert.ok(/data-back'\);if\(bk\)|const bk=on\('\[data-back\]'\);if\(bk\)\{[^\n]*render\(\);restoreScroll\(\);return\}/.test(html));
  assert.ok(/keepY=nk===curKey\?window\.scrollY:0/.test(html) && /behavior:'instant'/.test(html));
  assert.ok(/const dp=on\('\[data-dep\]'\);if\(dp\)\{[^\n]*render\(\);goTop\(\)/.test(html));
});

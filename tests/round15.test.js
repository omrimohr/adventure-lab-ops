// Round 15: "Reportar" (feedback): pure helpers, server (addFeedback / setFeedbackEstado / getData), notifications, optimistic queue, report archiving.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const U = vm.runInNewContext(m[1] + '\n({notifBuild,optApply,optMark,fbNew,fbFilter,fbCount,fbImgOk,fbScale,fbContext,fbPayload,screenName,FB_ESTADOS,FB_MAX_IMG})', {});
const E = loadNew().ex;

// ---------- client pure ----------
const FB = [{ id: 'F1', estado: 'Nuevo' }, { id: 'F2', estado: 'En curso' }, { id: 'F3', estado: 'Resuelto' }, { id: 'F4', estado: 'Descartado' }, { id: 'F5', estado: 'Nuevo' }];
test('round 15: fbFilter / fbCount / fbNew (Resueltos = Resuelto + Descartado)', () => {
  assert.strictEqual(U.fbNew(FB), 2); assert.strictEqual(U.fbNew(null), 0);
  assert.deepStrictEqual(Array.from(U.fbFilter(FB, 'nuevo').map(x => x.id)), ['F1', 'F5']);
  assert.deepStrictEqual(Array.from(U.fbFilter(FB, 'curso').map(x => x.id)), ['F2']);
  assert.deepStrictEqual(Array.from(U.fbFilter(FB, 'resuelto').map(x => x.id)), ['F3', 'F4']);
  assert.strictEqual(U.fbCount(FB, 'resuelto'), 2);
});
test('round 15: notifBuild — admin gets "N reportes nuevos" (kind feedback, go fb) after pend; op never', () => {
  const l = U.notifBuild([], [{}], 'admin', FB);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l.map(x => x.kind))), ['pend', 'feedback']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l[1])), { id: 'feedback', kind: 'feedback', text: '2 reportes nuevos', go: { t: 'fb' } });
  assert.strictEqual(U.notifBuild([], [], 'admin', [FB[0]])[0].text, '1 reporte nuevo');
  assert.strictEqual(U.notifBuild([], [], 'admin', [FB[1]]).length, 0, 'no Nuevo rows → nothing');
  assert.strictEqual(U.notifBuild([], [], 'op', FB).length, 0);
  assert.strictEqual(U.notifBuild([], [], 'admin').length, 0, 'old callers without feedback keep working');
});
test('round 15: fbScale max 1600 longest side, never upscales; fbImgOk cap; fbContext; screenName; fbPayload', () => {
  assert.deepStrictEqual(J(U.fbScale(4000, 3000, 1600)), { w: 1600, h: 1200 });
  assert.deepStrictEqual(J(U.fbScale(3000, 4000, 1600)), { w: 1200, h: 1600 });
  assert.deepStrictEqual(J(U.fbScale(800, 600, 1600)), { w: 800, h: 600 });
  assert.ok(U.fbImgOk('') && U.fbImgOk('x'.repeat(U.FB_MAX_IMG)) && !U.fbImgOk('x'.repeat(U.FB_MAX_IMG + 1)));
  assert.strictEqual(U.fbContext('Operación', '2026-11-25', 'Omri', 'v12'), 'Se envía con: pantalla Operación · 2026-11-25 · Omri · versión v12');
  assert.strictEqual(U.screenName('op', null, { op: 'Operación' }), 'Operación'); assert.strictEqual(U.screenName('mas', 'pend', {}), 'Por configurar');
  const p = U.fbPayload({ tipo: 'x', texto: '  hola ', img: '' }, { cid: 'c1', screen: 'Stock', date: '2026-11-25', ver: 'v12' });
  assert.deepStrictEqual(J(p), { cid: 'c1', tipo: 'Error', texto: 'hola', pantalla: 'Stock', fecha: '2026-11-25', version: 'v12', img: '' });
});
test('round 15: optApply addFeedback / setFeedbackEstado are idempotent and optMark flips the label', () => {
  const S = { feedback: [], moves: [], purchases: [], deps: [], paid: {}, pend: [] }, ctx = { today: '2026-11-25', hm: '10:00', user: 'Omri' };
  const q = { id: 'u1', fn: 'addFeedback', args: [{ tipo: 'Sugerencia', texto: 'Hola', pantalla: 'Stock', fecha: '2026-11-25', version: 'v12', cid: 'u1' }] };
  U.optApply(S, q, ctx); U.optApply(S, q, ctx);
  assert.strictEqual(S.feedback.length, 1); assert.strictEqual(S.feedback[0].pend, 'guardando…'); assert.strictEqual(S.feedback[0].tipo, 'Sugerencia');
  q.fail = 'final'; U.optMark(S, q); assert.strictEqual(S.feedback[0].pend, 'no se guardó');
  const S2 = { feedback: [{ id: 'F1', estado: 'Nuevo', notas: '' }] };
  U.optApply(S2, { id: 'u2', fn: 'setFeedbackEstado', args: ['F1', 'Resuelto', 'listo', 'u2'] }, ctx);
  assert.strictEqual(S2.feedback[0].estado, 'Resuelto'); assert.strictEqual(S2.feedback[0].notas, 'listo');
});
test('round 15: APP_VER matches the service-worker CACHE; top bar has the report button before the bell', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8');
  const v = /const APP_VER='([^']+)'/.exec(html)[1];
  assert.ok(sw.indexOf("const CACHE = 'al-ops-" + v + "'") >= 0, 'bump both together');
  const bar = /function roleBar\(\)\{[^\n]*/.exec(html)[0];
  assert.ok(bar.indexOf('data-report') > 0 && bar.indexOf('data-report') < bar.indexOf('data-bell'));
  assert.ok(bar.indexOf('aria-label="Reportar error o sugerencia"') > 0);
});

// ---------- server ----------
test('round 15: normFeedback_ requires text, caps image, defaults tipo to Error', () => {
  assert.throws(() => E.normFeedback_({ texto: '   ' }), /Escribe qué pasó/);
  assert.throws(() => E.normFeedback_({ texto: 'x', img: 'x'.repeat(3500001) }), /La imagen es muy grande/);
  const f = J(E.normFeedback_({ tipo: 'Sugerencia', texto: 'a  b\nc', pantalla: 'Stock', fecha: '2026-11-25', version: 'v12' }));
  assert.strictEqual(f.tipo, 'Sugerencia'); assert.strictEqual(f.texto, 'a b c'); assert.strictEqual(E.normFeedback_({ texto: 'x', tipo: 'zzz' }).tipo, 'Error');
  assert.strictEqual(E.validEstado_('en curso'), 'En curso'); assert.throws(() => E.validEstado_('Hecho'), /Estado inválido/);
});
test('round 15: feedbackFileName_ = fb_<yyyyMMdd_HHmm>_<user>.jpg (accents and spaces cleaned)', () => {
  assert.strictEqual(E.feedbackFileName_('2026-11-25 09:05', 'Jesús Pérez'), 'fb_20261125_0905_Jesus_Perez.jpg');
  assert.strictEqual(E.feedbackFileName_('2026-11-25 09:05', ''), 'fb_20261125_0905_user.jpg');
});
test('round 15: feedbackFromRows_: admin sees all (last N, newest first); others only their own', () => {
  const row = (id, u, est) => [id, '2026-11-25 10:00', u, 'op', 'Error', 'texto ' + id, 'Stock', '2026-11-25', 'v12', 'https://d/x', est, '', '', 'c' + id];
  const rows = [row('F1', 'Jesús', 'Nuevo'), row('F2', 'Edder', 'Nuevo'), row('F3', 'Jesús', 'Resuelto')];
  assert.deepStrictEqual(J(E.feedbackFromRows_(rows, { nombre: 'Omri', rol: 'admin' }).map(x => x.id)), ['F3', 'F2', 'F1']);
  assert.deepStrictEqual(J(E.feedbackFromRows_(rows, { nombre: 'Omri', rol: 'admin' }, 2).map(x => x.id)), ['F3', 'F2']);
  assert.deepStrictEqual(J(E.feedbackFromRows_(rows, { nombre: 'jesús', rol: 'op' }).map(x => x.id)), ['F3', 'F1']);
  const x = J(E.feedbackFromRows_(rows, { nombre: 'Omri', rol: 'admin' })[2]);
  assert.deepStrictEqual(Object.keys(x).filter(k => ['id', 'fecha', 'usuario', 'tipo', 'texto', 'pantalla', 'url', 'estado', 'notas'].indexOf(k) < 0), ['fechaApp', 'version', 'cid']);
});

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss), files = [];
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const p2 = n => String(n).padStart(2, '0');
  fe.Utilities = { formatDate: (d, tz, pt) => { const x = new Date(new Date(d).getTime() - 5 * 3600000), P = { yyyy: x.getUTCFullYear(), MM: p2(x.getUTCMonth() + 1), dd: p2(x.getUTCDate()), HH: p2(x.getUTCHours()), mm: p2(x.getUTCMinutes()) }; return pt.replace(/yyyy|MM|dd|HH|mm/g, k => P[k]); },
    DigestAlgorithm: {}, Charset: {}, computeDigest: () => [], base64Decode: s => Buffer.from(s, 'base64'), newBlob: (b, mt, name) => ({ b, mt, name }) };
  const folder = { createFile: bl => { files.push(bl); return { getUrl: () => 'https://drive.test/' + bl.name }; } };
  fe.DriveApp = { getFoldersByName: () => ({ hasNext: () => true, next: () => folder }), createFolder: () => folder };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : []; };
  return { ss, G, rows, files };
}
test('round 15: addFeedback — any user; row layout; image saved in Drive; duplicate cid ignored; "ID cliente" is the last column', () => {
  const e = env(), G = e.G.ex;
  G.findUser_; // sanity
  const u = J(G.addFeedback('0000', { tipo: 'Sugerencia', texto: 'Ojalá', pantalla: 'Stock', fecha: '2026-11-25', version: 'v12', img: 'data:image/jpeg;base64,AAAA', cid: 'f-1' }));
  assert.ok(u.ok && /^F\d+$/.test(u.id));
  const sh = e.ss.getSheetByName('Feedback');
  assert.deepStrictEqual(J(sh._d.rows[0]), J(G.FEEDBACK_HEADERS)); assert.strictEqual(G.FEEDBACK_HEADERS[G.FEEDBACK_HEADERS.length - 1], 'ID cliente');
  const r = e.rows('Feedback')[0];
  assert.strictEqual(r[4], 'Sugerencia'); assert.strictEqual(r[5], 'Ojalá'); assert.strictEqual(r[6], 'Stock'); assert.strictEqual(r[7], '2026-11-25'); assert.strictEqual(r[8], 'v12');
  assert.strictEqual(r[10], 'Nuevo'); assert.strictEqual(r[13], 'f-1');
  assert.strictEqual(e.files.length, 1); assert.ok(/^fb_\d{8}_\d{4}_.+\.jpg$/.test(e.files[0].name)); assert.strictEqual(r[9], 'https://drive.test/' + e.files[0].name);
  const d = J(G.addFeedback('0000', { texto: 'Ojalá', cid: 'f-1' })); assert.ok(d.dup); assert.strictEqual(d.id, u.id); assert.strictEqual(e.rows('Feedback').length, 1);
  G.addFeedback('0000', { texto: 'sin foto', cid: 'f-2' }); assert.strictEqual(e.rows('Feedback').length, 2); assert.strictEqual(e.files.length, 1); assert.strictEqual(e.rows('Feedback')[1][9], '');
  assert.throws(() => G.addFeedback('0000', { texto: '' }), /Escribe qué pasó/); assert.throws(() => G.addFeedback('9999', { texto: 'x' }), /PIN incorrecto/);
});
test('round 15: setFeedbackEstado admin only; validates estado; sets note; unknown id errors; getData returns feedback', () => {
  const e = env(), G = e.G.ex;
  const id = G.addFeedback('0000', { texto: 'Error uno', cid: 'f-1' }).id;
  const r = J(G.setFeedbackEstado('0000', id, 'En curso', 'lo veo')); assert.strictEqual(r.estado, 'En curso');
  const row = e.rows('Feedback')[0]; assert.strictEqual(row[10], 'En curso'); assert.strictEqual(row[11], 'lo veo'); assert.ok(row[12]);
  assert.throws(() => G.setFeedbackEstado('0000', id, 'Hecho', ''), /Estado inválido/);
  assert.throws(() => G.setFeedbackEstado('0000', 'F0', 'Resuelto', ''), /No encontré/);
  const d = J(G.getData('0000', '2026-11-20', '2026-11-30'));
  assert.strictEqual(d.feedback.length, 1); assert.strictEqual(d.feedback[0].estado, 'En curso'); assert.strictEqual(d.feedback[0].notas, 'lo veo'); assert.strictEqual(d.feedback[0].texto, 'Error uno');
});

// ---------- report archive (Code.gs doPost 'reporte') ----------
test('round 15: reportFileName_ appends .csv, strips path chars; archiveReport_ saves once in Importados and never throws', () => {
  assert.strictEqual(E.reportFileName_('Comercial 2026-11-24'), 'Comercial 2026-11-24.csv'); assert.strictEqual(E.reportFileName_('a/b.CSV'), 'a_b.CSV'); assert.strictEqual(E.reportFileName_(''), 'app.csv');
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss), made = [], names = {};
  const mkFolder = nm => ({ nm, kids: {}, files: {}, getFoldersByName(n) { const k = this.kids[n]; return { hasNext: () => !!k, next: () => k }; },
    createFolder(n) { return (this.kids[n] = mkFolder(n)); }, getFilesByName(n) { const f = this.files[n]; return { hasNext: () => !!f, next: () => f }; },
    createFile(n, c, mt) { made.push({ n, c, mt }); return (this.files[n] = { n }); } });
  const root = mkFolder('root');
  fe.DriveApp = { getFoldersByName: n => ({ hasNext: () => !!names[n], next: () => names[n] }), createFolder: n => (names[n] = root) };
  const G = loadNew(fe).ex;
  assert.strictEqual(G.archiveReport_(ss, 'a,b\n1,2', 'rep1'), true);
  assert.deepStrictEqual(J(made), [{ n: 'rep1.csv', c: 'a,b\n1,2', mt: 'text/csv' }]); assert.ok(root.kids['Importados'].files['rep1.csv']);
  assert.strictEqual(G.archiveReport_(ss, 'a,b\n1,2', 'rep1.csv'), false, 'same name: not duplicated'); assert.strictEqual(made.length, 1);
  fe.DriveApp = { getFoldersByName: () => { throw new Error('Drive caído'); } };
  const G2 = loadNew(fe).ex; assert.strictEqual(G2.archiveReport_(ss, 'x', 'r2'), false);
  assert.ok(ss.getSheetByName('Errores')._d.rows.some(r => r[1] === 'Archivar reporte'), 'logged to Errores');
});

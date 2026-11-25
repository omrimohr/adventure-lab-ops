/**
 * Adventure Lab Ops – App server (step 6)
 * ----------------------------------------------------------------
 * Extra file for the same Apps Script project as Code.gs (shares its globals:
 * sheet_, readTab_, seedTab_, writeTab_, fmtDate_, ymd_, norm_, consumoSalida_, rebuildFinanzas, TZ, *_HEADERS …).
 * Called through Code.gs doPost → apiResponse_ (type "api").
 *
 * Auth: tab Usuarios [Nombre, PIN, Rol, Activo] + tab Permisos [Permiso, Descripción, admin, op].
 *   Every public function takes the PIN first and re-checks user + permission on the server.
 * Writes only APPEND to log tabs (Compras, Ajustes, Comida empleado, Pagos, Revisiones); nothing is deleted.
 * Money in MXN. Dates 'yyyy-MM-dd' in TZ (the spreadsheet time zone must be America/Cancun, as for the rest of the DB).
 */

const USR_HEADERS = ['Nombre', 'PIN', 'Rol (admin/op)', 'Activo'];
const PERM_HEADERS = ['Permiso', 'Descripción', 'admin', 'op'];
const REV_HEADERS = ['Availability pk', 'Por', 'Fecha/hora'];
const PERM_SEED = [
  ['compras', 'Agregar compras', 'sí', 'sí'],
  ['revisar', 'Marcar revisado', 'sí', 'sí'],
  ['pagar', 'Pagar eventuales', 'sí', 'no'],
  ['inventario', 'Inventario completo', 'sí', 'no'],
  ['ajuste', 'Ajustar inventario', 'sí', 'no'],
  ['editar', 'Editar o anular compras', 'sí', 'no'],
  ['comida', 'Registrar comida de empleado', 'sí', 'sí'],
  ['config', 'Configuración (productos, tarifas, tours y permisos)', 'sí', 'no']
];
const BARCO_LABEL = { ponton: 'Pontón', catamaran: 'Catamarán', monocasco: 'Monocasco', hobie: 'Hobie', sup: 'Tablas SUP', kayak: 'Kayaks', otro: 'Otro' };
const ROL_LABEL = { 'capitan': 'Capitán', 'marinero': 'Marinero', 'guia': 'Guía', 'instructor lider': 'Instructor líder', 'instructor asistente': 'Instructor asistente', 'instructor': 'Instructor', 'auxiliar': 'Auxiliar' };
const TICKETS_FOLDER = 'Adventure Lab Ops – Tickets';

// ---------------- API entry (called from Code.gs doPost) ----------------
// The app (GitHub Pages) POSTs {type:'api', fn, args}; every function re-checks the PIN itself.
function apiResponse_(p) {
  const map = { login: login, getData: getData, addCompra: addCompra, anularCompra: anularCompra, editCompra: editCompra,
    addAjuste: addAjuste, addConteo: addConteo, addComida: addComida, markPaid: markPaid, markRev: markRev,
    saveProducto: saveProducto, saveTarifa: saveTarifa, savePerm: savePerm, saveTourBarco: saveTourBarco, setMapeo: setMapeo, refreshFin: refreshFin };
  let out;
  try {
    const f = map[String(p.fn)];
    if (!f) throw new Error('Función desconocida');
    out = { ok: true, result: f.apply(null, Array.isArray(p.args) ? p.args : []) };
  } catch (e) { out = { ok: false, error: String((e && e.message) || e) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------- Pure helpers (unit-tested in node) ----------------
function str_(v) { return v instanceof Date ? fmtCell_(v) : (v === null || v === undefined ? '' : String(v)); }
function numOr_(v, d) { const n = Number(v); return (v === '' || v === null || v === undefined || isNaN(n)) ? d : n; }
function validYmd_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : ''; }
function yes_(v) { return /^s/i.test(String(v || '')); }
function notNo_(v) { return !/^n/i.test(String(v || '')); }
function clean_(s, max) { return String(s === null || s === undefined ? '' : s).replace(/\s*\|\s*/g, ' / ').trim().slice(0, max || 300); }
function pluralEs_(s) { s = String(s || ''); return /[aeiouáéíóú]$/i.test(s) ? s + 's' : /s$/i.test(s) ? s : s + 'es'; }
// PINs can come back from Sheets as numbers (leading zeros lost)
function pinStr_(v) { return typeof v === 'number' ? String(v).padStart(4, '0') : String(v === null || v === undefined ? '' : v).trim(); }

function findUser_(rows, pin) {
  const p = pinStr_(pin);
  if (!p) return null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] === '' || !notNo_(r[3])) continue;
    if (pinStr_(r[1]) === p) return { nombre: String(r[0]).trim(), rol: /^a/i.test(String(r[2])) ? 'admin' : 'op' };
  }
  return null;
}
/** Permisos rows → {admin:{perm:bool}, op:{…}}. Admin always keeps 'config'. */
function permsFromRows_(rows) {
  const out = { admin: {}, op: {} };
  rows.forEach(r => { if (r[0] === '') return; out.admin[r[0]] = yes_(r[2]); out.op[r[0]] = yes_(r[3]); });
  out.admin.config = true;
  return out;
}
function permOk_(perms, rol, perm) {
  if (rol === 'admin' && perm === 'config') return true;
  return !!(perms[rol] && perms[rol][perm]);
}

// Product / purchase mapping
function guessIcon_(id, group) {
  const m = { cer: '🍺', agu: '💧', ref: '🥤', coc: '🥤', vin: '🍷', jug: '🧃', gas: '⛽', hie: '🧊', fru: '🍉', des: '🍳', cde: '🍽️', cda: '🍽️' };
  if (m[id]) return m[id];
  const g = { 'Bebidas': '🥤', 'Combustible': '⛽', 'Consumo directo': '🧊', 'Comida empleado': '🍽️' };
  return g[group] || '📦';
}
function guessUnitIcon_(unit) { const u = norm_(unit); return u === 'lata' ? '🥫' : u === 'botella' ? '🍶' : ''; }

/** Productos rows (13 cols: 11 standard + Icono + Empaque) → items shaped like the app's S.items */
function buildItems_(prodRows, lastCost) {
  return prodRows.filter(r => r[0] !== '').map(r => {
    const id = String(r[0]), unit = String(r[3] || 'unidad'), pack = Math.max(1, numOr_(r[4], 1));
    const cost = numOr_(r[8], 0);
    return {
      id: id, name: String(r[1] || id), icon: String(r[11] || '') || guessIcon_(id, r[2]), unitIcon: guessUnitIcon_(unit),
      controlStock: yes_(r[5]), group: String(r[2] || ''), unit: unit, units: pluralEs_(unit), pack: pack,
      packName: String(r[12] || '') || (pack > 1 ? 'caja' : unit),
      price: lastCost[id] !== undefined ? lastCost[id] : cost, // current unit cost = last purchase price, else Productos cost
      min: numOr_(r[6], 0), field: String(r[7] || ''), active: notNo_(r[9])
    };
  });
}
const NOTE_RE_ = { anul: /^Anulada (\d{4}-\d{2}-\d{2}): (.*)$/, edit: /^Editada (\d{4}-\d{2}-\d{2}) → (\S+): (.*)$/, corr: /^Corrige (\S+) (\d{4}-\d{2}-\d{2}): (.*)$/ };
function appendNote_(note, marker) { return note ? note + ' | ' + marker : marker; }
/** Compras rows → [{id,d,sup,lines,ticket,note,annulled,hasta,history}] (one purchase = rows sharing Compra ID) */
function groupCompras_(rows) {
  const by = {}, order = [];
  rows.forEach(r => {
    if (r[0] === '') return;
    const id = String(r[0]);
    let c = by[id];
    if (!c) {
      c = by[id] = { id: id, d: ymd_(r[1]), sup: String(r[2] || ''), lines: [], ticket: String(r[9] || ''), note: '', annulled: /anul/i.test(String(r[10])),
        hasta: r[7] ? ymd_(r[7]) : '', history: [], _raw: String(r[8] || ''), reg: ymd_(r[11]) || ymd_(r[1]), por: String(r[12] || '') };
      order.push(id);
    }
    c.lines.push({ i: String(r[3]), q: numOr_(r[4], 0), p: numOr_(r[5], 0) });
  });
  return order.map(id => {
    const c = by[id], parts = c._raw ? c._raw.split(' | ') : [], keep = [];
    c.history.push({ d: c.reg, a: 'Registrada' + (c.por ? ' · ' + c.por : ''), r: '' });
    parts.forEach(p => {
      let m;
      if ((m = NOTE_RE_.corr.exec(p))) c.history.push({ d: m[2], a: 'Corrige a ' + m[1], r: m[3] });
      else if ((m = NOTE_RE_.anul.exec(p))) c.history.push({ d: m[1], a: 'Anulada', r: m[2] });
      else if ((m = NOTE_RE_.edit.exec(p))) c.history.push({ d: m[1], a: 'Editada (reemplazada por ' + m[2] + ')', r: m[3] });
      else keep.push(p);
    });
    c.note = keep.join(' | ');
    delete c._raw; delete c.reg; delete c.por;
    return c;
  }).sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));
}
/** Last purchase price per product (active purchases only, by date) — same rule as rebuildFinanzas */
function lastCostFrom_(purchases) {
  const out = {};
  purchases.filter(c => !c.annulled).sort((a, b) => a.d.localeCompare(b.d)).forEach(c => c.lines.forEach(l => { out[l.i] = l.p; }));
  return out;
}
function priceLogFrom_(purchases) {
  const out = {};
  purchases.filter(c => !c.annulled).forEach(c => c.lines.forEach(l => {
    const a = out[l.i] = out[l.i] || [];
    if (!a.length || a[a.length - 1].p !== l.p) a.push({ d: c.d, p: l.p, cid: c.id });
  }));
  return out;
}
/**
 * Stock ledger. Purchases +q (annulled ones also get an opposite 'Compra anulada' move so the net is 0),
 * Ajustes ±q, and consumption −q per departure (bitácora salida − regreso, only departures up to today —
 * same rule as the Stock tab). Cost-only products (controlStock = no) are flagged noStock.
 * ctx: {items, purchases, ajustes (rows), salidas (rows), bitBy {pk:[rows]}, productos [{id,campo}], today, M (field mapping, optional)}
 */
function buildMoves_(ctx) {
  const it = {}; ctx.items.forEach(i => { it[i.id] = i; });
  const mv = [];
  ctx.purchases.forEach(c => c.lines.forEach(l => {
    const p = it[l.i]; if (!p) return;
    mv.push({ d: c.d, i: l.i, q: l.q, c: l.p, t: 'Compra', ref: c.sup, cid: c.id, noStock: !p.controlStock });
    if (c.annulled) {
      const h = c.history.filter(x => !/^Registrada/.test(x.a)).pop() || {};
      mv.push({ d: h.d || c.d, i: l.i, q: -l.q, c: l.p, t: 'Compra anulada', ref: h.r || '', cid: c.id, noStock: !p.controlStock });
    }
  }));
  ctx.ajustes.forEach(a => {
    const p = it[String(a[1])]; if (!p || a[2] === '') return;
    const mot = String(a[3] || '');
    mv.push({ d: ymd_(a[0]), i: p.id, q: Number(a[2]) || 0, c: p.price, t: mot === 'Inventario completo' ? mot : 'Ajuste · ' + (mot || 'Ajuste'), ref: String(a[4] || mot), noStock: !p.controlStock });
  });
  ctx.salidas.forEach(s => {
    const bits = ctx.bitBy[String(s[0])];
    if (!bits || !bits.length) return; // no bitácora lines → no consumption (and no date formatting needed)
    const fecha = fmtDate_(s[6], 'yyyy-MM-dd');
    if (!fecha || fecha > ctx.today) return;
    const cons = consumoSalida_(bits, ctx.productos, ctx.M);
    Object.keys(cons).forEach(id => {
      const p = it[id]; if (!p || !p.controlStock) return;
      mv.push({ d: fecha, i: id, q: -cons[id], c: p.price, t: 'Bitácora', ref: fmtDate_(s[6], 'HH:mm') + ' ' + s[2], dep: String(s[0]) });
    });
  });
  return mv.map((m, n) => ({ m: m, n: n })).sort((a, b) => a.m.d.localeCompare(b.m.d) || a.n - b.n).map(x => x.m);
}
function stockMap_(moves) {
  const s = {};
  moves.forEach(m => { if (!m.noStock) s[m.i] = Math.round(((s[m.i] || 0) + m.q) * 1e6) / 1e6; });
  return s;
}
/** counts {id: counted} vs system stock → [{i, diff}] for controlled, active products that differ */
function countDiffs_(counts, items, stock) {
  const out = [];
  items.forEach(i => {
    if (!i.controlStock || !i.active || counts[i.id] === undefined || counts[i.id] === '' || counts[i.id] === null) return;
    const c = Number(counts[i.id]);
    if (!isFinite(c) || c < 0) throw new Error('Conteo inválido: ' + i.name);
    const d = Math.round((c - (stock[i.id] || 0)) * 1e6) / 1e6;
    if (d !== 0) out.push({ i: i.id, diff: d });
  });
  return out;
}
/** Validates cart lines against known product ids → [{i,q,p}] */
function cleanLines_(lines, ids) {
  const set = {}; ids.forEach(i => { set[i] = true; });
  return (lines || []).map(l => ({ i: String(l.i || ''), q: Number(l.q), p: Number(l.p) })).filter(l => l.q > 0).map(l => {
    if (!set[l.i]) throw new Error('Producto desconocido: ' + l.i);
    if (!isFinite(l.q) || !isFinite(l.p) || l.p < 0) throw new Error('Cantidad o precio inválido');
    return { i: l.i, q: l.q, p: l.p };
  });
}
function slugId_(name, taken) {
  const base = (norm_(name).replace(/[^a-z0-9]/g, '').slice(0, 3) || 'prd');
  let id = base, n = 2;
  while (taken.indexOf(id) >= 0) id = base + (n++);
  return id;
}

// Tarifas → readable labels for the rates screen
function rateLabel_(r) {
  const rol = norm_(r[0]), barco = norm_(r[1]), desde = r[2], hasta = r[3], item = String(r[4] || ''), persona = String(r[5] || '');
  const special = { 'hora extra': 'Hora extra (capitán y marinero)', 'cancelado': 'Tour cancelado con tripulación', 'festivo': 'Día festivo', 'traslado': 'Traslado' };
  if (special[rol]) return special[rol];
  let l = persona && (rol === '*' || !rol) ? persona + ' (tarifa especial)' : (ROL_LABEL[rol] || (rol && rol !== '*' ? rol.charAt(0).toUpperCase() + rol.slice(1) : 'Cualquier rol'));
  if (persona && rol !== '*' && rol) l += ' · ' + persona;
  if (barco && barco !== '*') l += ' · ' + (BARCO_LABEL[barco] || barco).toLowerCase();
  if (item) l += ' ' + item;
  const hi = hasta !== '' && Number(hasta) < 99, lo = desde !== '' && Number(desde) > 0;
  if (hi && lo) l += ' (' + desde + '–' + hasta + ' h)';
  else if (hi) l += ' (hasta ' + hasta + ' h)';
  else if (lo) l += ' (más de ' + desde + ' h)';
  return l;
}
function buildRates_(rows) {
  const out = [];
  rows.forEach((r, i) => {
    if (r[0] === '') return;
    out.push({ id: i + 2, l: rateLabel_(r), amt: r[6] === '' ? '' : Number(r[6]), u: String(r[7] || 'salida'), note: String(r[8] || ''), pending: r[6] === '' });
  });
  return out;
}

// Revisions (latest wins) and display
function latestRevs_(rows, today) {
  const out = {};
  rows.forEach(r => {
    if (r[0] === '') return;
    const d = r[2] instanceof Date ? r[2] : new Date(r[2]);
    const t = isNaN(d) ? 0 : d.getTime(), k = String(r[0]);
    if (!out[k] || t >= out[k].t) {
      const day = isNaN(d) ? '' : fmtDate_(d, 'yyyy-MM-dd'), hm = isNaN(d) ? '' : fmtDate_(d, 'HH:mm');
      out[k] = { t: t, by: String(r[1] || ''), at: day === today ? hm : (day ? day.slice(8) + '/' + day.slice(5, 7) + ' ' + hm : ''), day: day, hm: hm };
    }
  });
  Object.keys(out).forEach(k => { out[k] = { by: out[k].by, at: out[k].at, day: out[k].day, hm: out[k].hm }; }); // day/hm: the app formats the date itself
  return out;
}
function roleLabel_(rol) {
  const n = norm_(rol);
  return ROL_LABEL[n] || (n ? String(rol).trim() : '');
}
/** Bitácora rows of ONE departure → {out:{prodId:q}, back:{…}} (fruit counts people, not stock: skipped like consumoSalida_). Matched by field pk (Campos tab). */
function bitQty_(bitRows, productos, M) {
  const active = {}; productos.forEach(p => { active[p.id] = true; });
  const out = {}, back = {};
  bitRows.forEach(b => {
    if (b[8] === '' || isNaN(Number(b[8]))) return;
    const u = bitUso_(b, M, productos);
    const id = u.uso === 'producto' ? u.prod : ''; if (!id || id === 'fru' || !active[id]) return;
    const t = b[5] === 'Salida' ? out : back;
    t[id] = (t[id] || 0) + Number(b[8]);
  });
  return { out: out, back: back };
}
function extrasText_(bitRows, M, skipAdic) {
  const parts = [];
  bitRows.forEach(b => {
    const c = String(b[6] || ''), uso = bitUso_(b, M).uso;
    if (uso !== 'extras' && uso !== 'costo adicional') return;
    const adic = uso === 'costo adicional';
    if (adic && skipAdic) return; // shown (parsed) under Costos
    if (b[9] !== '' && b[9] !== null) parts.push(adic ? c + ': ' + b[9] : String(b[9]));
    else if (b[8] !== '' && Number(b[8])) parts.push(c + ': ' + (adic || /costo/i.test(c) ? '$' : '') + b[8]);
  });
  return parts.join(' · ');
}
/**
 * Departures of a date window, one object each. inp = all rows already read:
 * {desde,hasta, salidas, reservas, crew, bit, ev (Eventuales), ext (Externos), costos, revs {pk:{by,at}}, barcos {itemPk:barco}, productos}
 */
/** Fast date-window test on a Salidas 'Inicio' value: ISO strings far outside the window are rejected without Utilities.formatDate (slow in Apps Script) */
function windowTest_(desde, hasta) {
  const lo = addDays_(desde, -1), hi = addDays_(hasta, 1);
  return v => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const p = v.slice(0, 10); if (p < lo || p > hi) return false; }
    const f = fmtDate_(v, 'yyyy-MM-dd');
    return f >= desde && f <= hasta;
  };
}
/** Salidas rows 'Actualizado' newer than FIN_AT (ms) → the finance tabs (Eventuales, Costos…) are behind: the app asks refreshFin in the background */
function staleFin_(salidas, finAt) {
  let max = 0;
  salidas.forEach(r => { const t = r[16] instanceof Date ? r[16].getTime() : Date.parse(r[16]); if (t > max) max = t; });
  return max > Number(finAt || 0);
}
/** Pure: Reservas 'Check-in' / 'No show' / 'Check-in detalle' → {in, n, ns, det:[{t, s: in|pending|noshow}]} or null (no pax customers / not computed yet) */
function ciFrom_(text, ns, det) {
  const k = parseCheckin_(text); if (!k) return null;
  return { in: k.in, n: k.n, ns: Number(ns) || 0, det: String(det || '').split('|').filter(String).map(x => { const i = x.lastIndexOf(':'); return { t: x.slice(0, i), s: x.slice(i + 1) }; }) };
}
function buildDeps_(inp) {
  const group = (rows, col) => { const m = {}; rows.forEach(r => { const k = String(r[col]); (m[k] = m[k] || []).push(r); }); return m; };
  const inWin = windowTest_(inp.desde, inp.hasta);
  const wins = inp.salidas.filter(s => inWin(s[6]));
  const pks = {}; wins.forEach(s => { pks[String(s[0])] = true; });
  const resBy = {}, disp = {}, urls = {};
  inp.reservas.forEach(r => {
    const k = String(r[6]); if (!pks[k]) return;
    (resBy[k] = resBy[k] || []).push(r); disp[String(r[0])] = String(r[1] || r[0]); urls[String(r[0])] = String(r[32] || '');
  });
  const crewBy = group(inp.crew, 0), bitBy = group(inp.bit, 0), evBy = {}, extBy = {};
  inp.ev.forEach(r => { evBy[String(r[4]) + '|' + String(r[5])] = r; });
  inp.ext.forEach(r => { extBy[String(r[3]) + '|' + String(r[5])] = r; });
  const costBy = {}; inp.costos.forEach(r => { costBy[String(r[0])] = r; });
  const ids = list => String(list || '').split(',').map(x => x.trim()).filter(String);
  return wins.map(s => {
    const pk = String(s[0]), bits = bitBy[pk] || [], bq = bitQty_(bits, inp.productos, inp.M), st = String(s[11] || '');
    const hasOut = /^(Completa|Falta regreso)$/.test(st), hasBack = /^(Completa|Falta salida)$/.test(st);
    let hx = 0; bits.forEach(b => { if (bitUso_(b, inp.M).uso === 'hora extra' && b[8] !== '') hx += Number(b[8]) || 0; });
    const crew = (crewBy[pk] || []).map(c => {
      const n = String(c[5] || c[6] || ''), e = evBy[pk + '|' + String(c[5])], x = extBy[pk + '|' + String(c[5])];
      const nt = String(c[7] || ''); // crew Note in FareHarbor, e.g. "Barco: El Cormoran" (externo: "San Ángel – Juan Pérez")
      if (e) return { n: n, r: roleLabel_(c[4]), nt: nt, pay: { base: r2_(Number(e[10]) * Number(e[11])), hx: r2_(e[13]), tot: r2_(e[14]) }, alert: String(e[16] || '') };
      if (x) return { n: n, r: roleLabel_(c[4]), nt: nt, ext: true, note: String(x[6] || ''), monto: x[8] === '' || x[8] === undefined ? null : r2_(x[8]), pay: { base: 0, hx: 0, tot: 0 }, alert: String(x[7] || '') };
      return { n: n, r: roleLabel_(c[4]), nt: nt, pay: { base: 0, hx: 0, tot: 0 }, alert: '' };
    });
    const bookings = (resBy[pk] || []).filter(r => r[3] === 'sí' && !r[13]).sort((a, b) => Number(a[0]) - Number(b[0])).map(r => ({
      id: String(r[1] || r[0]), name: String(r[17] || ''), pax: numOr_(r[14], 0), types: String(r[16] || ''),
      gross: r2_(numOr_(r[22], 0)), // FareHarbor receipt total (Reservas 'Total (MXN)'); cancelled and OPS bookings are filtered out above
      net: r[30] === '' || r[30] === null ? null : Number(r[30]), est: r[31] === 'estimado', alert: String(r[28] || ''),
      url: String(r[32] || ''), // FareHarbor dashboard link of the booking ('' until the Reservas rebuild fills it)
      pk: String(r[0]), note: String(r[21] || ''), paid: r2_(numOr_(r[23], 0)), aff: String(r[18] || ''), src: String(r[19] || ''), by: String(r[20] || ''),
      created: r[25] ? fmtDate_(r[25], 'yyyy-MM-dd HH:mm') : '', ci: ciFrom_(r[33], r[34], r[35]), campos: String(r[36] || ''), tel: String(r[37] || '')
    }));
    const firstUrl = list => { for (let i = 0; i < list.length; i++) if (urls[list[i]]) return urls[list[i]]; return ''; };
    const k = costBy[pk];
    const barco = inp.barcos[String(s[1])] || '';
    return {
      id: pk, itemPk: String(s[1]), date: fmtDate_(s[6], 'yyyy-MM-dd'), time: fmtDate_(s[6], 'HH:mm'), end: s[7] ? fmtDate_(s[7], 'yyyy-MM-dd HH:mm') : '', item: String(s[2]), label: '',
      gross: r2_(bookings.reduce((a, x) => a + x.gross, 0)), res: resFromText_(s[20]),
      boat: BARCO_LABEL[barco] || '', barco: barco, tipo: String(s[3] || ''), crew: crew, bookings: bookings,
      out: hasOut ? bq.out : null, back: hasBack ? bq.back : null, extras: extrasText_(bits, inp.M, true), ca: parseCostos_(costoAdicionalText_(bits, inp.M)), hx: hx,
      rev: inp.revs[pk] || null, bit: st, alerts: String(s[15] || ''), netSource: String(s[18] || ''),
      costs: k ? { b: r2_(k[8]), g: r2_(k[10]), h: r2_(k[9]), f: r2_(k[11]), des: r2_(k[12]), ev: r2_(k[13]), tot: r2_(k[14]), pct: k[15] === '' ? null : Number(k[15]), ca: r2_(k[18]) } : null,
      ci: (k => k ? { in: k.in, n: k.n, ns: Number(s[22]) || 0 } : null)(parseCheckin_(s[21])),
      paxTxt: String(s[9]), salidaUrl: firstUrl(ids(s[12])), regresoUrl: firstUrl(ids(s[13])), salidaPk: ids(s[12]).join(', '), regresoPk: ids(s[13]).join(', '),
      salidaId: ids(s[12]).map(x => disp[x] || x).join(', '), regresoId: ids(s[13]).map(x => disp[x] || x).join(', ')
    };
  }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
// ---------------- "Por configurar" and health (pure, unit-tested in node) ----------------
const ROL_OPCIONES_ = ['capitan', 'marinero', 'guia', 'instructor lider', 'instructor asistente', 'externo', 'ignorar'];
/**
 * Everything with Estado "Nuevo – revisar", for the app's inbox.
 * inp: {M, toursRows (Tours rows, 9 cols), barcos {itemPk: barco}, seen {itemPk: [{pk, name, ejemplo}]}}
 * → [{kind: tipo|campo|rol|item, clave, name, pk, visto, ms, en, ejemplo, actual, opciones}]
 */
function buildPend_(inp) {
  const M = inp.M || { ctype: {}, field: {}, role: {} }, out = [];
  const when = v => { if (!v) return { visto: '', ms: 0 }; const d = v instanceof Date ? v : new Date(v); return isNaN(d) ? { visto: '', ms: 0 } : { visto: fmtDate_(d, 'yyyy-MM-dd HH:mm'), ms: d.getTime() }; };
  const pkOf = k => k.indexOf('n:') === 0 ? '' : k;
  Object.keys(M.ctype).forEach(k => {
    const e = M.ctype[k]; if (e.estado !== ESTADO_NUEVO) return;
    out.push(Object.assign({ kind: 'tipo', clave: k, name: e.nombre, pk: pkOf(k), en: e.en, ejemplo: '', actual: { uso: e.uso }, opciones: USOS_CT }, when(e.visto)));
  });
  Object.keys(M.field).forEach(k => {
    const e = M.field[k]; if (e.estado !== ESTADO_NUEVO) return;
    out.push(Object.assign({ kind: 'campo', clave: k, name: e.nombre, pk: pkOf(k), en: e.en, ejemplo: e.ejemplo, actual: { uso: e.uso, prod: e.prod }, opciones: USOS_CF }, when(e.visto)));
  });
  Object.keys(M.role).forEach(k => {
    const e = M.role[k]; if (e.estado !== ESTADO_NUEVO) return;
    out.push(Object.assign({ kind: 'rol', clave: k, name: e.nombre, pk: pkOf(k), en: e.en, ejemplo: '', actual: { tarifa: e.tarifa }, opciones: ROL_OPCIONES_ }, when(e.visto)));
  });
  (inp.toursRows || []).forEach(r => {
    if (r[0] === '' || tourEstado_(r[7], r[5]) !== ESTADO_NUEVO) return;
    const pk = String(r[0]);
    out.push(Object.assign({ kind: 'item', clave: pk, name: String(r[1] || ''), pk: pk, en: '', ejemplo: '',
      actual: { tipo: String(r[2] || '').toLowerCase().trim(), barco: norm_(r[6]) || (inp.barcos || {})[pk] || '', bitacora: yes_(r[4]) ? 'sí' : 'no',
        fields: String(r[3] || '').split(',').map(x => x.trim()).filter(String) },
      opciones: { tipos: ITEM_TIPOS_, barcos: Object.keys(BARCO_LABEL), campos: (inp.seen || {})[pk] || [] } }, when(r[8])));
  });
  return out;
}
/** Pure: fields (any level) of a few bookings → [{pk, name, ejemplo}] (for the people-field chips of a new tour) */
function fieldsFromBookings_(bookings) {
  const seen = {}, out = [];
  bookings.forEach(b => allCfvs_(b, null).forEach(x => {
    const pk = cfPk_(x.v); if (!pk || seen[pk]) return;
    seen[pk] = true; out.push({ pk: pk, name: cfName_(x.v), ejemplo: sampleValue_(x.v) });
  }));
  return out.slice(0, 14);
}

/**
 * Health warnings (shown in the app only). inp: {nowMs, today, hhmm 'HH:mm', dow 0-6 (3 = Wednesday), lastRawMs|null,
 * salidas: [{fecha, hora, item, activas, bitacora (Salidas "Bitácora" col), tipo (Tours tipo; rentals don't need bitácora unless they have an OPS booking), hasOps}],
 * control: [{d, est}] (Control días), pendMs: [ms first seen of every "Nuevo – revisar"], erroresHoy, ctrlFrom}
 * → [{nivel:'warn', tipo, texto, rol:'admin'|'todos'}]
 */
function saludAlerts_(inp) {
  const out = [], today = inp.today, hhmm = inp.hhmm || '00:00';
  const warn = (tipo, texto, rol) => out.push({ nivel: 'warn', tipo: tipo, texto: texto, rol: rol });
  const mins = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  // 1. webhook silence: only 07:00–21:00, never on Wednesday. The overnight gap doesn't count (silence is measured from 07:00 at the earliest).
  if (inp.lastRawMs && inp.dow !== 3 && mins >= 420 && mins < 1260) {
    const windowStart = inp.nowMs - (mins - 420) * 60000;
    const quiet = (inp.nowMs - Math.max(inp.lastRawMs, windowStart)) / 3600000;
    if (quiet > 4) warn('webhook', 'Sin eventos de FareHarbor hace ' + Math.floor((inp.nowMs - inp.lastRawMs) / 3600000) + ' h', 'admin');
  }
  // 2. bitácora missing (last 7 days; today only after 21:00)
  const from = addDays_(today, -7), miss = [];
  (inp.salidas || []).forEach(s => {
    const past = s.fecha < today || (s.fecha === today && hhmm >= '21:00');
    if (!past || s.fecha < from || !(s.activas > 0) || (s.bitacora === 'No aplica' && !s.hasOps) || s.bitacora === 'Completa') return;
    miss.push(s);
  });
  miss.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
  miss.slice(0, 8).forEach(s => warn('bitacora', 'Falta bitácora: ' + s.fecha + ' ' + s.hora + ' ' + s.item, 'todos'));
  if (miss.length > 8) warn('bitacora', 'Faltan ' + (miss.length - 8) + ' bitácoras más', 'todos');
  // 3. Comercial's report missing (day D still "estimado", checked from 12:00 of D+1; D ≥ control start, last 14 days)
  const ctrlFrom = inp.ctrlFrom || CTRL_FROM, y1 = addDays_(today, -1), lim = addDays_(today, -14), days = [];
  (inp.control || []).forEach(c => {
    if (!(c.est > 0) || c.d < ctrlFrom || c.d < lim) return;
    if (c.d < y1 || (c.d === y1 && hhmm >= '12:00')) days.push(c.d);
  });
  days.sort().reverse();
  days.slice(0, 6).forEach(d => warn('reporte', 'Falta reporte de Comercial del ' + d, 'admin'));
  if (days.length > 6) warn('reporte', 'Faltan reportes de ' + (days.length - 6) + ' días más', 'admin');
  // 4. things to configure for more than 2 days
  const old = (inp.pendMs || []).filter(ms => ms && inp.nowMs - ms > 48 * 3600000).length;
  if (old) warn('config', old + (old === 1 ? ' cosa por configurar' : ' cosas por configurar') + ' desde hace más de 2 días', 'admin');
  // 5. connection errors today
  if (inp.erroresHoy > 0) warn('errores', inp.erroresHoy + (inp.erroresHoy === 1 ? ' error hoy en la conexión' : ' errores hoy en la conexión'), 'admin');
  return out;
}
/** Plan for migrate20261124 on Tarifas rows (pure): which rows to set / insert */
function planTarifasMigration_(vals) {
  const plan = { ignacio: -1, insertAfter: -1, toInsert: [] };
  plan.ignacio = vals.findIndex(r => norm_(r[5]) === 'ignacio arceo');
  const has = (rol, barco) => vals.some(r => norm_(r[0]) === rol && norm_(r[1]) === barco && norm_(r[5]) === '');
  if (!has('capitan', 'hobie')) plan.toInsert.push(['capitan', 'hobie', '', '', '', '', 600, 'salida', 'Hobie = como velero']);
  if (!has('marinero', 'hobie')) plan.toInsert.push(['marinero', 'hobie', '', '', '', '', 400, 'salida', '']);
  let last = -1; vals.forEach((r, i) => { if (norm_(r[1]) === 'monocasco') last = i; });
  plan.insertAfter = last >= 0 ? last : vals.length - 1;
  return plan;
}

// ---------------- Sheets plumbing ----------------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}
function rebuildFin_() {
  const r = rebuildFinanzas_(); // not rebuildFinanzas(): a pending full rebuild is left to the 15-min trigger
  try { PropertiesService.getScriptProperties().setProperty('FIN_AT', String(Date.now())); } catch (e) {}
  return r;
}
/**
 * Webhooks recompute Salidas but not Eventuales/Costos. getData never rebuilds (it only says stale:true);
 * the app then calls this in the background. tryLock: if a rebuild/webhook already holds the lock, return at once.
 */
function refreshFin(pin) {
  auth_(pin);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return { ran: false, busy: true };
  try { rebuildFin_(); return { ran: true }; } finally { try { lock.releaseLock(); } catch (e) {} }
}
function ensureUsuarios_(ss) {
  let sh = ss.getSheetByName('Usuarios');
  if (!sh) {
    sh = ss.insertSheet('Usuarios');
    sh.getRange(1, 1, 1, USR_HEADERS.length).setValues([USR_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 2, 200, 1).setNumberFormat('@'); // keep leading zeros
    sh.getRange(2, 1, 1, 4).setValues([['Omri', '0000', 'admin', 'sí']]); // seed: owner changes the PIN
  }
  return sh;
}
function loadPerms_(ss) {
  let sh = ss.getSheetByName('Permisos');
  if (!sh) sh = seedTab_(ss, 'Permisos', PERM_HEADERS, PERM_SEED);
  let rows = readTab_(ss, 'Permisos', PERM_HEADERS);
  const have = {}; rows.forEach(r => { have[r[0]] = true; });
  const add = PERM_SEED.filter(p => !have[p[0]]);
  if (add.length) { sh.getRange(sh.getLastRow() + 1, 1, add.length, 4).setValues(add); rows = rows.concat(add); }
  return permsFromRows_(rows);
}
function guard_() {
  if (Number(CacheService.getScriptCache().get('badpin') || 0) >= 10) throw new Error('Demasiados intentos. Espera 10 minutos.');
}
function bad_() {
  const c = CacheService.getScriptCache();
  c.put('badpin', String(Number(c.get('badpin') || 0) + 1), 600);
}
/** Valid PIN (and permission) or throws a Spanish error. Returns {nombre, rol} */
function auth_(pin, perm) {
  guard_();
  const ss = ss_();
  ensureUsuarios_(ss);
  const u = findUser_(readTab_(ss, 'Usuarios', USR_HEADERS), pin);
  if (!u) { bad_(); throw new Error('PIN incorrecto'); }
  if (perm && !permOk_(loadPerms_(ss), u.rol, perm)) throw new Error('Tu rol no puede hacer esto');
  return u;
}
function readProdRows_(ss) {
  const sh = seedTab_(ss, 'Productos', PROD_HEADERS, PROD_SEED);
  const n = sh.getLastRow() - 1;
  return n >= 1 ? sh.getRange(2, 1, n, 13).getValues() : [];
}

// ---------------- Public: login + read ----------------
function login(pin) {
  try {
    guard_();
    const ss = ss_();
    ensureUsuarios_(ss);
    const u = findUser_(readTab_(ss, 'Usuarios', USR_HEADERS), pin);
    if (!u) { bad_(); return { ok: false }; }
    return { ok: true, nombre: u.nombre, rol: u.rol, perms: loadPerms_(ss) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

/** Everything the app needs, in the shape of the prototype's S. desde/hasta: 'yyyy-MM-dd' window for departures. */
function getData(pin, desde, hasta) {
  const u = auth_(pin);
  const ss = ss_();
  const today = today_(), now = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  desde = validYmd_(desde) || addDays_(today, -21);
  hasta = validYmd_(hasta) || addDays_(today, 7);
  if (hasta < desde) { const t = desde; desde = hasta; hasta = t; }
  if (hasta > addDays_(desde, 400)) hasta = addDays_(desde, 400);

  if (!ss.getSheetByName('Tours')) loadTours_(ss); // creates + seeds Tours on first run (the rows are read once, below)
  seedTab_(ss, 'Tarifas', TAR_HEADERS, TAR_SEED);
  const salidas = readTab_(ss, 'Salidas', SAL_HEADERS).filter(r => r[0] !== '');
  let finAt = 0;
  try { finAt = Number(PropertiesService.getScriptProperties().getProperty('FIN_AT') || 0); } catch (e) {}
  const stale = staleFin_(salidas, finAt);
  const perms = loadPerms_(ss);
  const prodRows = readProdRows_(ss);
  const compras = groupCompras_(readTab_(ss, 'Compras', COMPRA_HEADERS));
  const ajustes = readTab_(ss, 'Ajustes', AJUSTE_HEADERS).filter(r => r[1] !== '');
  const bit = readTab_(ss, 'Bitácora', BIT_HEADERS);
  const barcos = ensureBarco_(ss);

  const items = buildItems_(prodRows, lastCostFrom_(compras));
  const productos = prodRows.filter(r => r[0] !== '' && notNo_(r[9])).map(r => ({ id: String(r[0]), campo: r[7] }));
  const M = loadMapeos_(ss); // null until the 15-min rebuild creates the mapping tabs (defaults apply meanwhile)
  const bitBy = {}; bit.forEach(r => { const k = String(r[0]); (bitBy[k] = bitBy[k] || []).push(r); });
  const moves = buildMoves_({ items: items, purchases: compras, ajustes: ajustes, salidas: salidas, bitBy: bitBy, productos: productos, today: today, M: M });

  const reservas = readTab_(ss, 'Reservas', RES_HEADERS);
  const extRows = readTab_(ss, 'Externos', EXT_HEADERS); // read once: used by the departures and by the Eventuales list
  const deps = buildDeps_({
    desde: desde, hasta: hasta, salidas: salidas, bit: bit, barcos: barcos, productos: productos, M: M,
    reservas: reservas, crew: readTab_(ss, 'Tripulación', CREW_HEADERS),
    ev: readTab_(ss, 'Eventuales', EV_HEADERS), ext: extRows, costos: readTab_(ss, 'Costos salida', COSTO_HEADERS),
    revs: latestRevs_(readTab_(ss, 'Revisiones', REV_HEADERS), today)
  });

  const paid = {};
  readTab_(ss, 'Pagos', PAGO_HEADERS).filter(r => r[1] !== '').forEach(r => { paid[ymd_(r[0]) + '|' + r[1]] = ymd_(r[3]); });
  const weekly = readTab_(ss, 'Resumen semanal', RESUMEN_HEADERS).map(r => ({ w: ymd_(r[0]), n: String(r[1]), s: Number(r[2]) || 0, t: Number(r[3]) || 0, paid: Number(r[4]) || 0, pend: Number(r[5]) || 0, alerts: String(r[6] || '') }));
  const externos = extRows.map(r => ({ d: ymd_(r[0]), time: String(r[1]), item: String(r[2]), pk: String(r[3]), r: String(r[4]), n: String(r[5]), note: String(r[6] || ''), alert: String(r[7] || ''), monto: r[8] === '' || r[8] === undefined ? null : r2_(r[8]) }));
  const control = readTab_(ss, 'Control días', CTRL_HEADERS).map(r => ({ d: ymd_(r[0]), dia: String(r[1]), sal: Number(r[2]) || 0, res: Number(r[3]) || 0, ex: Number(r[4]) || 0, est: Number(r[5]) || 0, estado: String(r[6]) }));
  const toursRows = readTab_(ss, 'Tours', TOURS_HEADERS.concat(['Barco', TOURS_ESTADO_HDR, TOURS_VISTO_HDR])).filter(r => r[0] !== '');
  const tours = toursRows.map(r => ({ pk: String(r[0]), name: String(r[1]), tipo: String(r[2]), barco: norm_(r[6]) || barcos[String(r[0])] || '' }));
  const pend = buildPend_({ M: M, toursRows: toursRows, barcos: barcos,
    seen: seenFieldsFor_(ss, toursRows.filter(r => tourEstado_(r[7], r[5]) === ESTADO_NUEVO).map(r => String(r[0])), reservas) });
  const fh = fhInfo_(ss, today);
  const inRecent = windowTest_(addDays_(today, -8), '9999-12-30');
  const saludAll = saludAlerts_({
    nowMs: Date.now(), today: today, hhmm: now, dow: new Date(today + 'T00:00:00Z').getUTCDay(), lastRawMs: lastRawMs_(ss),
    salidas: salidas.filter(r => inRecent(r[6])).map(r => ({ fecha: fmtDate_(r[6], 'yyyy-MM-dd'), hora: fmtDate_(r[6], 'HH:mm'), item: String(r[2]),
      activas: Number(r[8]) || 0, bitacora: String(r[11] || ''), tipo: String(r[3] || ''), hasOps: !!(r[12] || r[13]) })),
    control: control.map(c => ({ d: c.d, est: c.est })), pendMs: pend.map(x => x.ms), erroresHoy: fh.errores
  });
  const fhOk = !saludAll.some(a => a.tipo === 'webhook'); // FareHarbor connection healthy (the app's green/orange dot)
  const salud = saludAll.filter(a => u.rol === 'admin' || a.rol === 'todos');
  const comidas = readTab_(ss, 'Comida empleado', COMIDA_HEADERS).filter(r => r[1] !== '').slice(-15).reverse()
    .map(r => ({ d: ymd_(r[0]), n: String(r[1]), tipo: String(r[2]), q: Number(r[3]) || 0, nota: String(r[4] || ''), por: String(r[5] || '') }));

  return {
    ok: true, user: { nombre: u.nombre, rol: u.rol }, perms: perms, today: today, now: now, desde: desde, hasta: hasta,
    items: items, purchases: compras, moves: moves, priceLog: priceLogFrom_(compras), deps: deps,
    rates: buildRates_(readTab_(ss, 'Tarifas', TAR_HEADERS)), paid: paid, weekly: weekly, externos: externos, control: control,
    tours: tours, comidas: comidas, fh: fh, pend: u.rol === 'admin' ? pend : [], salud: salud, fhOk: fhOk, stale: stale, rebuildPending: isRebuildPending_()
  };
}

/** Webhook activity for the "Conexión FareHarbor" screen (reads only the last 300 Raw rows, never the JSON column) */
function fhInfo_(ss, today) {
  const out = { ultimo: '', hoy: 0, dups: 0, errores: 0, eventos: [] };
  try {
    const raw = sheet_(ss, 'Raw', RAW_HEADERS), last = raw.getLastRow();
    if (last >= 2) {
      const from = Math.max(2, last - 299);
      const v = raw.getRange(from, 1, last - from + 1, 10).getValues();
      const lab = { booked: 'Reserva', cancelled: 'Reserva cancelada', rebooked: 'Reserva reagendada' };
      v.forEach(r => {
        if (fmtDate_(r[0], 'yyyy-MM-dd') !== today) return;
        out.hoy++; if (r[2] === 'sí') out.dups++;
      });
      out.ultimo = fmtDate_(v[v.length - 1][0], 'yyyy-MM-dd HH:mm');
      v.slice(-6).reverse().forEach(r => out.eventos.push({ at: fmtDate_(r[0], 'yyyy-MM-dd HH:mm'), t: lab[String(r[5])] || String(r[5] || 'Evento'), s: String(r[8] || '') + (r[9] ? ' · ' + fmtDate_(r[9], 'yyyy-MM-dd HH:mm') : '') }));
    }
    const er = ss.getSheetByName('Errores');
    if (er && er.getLastRow() >= 2) {
      const f = Math.max(2, er.getLastRow() - 99);
      er.getRange(f, 1, er.getLastRow() - f + 1, 1).getValues().forEach(r => { if (r[0] && fmtDate_(r[0], 'yyyy-MM-dd') === today) out.errores++; });
    }
  } catch (e) {}
  return out;
}

/** 'Recibido' of the last Raw row (ms) or null */
function lastRawMs_(ss) {
  try {
    const raw = ss.getSheetByName('Raw'), last = raw ? raw.getLastRow() : 0;
    if (last < 2) return null;
    const v = raw.getRange(last, 1).getValue();
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    return isNaN(t) ? null : t;
  } catch (e) { return null; }
}
/** Fields seen on the latest bookings of each given (new) item → {itemPk: [{pk, name, ejemplo}]}. Reads at most 3 Raw rows per item. */
function seenFieldsFor_(ss, itemPks, reservas) {
  const out = {};
  if (!itemPks.length) return out;
  const raw = ss.getSheetByName('Raw');
  if (!raw) return out;
  itemPks.forEach(pk => {
    const rows = reservas.filter(r => String(r[7]) === pk && r[29]).slice(-3), bs = [];
    rows.forEach(r => {
      try {
        const json = String(raw.getRange(Number(r[29]), 12).getValue() || '');
        if (json.indexOf('DRIVE:') === 0) return;
        const b = (JSON.parse(json) || {}).booking; if (b) bs.push(b);
      } catch (e) {}
    });
    out[pk] = fieldsFromBookings_(bs);
  });
  return out;
}

// ---------------- Public: writes (append-only) ----------------
function saveTicket_(dataUrl, id) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return '';
  const it = DriveApp.getFoldersByName(TICKETS_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(TICKETS_FOLDER);
  const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], id + '.jpg'));
  return f.getUrl();
}
function prodIds_(ss) { return readProdRows_(ss).filter(r => r[0] !== '').map(r => String(r[0])); }
function appendCompraRows_(ss, id, p, lines, user, ticket) {
  const sh = sheet_(ss, 'Compras', COMPRA_HEADERS), now = new Date();
  const rows = lines.map(l => [id, p.d, clean_(p.sup, 120) || 'Sin proveedor', l.i, l.q, l.p, r2_(l.q * l.p), p.hasta || '', clean_(p.note, 300), ticket, 'activa', now, user]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, COMPRA_HEADERS.length).setValues(rows);
}
function normCompra_(p, fallback) {
  p = p || {}; fallback = fallback || {};
  return { d: validYmd_(p.d) || fallback.d || today_(), sup: p.sup !== undefined ? p.sup : fallback.sup, note: p.note !== undefined ? p.note : fallback.note,
    hasta: validYmd_(p.hasta) || '', ticket: p.ticket !== undefined ? p.ticket : fallback.ticket };
}
function addCompra(pin, p) {
  const u = auth_(pin, 'compras');
  return withLock_(() => {
    const ss = ss_(), lines = cleanLines_((p || {}).lines, prodIds_(ss));
    if (!lines.length) throw new Error('Agrega al menos un producto con cantidad');
    const id = 'C' + Date.now(), c = normCompra_(p);
    let ticket = clean_(c.ticket, 200);
    if (p.ticketData) { try { ticket = saveTicket_(p.ticketData, id) || ticket; } catch (e) { logError_(ss, 'ticket', e, id); } }
    appendCompraRows_(ss, id, c, lines, u.nombre, ticket);
    rebuildFin_();
    return { ok: true, id: id };
  });
}
function compraRows_(sh, id) {
  const n = sh.getLastRow() - 1, out = [];
  if (n < 1) return out;
  sh.getRange(2, 1, n, COMPRA_HEADERS.length).getValues().forEach((r, i) => { if (String(r[0]) === String(id)) out.push({ row: i + 2, v: r }); });
  return out;
}
function markCompra_(sh, rows, marker) {
  rows.forEach(x => {
    sh.getRange(x.row, 11).setValue('anulada');
    sh.getRange(x.row, 9).setValue(appendNote_(String(x.v[8] || ''), marker));
  });
}
function anularCompra(pin, id, reason) {
  auth_(pin, 'editar');
  reason = clean_(reason, 200);
  if (!reason) throw new Error('El motivo es obligatorio');
  return withLock_(() => {
    const ss = ss_(), sh = sheet_(ss, 'Compras', COMPRA_HEADERS), rows = compraRows_(sh, id).filter(x => !/anul/i.test(String(x.v[10])));
    if (!rows.length) throw new Error('No encontré la compra o ya está anulada');
    markCompra_(sh, rows, 'Anulada ' + today_() + ': ' + reason);
    rebuildFin_();
    return { ok: true };
  });
}
/** Edit = annul the old purchase (kept, with reason) + new purchase. Returns the new id. */
function editCompra(pin, id, payload, reason) {
  const u = auth_(pin, 'editar');
  reason = clean_(reason, 200);
  if (!reason) throw new Error('El motivo es obligatorio');
  return withLock_(() => {
    const ss = ss_(), sh = sheet_(ss, 'Compras', COMPRA_HEADERS), old = compraRows_(sh, id).filter(x => !/anul/i.test(String(x.v[10])));
    if (!old.length) throw new Error('No encontré la compra o ya está anulada');
    const lines = cleanLines_((payload || {}).lines, prodIds_(ss));
    if (!lines.length) throw new Error('Deja al menos un producto (o anula la compra)');
    const o = old[0].v, base = String(o[8] || '').split(' | ').filter(x => !/^(Anulada|Editada|Corrige) /.test(x)).join(' | ');
    const c = normCompra_(payload, { d: ymd_(o[1]), sup: o[2], note: base, ticket: o[9] });
    if (!payload || payload.hasta === undefined) c.hasta = o[7] ? ymd_(o[7]) : '';
    let nid = 'C' + Date.now(); if (nid === String(id)) nid += '1';
    const day = today_();
    markCompra_(sh, old, 'Editada ' + day + ' → ' + nid + ': ' + reason);
    c.note = appendNote_(clean_(c.note, 300), 'Corrige ' + id + ' ' + day + ': ' + reason);
    appendCompraRows_(ss, nid, c, lines, u.nombre, clean_(c.ticket, 300));
    rebuildFin_();
    return { ok: true, id: nid };
  });
}
function addAjuste(pin, p) {
  const u = auth_(pin, 'ajuste');
  return withLock_(() => {
    const ss = ss_(); p = p || {};
    const q = Number(p.q);
    if (prodIds_(ss).indexOf(String(p.i)) < 0) throw new Error('Producto desconocido');
    if (!isFinite(q) || q === 0) throw new Error('La cantidad del ajuste no puede ser 0');
    sheet_(ss, 'Ajustes', AJUSTE_HEADERS).appendRow([validYmd_(p.d) || today_(), String(p.i), q, clean_(p.motivo, 60) || 'Otro', clean_(p.nota, 300), u.nombre, new Date()]);
    rebuildFin_();
    return { ok: true };
  });
}
/** Full count: one Ajuste per product whose count differs from the system stock (motivo 'Inventario completo') */
function addConteo(pin, p) {
  const u = auth_(pin, 'inventario');
  return withLock_(() => {
    const ss = ss_(); p = p || {};
    const prodRows = readProdRows_(ss), compras = groupCompras_(readTab_(ss, 'Compras', COMPRA_HEADERS));
    const items = buildItems_(prodRows, lastCostFrom_(compras));
    const salidas = readTab_(ss, 'Salidas', SAL_HEADERS).filter(r => r[0] !== ''), bit = readTab_(ss, 'Bitácora', BIT_HEADERS), bitBy = {};
    bit.forEach(r => { const k = String(r[0]); (bitBy[k] = bitBy[k] || []).push(r); });
    const moves = buildMoves_({ items: items, purchases: compras, ajustes: readTab_(ss, 'Ajustes', AJUSTE_HEADERS).filter(r => r[1] !== ''), salidas: salidas, bitBy: bitBy,
      productos: prodRows.filter(r => r[0] !== '' && notNo_(r[9])).map(r => ({ id: String(r[0]), campo: r[7] })), today: today_(), M: loadMapeos_(ss) });
    const diffs = countDiffs_(p.counts || {}, items, stockMap_(moves));
    if (diffs.length) {
      const d = validYmd_(p.d) || today_(), now = new Date(), nota = clean_(p.nota, 300) || 'Conteo de inventario';
      const sh = sheet_(ss, 'Ajustes', AJUSTE_HEADERS);
      sh.getRange(sh.getLastRow() + 1, 1, diffs.length, AJUSTE_HEADERS.length).setValues(diffs.map(x => [d, x.i, x.diff, 'Inventario completo', nota, u.nombre, now]));
      rebuildFin_();
    }
    return { ok: true, n: diffs.length };
  });
}
function addComida(pin, p) {
  const u = auth_(pin, 'comida');
  return withLock_(() => {
    p = p || {};
    const nombre = clean_(p.nombre, 80), tipo = /^a/i.test(String(p.tipo)) ? 'almuerzo' : 'desayuno', q = Number(p.cantidad);
    if (!nombre) throw new Error('Falta el nombre');
    if (!isFinite(q) || q <= 0) throw new Error('Cantidad inválida');
    sheet_(ss_(), 'Comida empleado', COMIDA_HEADERS).appendRow([validYmd_(p.d) || today_(), nombre, tipo, q, clean_(p.nota, 200), u.nombre, new Date()]);
    return { ok: true };
  });
}
function markPaid(pin, weekStart, name, monto) {
  const u = auth_(pin, 'pagar');
  return withLock_(() => {
    const ss = ss_(), ws = validYmd_(weekStart), n = clean_(name, 80), m = Number(monto);
    if (!ws || !n) throw new Error('Datos incompletos');
    if (!isFinite(m) || m < 0) throw new Error('Monto inválido');
    const rows = readTab_(ss, 'Pagos', PAGO_HEADERS);
    if (rows.some(r => ymd_(r[0]) === ws && String(r[1]) === n)) return { ok: true, dup: true }; // already paid: never double-count
    sheet_(ss, 'Pagos', PAGO_HEADERS).appendRow([ws, n, m, today_(), u.nombre, '']);
    return { ok: true };
  });
}
function markRev(pin, availabilityPk) {
  const u = auth_(pin, 'revisar');
  return withLock_(() => {
    const ss = ss_(), pk = String(availabilityPk || '');
    if (!readTab_(ss, 'Salidas', SAL_HEADERS).some(r => String(r[0]) === pk)) throw new Error('No encontré la salida');
    const now = new Date();
    sheet_(ss, 'Revisiones', REV_HEADERS).appendRow([pk, u.nombre, now]);
    return { ok: true, by: u.nombre, at: fmtDate_(now, 'HH:mm') };
  });
}
function ensureProdCols_(sh) {
  if (sh.getRange(1, 12).getValue() !== 'Icono') sh.getRange(1, 12).setValue('Icono').setFontWeight('bold');
  if (sh.getRange(1, 13).getValue() !== 'Empaque') sh.getRange(1, 13).setValue('Empaque').setFontWeight('bold');
}
/** prod: {id?, name, icon, group, unit, pack, packName, controlStock, price, min, field, active} → {id} */
function saveProducto(pin, prod) {
  auth_(pin, 'config');
  return withLock_(() => {
    const ss = ss_(), p = prod || {}, name = clean_(p.name, 80);
    if (!name) throw new Error('Falta el nombre del producto');
    const sh = seedTab_(ss, 'Productos', PROD_HEADERS, PROD_SEED);
    ensureProdCols_(sh);
    const n = sh.getLastRow() - 1, ids = n >= 1 ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0])) : [];
    const k = p.id ? ids.indexOf(String(p.id)) : -1;
    if (p.id && k < 0) throw new Error('No encontré el producto');
    const id = p.id ? String(p.id) : slugId_(name, ids);
    const ctl = !!p.controlStock;
    const row = [id, name, clean_(p.group, 40) || (ctl ? 'Bebidas' : 'Consumo directo'), clean_(p.unit, 30) || 'unidad', Math.max(1, numOr_(p.pack, 1)),
      ctl ? 'sí' : 'no', numOr_(p.min, 0), clean_(p.field, 80), numOr_(p.price, 0), p.active === false ? 'no' : 'sí'];
    if (k >= 0) sh.getRange(k + 2, 1, 1, 10).setValues([row]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, 11).setValues([row.concat([''])]);
    const r = k >= 0 ? k + 2 : sh.getLastRow();
    sh.getRange(r, 12, 1, 2).setValues([[clean_(p.icon, 8), clean_(p.packName, 30)]]);
    rebuildFin_();
    return { ok: true, id: id };
  });
}
/** row = sheet row of Tarifas (the app's rate id); values {amt ('' = pendiente), nota?} */
function saveTarifa(pin, row, values) {
  auth_(pin, 'config');
  return withLock_(() => {
    const ss = ss_(), sh = seedTab_(ss, 'Tarifas', TAR_HEADERS, TAR_SEED), r = Number(row), v = values || {};
    if (!(r >= 2 && r <= sh.getLastRow())) throw new Error('Tarifa no encontrada');
    const amt = (v.amt === '' || v.amt === null) ? '' : Number(v.amt);
    if (amt !== '' && (!isFinite(amt) || amt < 0)) throw new Error('Monto inválido');
    sh.getRange(r, 7).setValue(amt);
    if (v.nota !== undefined) sh.getRange(r, 9).setValue(clean_(v.nota, 200));
    rebuildFin_();
    return { ok: true };
  });
}
function savePerm(pin, rol, permiso, valor) {
  auth_(pin, 'config');
  return withLock_(() => {
    const ss = ss_();
    if (rol !== 'admin' && rol !== 'op') throw new Error('Rol inválido');
    if (rol === 'admin' && permiso === 'config') throw new Error('Admin siempre conserva Configuración');
    loadPerms_(ss);
    const sh = ss.getSheetByName('Permisos'), rows = readTab_(ss, 'Permisos', PERM_HEADERS), k = rows.findIndex(x => x[0] === permiso);
    if (k < 0) throw new Error('Permiso desconocido');
    sh.getRange(k + 2, rol === 'admin' ? 3 : 4).setValue(valor ? 'sí' : 'no');
    return { ok: true };
  });
}
function saveTourBarco(pin, itemPk, barco) {
  auth_(pin, 'config');
  return withLock_(() => {
    const ss = ss_(), b = norm_(barco);
    if (!BARCO_LABEL[b]) throw new Error('Tipo de barco inválido');
    ensureBarco_(ss);
    const sh = ss.getSheetByName('Tours'), n = sh.getLastRow() - 1;
    const k = n >= 1 ? sh.getRange(2, 1, n, 1).getValues().findIndex(r => String(r[0]) === String(itemPk)) : -1;
    if (k < 0) throw new Error('Tour no encontrado');
    sh.getRange(k + 2, 7).setValue(b);
    rebuildFin_();
    return { ok: true };
  });
}

/**
 * Admin sets what a FareHarbor thing means. kind: tipo | campo | rol | item; clave = its pk (or 'n:name').
 * valores: tipo {uso} · campo {uso, prod} · rol {tarifa} · item {tipo, barco, fields, bitacora}.
 * Writes Estado OK + who/when, then sets REBUILD_PENDING: the next 15-min trigger rebuilds everything from Raw.
 */
function setMapeo(pin, kind, clave, valores) {
  const u = auth_(pin, 'config');
  return withLock_(() => {
    const ss = ss_(), key = String(clave === null || clave === undefined ? '' : clave).trim();
    if (!key) throw new Error('Falta la clave');
    const val = validateMapeo_(kind, valores, { prodIds: prodIds_(ss), barcos: Object.keys(BARCO_LABEL) });
    const now = new Date();
    const find = (sh) => { const n = sh.getLastRow() - 1; return n >= 1 ? sh.getRange(2, 1, n, 1).getValues().findIndex(r => String(r[0]) === key) + 2 : 0; };
    const miss = () => { throw new Error('No encontré esto en la lista (¿ya cambió?). Actualiza la app.'); };
    if (kind === 'item') {
      ensureBarco_(ss); ensureTourCols_(ss);
      const sh = ss.getSheetByName('Tours'); if (!sh) miss();
      const r = find(sh); if (r < 2) miss();
      const row = sh.getRange(r, 1, 1, TOURS_COLS).getValues()[0];
      row[2] = val.tipo; row[3] = val.fields; row[4] = val.bitacora; row[6] = val.barco; row[7] = ESTADO_OK;
      row[5] = appendNote_(String(row[5] || ''), 'Configurado por ' + u.nombre + ' ' + today_());
      sh.getRange(r, 1, 1, TOURS_COLS).setValues([row]);
    } else {
      const d = { tipo: { tab: CT_TAB, h: CT_HEADERS, cols: [[3, 'uso']], estado: 4, por: 8 },
        campo: { tab: CF_TAB, h: CF_HEADERS, cols: [[3, 'uso'], [4, 'prod']], estado: 5, por: 10 },
        rol: { tab: ROL_TAB, h: ROL_HEADERS, cols: [[4, 'tarifa']], estado: 5, por: 9 } }[kind];
      const sh = ss.getSheetByName(d.tab); if (!sh) miss();
      const r = find(sh); if (r < 2) miss();
      const row = sh.getRange(r, 1, 1, d.h.length).getValues()[0];
      d.cols.forEach(c => { row[c[0] - 1] = val[c[1]]; });
      row[d.estado - 1] = ESTADO_OK; row[d.por - 1] = u.nombre; row[d.por] = now;
      sh.getRange(r, 1, 1, d.h.length).setValues([row]);
    }
    setRebuildPending_();
    return { ok: true, rebuildPending: true };
  });
}

// ---------------- One-off migration (owner runs it once from the editor) ----------------
function migrate20261124() {
  return withLock_(() => {
    const ss = ss_(), log = [];
    const tar = seedTab_(ss, 'Tarifas', TAR_HEADERS, TAR_SEED);
    const read = () => tar.getLastRow() >= 2 ? tar.getRange(2, 1, tar.getLastRow() - 1, TAR_HEADERS.length).getValues() : [];
    // 1) Ignacio Arceo: 150 por tour (tiene sueldo fijo)
    let plan = planTarifasMigration_(read());
    if (plan.ignacio >= 0) { tar.getRange(plan.ignacio + 2, 7).setValue(150); tar.getRange(plan.ignacio + 2, 9).setValue('Por tour (tiene sueldo fijo)'); log.push('Ignacio Arceo: Monto=150'); }
    else { tar.insertRowBefore(2); tar.getRange(2, 1, 1, 9).setValues([['*', '*', '', '', '', 'Ignacio Arceo', 150, 'salida', 'Por tour (tiene sueldo fijo)']]); log.push('Ignacio Arceo: fila creada con 150'); }
    // 2) Hobie rows right after the monocasco rows (only the missing ones)
    plan = planTarifasMigration_(read());
    if (plan.toInsert.length) {
      tar.insertRowsAfter(plan.insertAfter + 2, plan.toInsert.length);
      tar.getRange(plan.insertAfter + 3, 1, plan.toInsert.length, 9).setValues(plan.toInsert);
      log.push('Tarifas Hobie agregadas: ' + plan.toInsert.length);
    } else log.push('Tarifas Hobie: ya existían');
    // 3) Private Healing Boat Tour (696746) = La Ramona, paga como velero (catamarán)
    if (ss.getSheetByName('Tours')) {
      ensureBarco_(ss);
      const t = ss.getSheetByName('Tours'), n = t.getLastRow() - 1;
      const k = n >= 1 ? t.getRange(2, 1, n, 1).getValues().findIndex(r => String(r[0]) === '696746') : -1;
      if (k >= 0) {
        t.getRange(k + 2, 7).setValue('catamaran');
        if (!t.getRange(k + 2, 6).getValue()) t.getRange(k + 2, 6).setValue('La Ramona');
        log.push('Tour 696746: Barco=catamaran');
      } else log.push('Tour 696746 aún no está en Tours (llega con su primera reserva). Vuelve a correr esta función entonces.');
    } else log.push('No existe la pestaña Tours todavía.');
    rebuildFin_();
    log.push('Finanzas reconstruidas');
    Logger.log(log.join('\n'));
    return log.join('\n');
  });
}

if (typeof module !== 'undefined') module.exports = {
  pinStr_, findUser_, permsFromRows_, permOk_, guessIcon_, buildItems_, groupCompras_, lastCostFrom_, priceLogFrom_, buildMoves_, stockMap_, countDiffs_,
  cleanLines_, slugId_, rateLabel_, buildRates_, latestRevs_, roleLabel_, bitQty_, extrasText_, ciFrom_, buildDeps_, buildPend_, fieldsFromBookings_, saludAlerts_, setMapeo, planTarifasMigration_, pluralEs_, appendNote_,
  login, getData, refreshFin, windowTest_, staleFin_, addCompra, anularCompra, editCompra, addAjuste, addConteo, addComida, markPaid, markRev, saveProducto, saveTarifa, savePerm, saveTourBarco, migrate20261124
};

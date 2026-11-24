/**
 * Adventure Lab Ops – DB
 * ----------------------------------------------------------------
 * Step 1: webhook intake → Raw (append-only) + Errores
 * Step 2: Reservas → one row per booking, latest event wins
 * Step 3: Salidas · Bitácora · Tripulación (one departure = one availability ID)
 *         + Tours (config: item → tipo → campo de personas)
 * Step 4: Ingresos. Webhook gives an estimate; Comercial's daily FareHarbor
 *         report ("Net Revenue Collected") replaces it with the exact figure.
 *         Cargas = log of every upload. Control días = gaps check.
 * Step 5: Productos/Tarifas (config) · Compras/Ajustes/Comida empleado/Pagos (logs)
 *         → Stock, Eventuales, Resumen semanal, Externos, Costos salida (calculated).
 *
 * Rules
 * - Raw is never edited or deleted. Every other tab is calculated and can be
 *   rebuilt with "Ops DB → Reconstruir todo desde Raw".
 * - Duplicates (same payload hash) are flagged in Raw and ignored.
 * - "rebooked" = replaced by a new booking number. Never counts; final.
 * - "cancelled" does not count but stays visible.
 * - Pax: compartido = customers excluding OPS types; privado = "Number of
 *   people" custom field of the item (Tours tab); renta = people field if
 *   filled, else 1 per rental unit.
 * Money in MXN (FareHarbor sends cents).
 */

const MAX_CELL = 45000;
const TZ = 'America/Cancun';
const RAW_HEADERS = ['Recibido', 'Hash', 'Duplicado', 'Booking pk', 'Booking uuid', 'Status',
  'Availability pk', 'Item pk', 'Item', 'Inicio', 'Customer types', 'JSON'];
const RES_HEADERS = ['Booking pk', 'Display ID', 'Estado', 'Cuenta', 'Reemplazada por (uuid)', 'Reemplaza a (uuid)',
  'Availability pk', 'Item pk', 'Item', 'Fecha', 'Hora', 'Inicio', 'Fin', 'Tipo OPS', 'Pax', 'Unidades',
  'Customer types', 'Contacto', 'Afiliado', 'Origen', 'Creada por', 'Nota', 'Total (MXN)', 'Pagado (MXN)',
  'Invoice (MXN)', 'Creada', 'Último evento', 'Booking uuid', 'Alerta pax', 'Fila Raw', 'Ingreso neto (MXN)', 'Fuente ingreso'];
const SAL_HEADERS = ['Availability pk', 'Item pk', 'Item', 'Tipo tour', 'Fecha', 'Hora', 'Inicio', 'Fin',
  'Reservas activas', 'Pax', 'Unidades', 'Bitácora', 'Reserva salida', 'Reserva regreso', 'Tripulación',
  'Alertas', 'Actualizado', 'Ingreso neto (MXN)', 'Fuente ingreso'];
const ING_HEADERS = ['Booking pk', 'Ingreso neto (MXN)', 'Fecha tour', 'Archivo', 'Subido', 'Fila reporte'];
const CARGA_HEADERS = ['Subido', 'Archivo', 'Hash', 'Duplicado', 'Filas', 'Reservas encontradas', 'No encontradas',
  'Fechas', 'Notas'];
const CTRL_HEADERS = ['Fecha', 'Día', 'Salidas', 'Reservas activas', 'Ingreso exacto', 'Ingreso estimado', 'Estado'];
const CTRL_FROM = '2026-11-16';
const REPORTS_FOLDER = 'Adventure Lab Ops – Reportes';
const BIT_HEADERS = ['Availability pk', 'Fecha', 'Hora', 'Item', 'Booking pk', 'Tipo', 'Campo', 'Field pk',
  'Cantidad', 'Texto'];
const CREW_HEADERS = ['Availability pk', 'Fecha', 'Hora', 'Item', 'Rol', 'Nombre', 'Usuario', 'Nota'];
const TOURS_HEADERS = ['Item pk', 'Item', 'Tipo (compartido/privado/renta/otro)', 'Campo personas (field pks, coma)',
  'Lleva bitácora (sí/no)', 'Notas'];

// Tours seed (from FareHarbor research 23 Nov 2026). Editable later in the Tours tab.
const TOURS_SEED = [
  [244132, 'Private Boat Tour', 'privado', '876388', 'sí', 'Check: QTY · Seats · N debe ser igual'],
  [550017, 'Private Catamaran Experience', 'privado', '2021330', 'sí', 'Ignorar CAT · Hasta 10 (tamaño del barco)'],
  [398151, 'Pontón Privado [AMNH]', 'privado', '1203173', 'no', ''],
  [706421, 'Monocasco Privado [AMNH]', 'privado', '1463814', 'no', ''],
  [337344, 'Velero Monocasco Privado [HBTS]', 'privado', '1463805', 'no', ''],
  [337346, 'Catamarán Privado [HBTS]', 'privado', '1558483', 'no', ''],
  [694472, 'Private Rooftop Catamaran', 'privado', '1865812', 'no', ''],
  [244136, 'Private Hobie Cat Sailing Tour', 'privado', '1523266', 'no', ''],
  [398392, 'Pontón Privado [MIA]', 'privado', '1521856,1521872', 'no', 'sin reservas al revisar'],
  [398153, 'Private Sunrise SUP [AMNH]', 'privado', '1216436', 'no', 'sin reservas al revisar'],
  [714148, 'Catamarán Privado [AMHN]', 'privado', '1898933,1898935,1898941', 'no', 'sin reservas al revisar'],
  [337347, 'Pontón Privado [HBTS]', 'privado', '1463782,1463762,1463755', 'no', 'sin reservas al revisar'],
  [243654, 'Private Paddleboard Tour', 'privado', '876401,2010010,1884137,1893239,1939722', 'no', 'sin reservas al revisar'],
  [244597, 'Private Monohull Sailing Tour', 'privado', '878144,1886433', 'no', 'sin reservas al revisar'],
  [703332, 'Monocasco Privado MIA', 'privado', '', 'no', 'campo por confirmar'],
  [695580, 'Catamaran Privado MIA', 'privado', '', 'no', 'campo por confirmar'],
  [708835, 'Private Rooftop Catamaran [HBTS]', 'privado', '', 'no', 'campo por confirmar'],
  [703717, 'Private Boat Tour [Carmelita]', 'privado', '', 'no', 'campo por confirmar'],
  [258806, 'Bacalar Lagoon Boat Tour', 'compartido', '', 'sí', ''],
  [274513, 'Shared Sailing Tour', 'compartido', '', 'sí', ''],
  [244134, 'Sunrise Paddleboard Tour', 'compartido', '', 'no', ''],
  [398421, 'Sunset Paddleboard Tour', 'compartido', '', 'no', ''],
  [689738, 'Sunrise Kayak Tour', 'compartido', '', 'no', ''],
  [185852, 'Sunset Kayak', 'compartido', '', 'no', ''],
  [723914, 'Yak day pass', 'compartido', '', 'no', ''],
  [721266, 'Carmelita Day Pass', 'compartido', '', 'no', ''],
  [258044, 'Kayak Rental - The Yak Lakehouse', 'renta', '720458', 'no', '1 por renta si no hay campo'],
  [703712, 'Kayak Rental - Carmelita Lagoon Club', 'renta', '', 'no', ''],
  [258037, 'Paddleboard Rental - The Yak Lakehouse', 'renta', '', 'no', ''],
  [703706, 'Paddleboard Rental - Carmelita Lagoon Club', 'renta', '', 'no', '']
];

// ---------------- Webhook ----------------
function doPost(e) {
  const body = (e && e.postData && e.postData.contents) || '';
  if (!body) return ContentService.createTextOutput('empty'); // manual runs / pings write nothing
  // Ops app (GitHub Pages) calls: {type:'api', fn, args}. Handled before the webhook lock (app.gs takes its own lock).
  if (body.charAt(0) === '{' && body.indexOf('"type":"api"') > 0) {
    let p = null; try { p = JSON.parse(body); } catch (err) {}
    if (p && p.type === 'api') return apiResponse_(p);
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const raw = sheet_(ss, 'Raw', RAW_HEADERS);
    const now = new Date();
    const hash = sha1_(body);

    let parsed = {};
    try { parsed = JSON.parse(body) || {}; } catch (err) { logError_(ss, 'JSON inválido', err, body); }
    if (parsed.type === 'reporte') { // upload from the app (not FareHarbor): never goes to Raw
      const key = PropertiesService.getScriptProperties().getProperty('APP_KEY');
      if (key && parsed.key !== key) return ContentService.createTextOutput('{"ok":false,"error":"clave"}');
      const res = importReport_(ss, String(parsed.csv || ''), String(parsed.archivo || 'app'));
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
    const b = parsed.booking || {};
    const av = b.availability || {};
    const item = av.item || {};

    const dup = isDuplicate_(raw, hash);
    let jsonCell = body;
    if (body.length > MAX_CELL) jsonCell = 'DRIVE:' + saveToDrive_(b.pk, now, body);

    raw.appendRow([now, hash, dup ? 'sí' : '', b.pk || '', b.uuid || '', b.status || '',
      av.pk || '', item.pk || '', item.name || '', av.start_at || '', typeSummary_(b), jsonCell]);
    const rawRow = raw.getLastRow();

    if (!dup && b.pk) {
      try {
        const tours = loadTours_(ss);
        const ing = loadIngresos_(ss);
        upsertReserva_(ss, b, now, rawRow, tours, ing);
        if (av.pk) recomputeSalidas_(ss, [String(av.pk)], tours, ing);
      } catch (err) { logError_(ss, 'Derivados', err, body); }
    }
  } catch (err) {
    try { logError_(SpreadsheetApp.getActiveSpreadsheet(), 'doPost', err, body); } catch (e2) {}
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('Adventure Lab Ops DB: OK');
}

// ---------------- Menu ----------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ops DB')
    .addItem('Reconstruir todo desde Raw', 'rebuildAll')
    .addItem('Reconstruir solo Reservas', 'rebuildReservas')
    .addItem('Importar reportes nuevos de Drive', 'importFromDrive')
    .addItem('Actualizar Control días', 'rebuildControl')
    .addItem('Actualizar stock, eventuales y costos', 'rebuildFinanzas')
    .addToUi();
}

// ---------------- Tours (config) ----------------
function loadTours_(ss) {
  let sh = ss.getSheetByName('Tours');
  if (!sh) {
    sh = ss.insertSheet('Tours');
    sh.getRange(1, 1, 1, TOURS_HEADERS.length).setValues([TOURS_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, TOURS_SEED.length, TOURS_HEADERS.length).setValues(TOURS_SEED);
  }
  const map = {};
  const last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, TOURS_HEADERS.length).getValues().forEach(r => {
      if (!r[0]) return;
      map[String(r[0])] = {
        tipo: String(r[2] || '').toLowerCase().trim(),
        fields: String(r[3] || '').split(',').map(x => x.trim()).filter(String),
        bitacora: /^s/i.test(String(r[4] || ''))
      };
    });
  }
  return map;
}

// Adds unknown items to Tours with a guessed type, so nothing is silently wrong
function ensureTour_(ss, tours, b) {
  const item = (b.availability || {}).item || {};
  const k = String(item.pk || '');
  if (!k || tours[k]) return tours[k];
  const names = (b.customers || []).map(c => custType_(c));
  const guess = names.some(n => /private|privad/i.test(n)) ? 'privado' : 'compartido';
  sheet_(ss, 'Tours', TOURS_HEADERS).appendRow([item.pk, item.name || '', guess, '', 'no', 'AUTO: revisar tipo y campo de personas']);
  tours[k] = { tipo: guess, fields: [], bitacora: false, auto: true };
  return tours[k];
}

// ---------------- Pure helpers (no Sheets) ----------------
function custType_(c) {
  return (((c || {}).customer_type_rate || {}).customer_type || {}).singular || '';
}
function isOps_(t) { return /^OPS\s*·/i.test(t); }
function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function cfvNumber_(v) {
  // dropdowns: display_value is the option text ("6"); counts: value is the number
  const d = num_(v.display_value);
  return d !== null ? d : num_(v.value);
}
function allCfvs_(b) {
  const out = (b.custom_field_values || []).map(v => ({ v: v, level: 'booking', ctype: '' }));
  (b.customers || []).forEach(c => (c.custom_field_values || []).forEach(v => out.push({ v: v, level: 'customer', ctype: custType_(c) })));
  return out;
}
function cfName_(v) { return ((v.custom_field || {}).name) || v.name || ''; }
function cfPk_(v) { return String(((v.custom_field || {}).pk) || ''); }

/** Pax for one booking → {pax, unidades, alerta} */
function bookingPax_(b, tour) {
  const cust = (b.customers || []).filter(c => !isOps_(custType_(c)));
  const unidades = cust.length;
  const tipo = (tour && tour.tipo) || 'compartido';
  if (!unidades) return { pax: 0, unidades: 0, alerta: '' };
  if (tipo === 'compartido' || tipo === 'otro') return { pax: unidades, unidades: unidades, alerta: '' };

  const fields = (tour && tour.fields) || [];
  const cfvs = allCfvs_(b);
  let people = null;
  cfvs.forEach(x => {
    const pk = cfPk_(x.v), nm = cfName_(x.v);
    const isPeople = fields.length ? fields.indexOf(pk) >= 0
      : /number of people|n[uú]mero de personas|cantidad de personas|# de personas|people in/i.test(nm);
    if (isPeople) { const n = cfvNumber_(x.v); if (n !== null && n > 0) people = (people || 0) + n; }
  });
  let seats = null;
  cfvs.forEach(x => {
    const nm = cfName_(x.v);
    if (/^QTY\s*·\s*Seats/i.test(nm)) { const n = num_(x.v.value); if (n !== null && n > 0) seats = (seats || 0) + n; }
  });

  if (tipo === 'renta') return { pax: people !== null ? people : unidades, unidades: unidades, alerta: '' };
  // privado
  if (people === null && seats === null) return { pax: '', unidades: unidades, alerta: 'Falta # de personas' };
  if (people === null) return { pax: seats, unidades: unidades, alerta: 'Solo Seats (falta campo personas)' };
  if (seats !== null && seats !== people) return { pax: people, unidades: unidades, alerta: 'Personas (' + people + ') ≠ Seats (' + seats + ')' };
  return { pax: people, unidades: unidades, alerta: '' };
}

// Estimated net revenue until Comercial's report replaces it:
// affiliate → invoice price; direct → amount paid (card fee not deducted)
function netEstimate_(b) {
  const c = v => (v === undefined || v === null || v === '') ? 0 : Number(v) / 100;
  return b.affiliate_company ? c(b.invoice_price) : c(b.amount_paid);
}

function opsType_(b) {
  const t = (b.customers || []).map(custType_);
  let o = '';
  if (t.some(x => /OPS\s*·\s*Salida/i.test(x))) o = 'Salida';
  if (t.some(x => /OPS\s*·\s*Regreso/i.test(x))) o = o ? o + '+Regreso' : 'Regreso';
  return o;
}

function fmtDate_(iso, pattern) {
  if (!iso) return '';
  const d = new Date(iso);
  return (typeof Utilities !== 'undefined') ? Utilities.formatDate(d, TZ, pattern)
    : (pattern === 'HH:mm' ? String(iso).slice(11, 16) : String(iso).slice(0, 10));
}

/**
 * One departure from its bookings (latest version of each).
 * list: [{b, status, row}] → {salida:[], bit:[[...]], crew:[[...]]}
 */
function computeSalida_(avPk, list, tours, now, ing) {
  ing = ing || {};
  const first = (list[0] || {}).b || {};
  const av = first.availability || {};
  const item = av.item || {};
  const tour = tours[String(item.pk)] || { tipo: '?', fields: [], bitacora: false };
  const fecha = fmtDate_(av.start_at, 'yyyy-MM-dd'), hora = fmtDate_(av.start_at, 'HH:mm');
  const active = list.filter(x => x.b.status === 'booked');
  const opsBk = active.filter(x => opsType_(x.b));
  const custBk = active.filter(x => !opsType_(x.b));

  let pax = 0, unidades = 0, paxPend = false, ingreso = 0, estimados = 0;
  custBk.forEach(x => {
    const exact = ing[String(x.b.pk)];
    if (exact !== undefined) ingreso += exact; else { ingreso += netEstimate_(x.b); estimados++; }
  });
  const alerts = [];
  custBk.forEach(x => {
    const p = bookingPax_(x.b, tour);
    unidades += p.unidades;
    if (p.pax === '') paxPend = true; else pax += p.pax;
    if (p.alerta) alerts.push('#' + x.b.pk + ' ' + p.alerta);
  });

  const sal = opsBk.filter(x => /Salida/.test(opsType_(x.b)));
  const reg = opsBk.filter(x => /Regreso/.test(opsType_(x.b)));
  if (sal.length > 1) alerts.push('Más de una reserva de salida');
  if (reg.length > 1) alerts.push('Más de una reserva de regreso');
  let bitacora = 'Sin bitácora';
  if (sal.length && reg.length) bitacora = 'Completa';
  else if (sal.length) bitacora = 'Falta regreso';
  else if (reg.length) bitacora = 'Falta salida';
  if (!opsBk.length && !tour.bitacora) bitacora = 'No aplica';

  // Bitácora lines
  const bit = [];
  opsBk.forEach(x => {
    const tipo = /Salida/.test(opsType_(x.b)) ? 'Salida' : 'Regreso';
    allCfvs_(x.b).forEach(c => {
      if (c.level !== 'customer' || !isOps_(c.ctype)) return;
      const n = cfvNumber_(c.v);
      const txt = (c.v.display_value !== undefined && c.v.display_value !== null) ? String(c.v.display_value) : String(c.v.value || '');
      if (n === null && !txt) return;
      bit.push([avPk, fecha, hora, item.name || '', x.b.pk, tipo, cfName_(c.v), cfPk_(c.v),
        n === null ? '' : n, n === null ? txt : '']);
    });
  });

  // Crew: from the booking received last (crew lives on the departure)
  const latest = list.slice().sort((a, b) => (a.row || 0) - (b.row || 0)).pop();
  const crewList = (((latest || {}).b || {}).availability || {}).crew_members || [];
  const crew = crewList.map(m => [avPk, fecha, hora, item.name || '',
    (m.role && m.role.short_name) || '', (m.user && m.user.name) || '', (m.user && m.user.username) || '', m.note || '']);
  crew.forEach(c => { if (!c[4]) alerts.push('Falta rol: ' + (c[5] || c[6] || '?')); });

  const salida = [avPk, item.pk || '', item.name || '', tour.tipo || '?', fecha, hora, av.start_at || '', av.end_at || '',
    custBk.length, paxPend ? (pax ? pax + ' + pendiente' : 'pendiente') : pax, unidades, bitacora,
    sal.map(x => x.b.pk).join(', '), reg.map(x => x.b.pk).join(', '),
    crew.map(c => (c[4] || 'sin rol') + ': ' + (c[5] || c[6])).join(' · '),
    alerts.join(' | '), now, Math.round(ingreso * 100) / 100, estimados ? 'estimado' : ''];
  return { salida: salida, bit: bit, crew: crew, hasCustomers: custBk.length > 0 };
}

// ---------------- Reservas ----------------
function reservaRow_(b, eventTime, rawRow, tours, ing) {
  ing = ing || {};
  const av = b.availability || {};
  const item = av.item || {};
  const tour = tours[String(item.pk)];
  const status = b.status || '';
  const ops = opsType_(b);
  const p = ops ? { pax: 0, unidades: 0, alerta: '' } : bookingPax_(b, tour);
  return [
    b.pk, b.display_id || '', status, status === 'booked' ? 'sí' : 'no',
    b.rebooked_to || '', b.rebooked_from || '',
    av.pk || '', item.pk || '', item.name || '',
    fmtDate_(av.start_at, 'yyyy-MM-dd'), fmtDate_(av.start_at, 'HH:mm'),
    av.start_at || '', av.end_at || '',
    ops, p.pax, p.unidades,
    typeSummary_(b),
    (b.contact && b.contact.name) || '',
    (b.affiliate_company && b.affiliate_company.name) || '',
    b.source_type || '',
    (b.booked_by && b.booked_by.name) || '',
    b.note || '',
    money_(b.receipt_total), money_(b.amount_paid), money_(b.invoice_price),
    b.created_at || '', eventTime, b.uuid || '', p.alerta, rawRow || '',
    ...incomeCells_(b, status, ops, ing)
  ];
}

// [Ingreso neto, Fuente]: exact from report (no label) or estimate
function incomeCells_(b, status, ops, ing) {
  if (status !== 'booked' || ops) return [0, ''];
  const exact = ing[String(b.pk)];
  return exact !== undefined ? [exact, ''] : [netEstimate_(b), 'estimado'];
}

function upsertReserva_(ss, b, eventTime, rawRow, tours, ing) {
  ensureTour_(ss, tours, b);
  const sh = sheet_(ss, 'Reservas', RES_HEADERS);
  const row = reservaRow_(b, eventTime, rawRow, tours, ing);
  const n = Math.max(sh.getLastRow() - 1, 1);
  const found = sh.getRange(2, 1, n, 1).createTextFinder(String(b.pk)).matchEntireCell(true).findNext();
  if (found) {
    const r = found.getRow();
    const prev = sh.getRange(r, 1, 1, RES_HEADERS.length).getValues()[0];
    if (prev[2] === 'rebooked' && row[2] !== 'rebooked') { row[2] = prev[2]; row[3] = prev[3]; row[4] = prev[4] || row[4]; }
    sh.getRange(r, 1, 1, RES_HEADERS.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

// Reads Raw → latest booking per pk: {pk: {b, t, row}}
function latestFromRaw_(ss) {
  const raw = sheet_(ss, 'Raw', RAW_HEADERS);
  const last = raw.getLastRow();
  const latest = {};
  if (last < 2) return latest;
  const vals = raw.getRange(2, 1, last - 1, RAW_HEADERS.length).getValues();
  vals.forEach((v, i) => {
    if (v[2] === 'sí' || !v[3]) return; // duplicate or empty
    let json = String(v[11] || '');
    try {
      if (json.indexOf('DRIVE:') === 0) json = DriveApp.getFileById(json.slice(6)).getBlob().getDataAsString();
      const b = (JSON.parse(json) || {}).booking || {};
      if (!b.pk) return;
      const prev = latest[b.pk];
      if (prev && prev.b.status === 'rebooked' && b.status !== 'rebooked') {
        b.status = 'rebooked'; b.rebooked_to = b.rebooked_to || prev.b.rebooked_to;
      }
      latest[b.pk] = { b: b, t: v[0], row: i + 2 };
    } catch (err) { logError_(ss, 'leer Raw fila ' + (i + 2), err, json); }
  });
  return latest;
}

function rebuildReservas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tours = loadTours_(ss);
  const ing = loadIngresos_(ss);
  const latest = latestFromRaw_(ss);
  Object.values(latest).forEach(x => ensureTour_(ss, tours, x.b));
  const rows = Object.values(latest).map(x => reservaRow_(x.b, x.t, x.row, tours, ing));
  rows.sort((a, b) => String(a[11]).localeCompare(String(b[11])) || (a[0] - b[0]));
  writeTab_(ss, 'Reservas', RES_HEADERS, rows);
  return latest;
}

// ---------------- Salidas / Bitácora / Tripulación ----------------
function rebuildAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const latest = rebuildReservas();
  const tours = loadTours_(ss);
  const ing = loadIngresos_(ss);
  const byAv = {};
  Object.values(latest).forEach(x => {
    const k = String(((x.b.availability || {}).pk) || '');
    if (!k) return;
    (byAv[k] = byAv[k] || []).push({ b: x.b, row: x.row });
  });
  const now = new Date();
  const sal = [], bit = [], crew = [];
  Object.keys(byAv).forEach(k => {
    const r = computeSalida_(k, byAv[k], tours, now, ing);
    sal.push(r.salida); r.bit.forEach(x => bit.push(x)); r.crew.forEach(x => crew.push(x));
  });
  sal.sort((a, b) => String(a[6]).localeCompare(String(b[6])));
  writeTab_(ss, 'Salidas', SAL_HEADERS, sal);
  writeTab_(ss, 'Bitácora', BIT_HEADERS, bit);
  writeTab_(ss, 'Tripulación', CREW_HEADERS, crew);
  rebuildFinanzas(); // also refreshes Control días
  return sal.length;
}

// Recompute only some departures (used by each webhook)
function recomputeSalidas_(ss, avPks, tours, ing) {
  const res = sheet_(ss, 'Reservas', RES_HEADERS);
  const last = res.getLastRow();
  if (last < 2) return;
  const rows = res.getRange(2, 1, last - 1, RES_HEADERS.length).getValues();
  const raw = sheet_(ss, 'Raw', RAW_HEADERS);
  const now = new Date();
  avPks.forEach(avPk => {
    const list = [];
    rows.forEach(r => {
      if (String(r[6]) !== String(avPk) || !r[29]) return;
      let json = String(raw.getRange(Number(r[29]), 12).getValue() || '');
      if (json.indexOf('DRIVE:') === 0) json = DriveApp.getFileById(json.slice(6)).getBlob().getDataAsString();
      try {
        const b = JSON.parse(json).booking;
        if (r[2] === 'rebooked') b.status = 'rebooked';
        list.push({ b: b, row: Number(r[29]) });
      } catch (err) { logError_(ss, 'recompute ' + avPk, err, json); }
    });
    if (!list.length) return;
    const out = computeSalida_(String(avPk), list, tours, now, ing);
    replaceRows_(ss, 'Salidas', SAL_HEADERS, avPk, [out.salida]);
    replaceRows_(ss, 'Bitácora', BIT_HEADERS, avPk, out.bit);
    replaceRows_(ss, 'Tripulación', CREW_HEADERS, avPk, out.crew);
  });
}

// Replace all rows whose first column == key (derived tabs only)
function replaceRows_(ss, name, headers, key, newRows) {
  const sh = sheet_(ss, name, headers);
  const last = sh.getLastRow();
  let keep = [];
  if (last >= 2) keep = sh.getRange(2, 1, last - 1, headers.length).getValues().filter(r => String(r[0]) !== String(key));
  const all = keep.concat(newRows);
  if (last >= 2) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, headers.length).setValues(all);
}

function writeTab_(ss, name, headers, rows) {
  let sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

// ---------------- Step 4: Ingresos (Comercial's report) ----------------
// Ingresos tab = every booking line ever imported (append-only). Latest import wins.
function loadIngresos_(ss) {
  const sh = ss.getSheetByName('Ingresos');
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (r[0] !== '' && r[1] !== '') map[String(r[0])] = Number(r[1]);
  });
  return map;
}

function parseMoney_(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim();
  if (!s) return null;
  const neg = /\(.*\d.*\)/.test(s) || /^[^\d]*-/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/,\d{2}$/.test(s) && s.indexOf('.') >= 0 && s.lastIndexOf('.') < s.lastIndexOf(',')) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,50
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return isNaN(n) ? null : (neg ? -n : n);
}

// Minimal RFC-4180 CSV parser (quotes, commas or semicolons, BOM)
function parseCsv_(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/** rows (2D) → {lines:[{id, net, line}], error} */
function parseReport_(rows) {
  let h = -1, netCol = -1, idCol = -1;
  for (let i = 0; i < Math.min(rows.length, 15) && h < 0; i++) {
    const r = rows[i].map(c => String(c).trim());
    const n = r.findIndex(c => /net revenue collected/i.test(c));
    if (n >= 0) { h = i; netCol = n; }
  }
  if (h < 0) return { lines: [], error: 'No encontré la columna "Net Revenue Collected"' };
  const hdr = rows[h].map(c => String(c).trim());
  const idTests = [/^#$/, /^booking\s*(#|id|number|pk)$/i, /^(id|pk)$/i, /^booking$/i, /booking.*(#|id)/i];
  for (const t of idTests) { idCol = hdr.findIndex(c => t.test(c)); if (idCol >= 0) break; }
  if (idCol < 0) return { lines: [], error: 'No encontré la columna del número de reserva (#, Booking ID…)' };
  const lines = [];
  for (let i = h + 1; i < rows.length; i++) {
    const id = String(rows[i][idCol] || '').replace(/\D/g, '');
    const net = parseMoney_(rows[i][netCol]);
    if (!id || net === null) continue; // totals / blank lines
    lines.push({ id: id, net: net, line: i + 1 });
  }
  return { lines: lines, error: '' };
}

function importReport_(ss, input, archivo) {
  const rows = Array.isArray(input) ? input : parseCsv_(input);
  const hash = sha1_(JSON.stringify(rows));
  const now = new Date();
  const cargas = sheet_(ss, 'Cargas', CARGA_HEADERS);
  const prev = cargas.getLastRow() >= 2 ? cargas.getRange(2, 3, cargas.getLastRow() - 1, 1).getValues().map(r => r[0]) : [];
  if (prev.indexOf(hash) >= 0) {
    cargas.appendRow([now, archivo, hash, 'sí', rows.length, 0, 0, '', 'Mismo archivo ya subido: no cambia nada']);
    return { ok: true, duplicado: true };
  }
  const p = parseReport_(rows);
  if (p.error) {
    cargas.appendRow([now, archivo, hash, '', rows.length, 0, 0, '', 'ERROR: ' + p.error]);
    return { ok: false, error: p.error };
  }

  // Reservas: pk / display id → row info
  const res = sheet_(ss, 'Reservas', RES_HEADERS);
  const rl = res.getLastRow();
  const rv = rl >= 2 ? res.getRange(2, 1, rl - 1, RES_HEADERS.length).getValues() : [];
  const idx = {};
  rv.forEach((r, i) => { idx[String(r[0])] = i; const d = String(r[1]).replace(/\D/g, ''); if (d && idx[d] === undefined) idx[d] = i; });

  // Sum lines per booking (a report can list one line per customer)
  const sums = {}, count = {}, firstLine = {};
  const missing = [];
  p.lines.forEach(l => {
    const i = idx[l.id];
    if (i === undefined) { missing.push(l.id); return; }
    const pk = String(rv[i][0]);
    sums[pk] = (sums[pk] || 0) + l.net; count[pk] = (count[pk] || 0) + 1;
    if (!firstLine[pk]) firstLine[pk] = l.line;
  });
  const pks = Object.keys(sums);
  const ingRows = pks.map(pk => [Number(pk), Math.round(sums[pk] * 100) / 100, rv[idx[pk]][9], archivo, now, firstLine[pk]]);
  const ingSh = sheet_(ss, 'Ingresos', ING_HEADERS);
  if (ingRows.length) ingSh.getRange(ingSh.getLastRow() + 1, 1, ingRows.length, ING_HEADERS.length).setValues(ingRows);

  // Update Reservas income cells + recompute touched departures
  const ing = loadIngresos_(ss);
  const avs = {};
  const fechas = {};
  pks.forEach(pk => {
    const i = idx[pk], r = rv[i];
    const cells = (r[3] === 'sí' && !r[13]) ? [ing[pk], ''] : [0, ''];
    res.getRange(i + 2, 31, 1, 2).setValues([cells]);
    if (r[6]) avs[String(r[6])] = true;
    if (r[9]) fechas[fmtCell_(r[9])] = true;
  });
  const tours = loadTours_(ss);
  recomputeSalidas_(ss, Object.keys(avs), tours, ing);
  rebuildControl();

  const multi = pks.filter(pk => count[pk] > 1).length;
  const notes = [];
  if (missing.length) notes.push('No encontradas en la base: ' + missing.slice(0, 20).join(', ') + (missing.length > 20 ? '…' : ''));
  if (multi) notes.push(multi + ' reservas con varias líneas (sumadas)');
  cargas.appendRow([now, archivo, hash, '', p.lines.length, pks.length, missing.length,
    Object.keys(fechas).sort().join(', '), notes.join(' | ')]);
  return { ok: true, encontradas: pks.length, noEncontradas: missing.length, fechas: Object.keys(fechas).sort() };
}

function fmtCell_(v) {
  return (v instanceof Date) ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v);
}

// Comercial drops the FareHarbor export (CSV or Google Sheet) in the Drive folder;
// this imports new ones and moves them to "Importados" (nothing is deleted).
function importFromDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const it = DriveApp.getFoldersByName(REPORTS_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(REPORTS_FOLDER);
  const di = folder.getFoldersByName('Importados');
  const done = di.hasNext() ? di.next() : folder.createFolder('Importados');
  const files = folder.getFiles();
  const out = [];
  while (files.hasNext()) {
    const f = files.next();
    const mt = f.getMimeType();
    let rows = null;
    if (mt === MimeType.GOOGLE_SHEETS) rows = SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getDisplayValues();
    else if (mt === MimeType.CSV || /\.csv$/i.test(f.getName()) || mt === 'text/plain') rows = parseCsv_(f.getBlob().getDataAsString('UTF-8'));
    else { out.push(f.getName() + ': formato no soportado (sube CSV)'); continue; }
    const r = importReport_(ss, rows, f.getName());
    out.push(f.getName() + ': ' + JSON.stringify(r));
    if (r.ok) f.moveTo(done);
  }
  return out.length ? out.join('\n') : 'No hay reportes nuevos';
}

// ---------------- Control días (gaps) ----------------
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Pure: resRows/salRows as arrays (Reservas / Salidas), from/to 'yyyy-MM-dd' */
function controlRows_(resRows, salRows, from, to) {
  const by = {};
  const day = d => (by[d] = by[d] || { sal: 0, res: 0, ex: 0, est: 0 });
  salRows.forEach(s => { const d = fmtCell_(s[4]); if (d >= from && d <= to && Number(s[8]) > 0) day(d).sal++; });
  resRows.forEach(r => {
    const d = fmtCell_(r[9]);
    if (d < from || d > to || r[3] !== 'sí' || r[13]) return;
    const x = day(d); x.res++;
    if (r[31] === 'estimado') x.est++; else x.ex++;
  });
  const out = [];
  const [y, m, dd] = from.split('-').map(Number);
  for (let t = Date.UTC(y, m - 1, dd); ; t += 86400000) {
    const dt = new Date(t);
    const d = dt.toISOString().slice(0, 10);
    if (d > to) break;
    const x = by[d] || { sal: 0, res: 0, ex: 0, est: 0 };
    const wd = dt.getUTCDay();
    let estado;
    if (!x.res) estado = wd === 3 ? 'Miércoles · sin tours' : '⚠️ Sin reservas · revisar';
    else if (!x.est) estado = 'OK';
    else if (!x.ex) estado = '⚠️ Falta reporte de Comercial';
    else estado = '⚠️ Parcial · faltan ' + x.est;
    out.push([d, DIAS_ES[wd], x.sal, x.res, x.ex, x.est, estado]);
  }
  return out;
}

function rebuildControl() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const get = (name, headers) => {
    const sh = sheet_(ss, name, headers);
    return sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues() : [];
  };
  const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
  const rows = controlRows_(get('Reservas', RES_HEADERS), get('Salidas', SAL_HEADERS), CTRL_FROM, yesterday);
  writeTab_(ss, 'Control días', CTRL_HEADERS, rows.reverse());
  return rows.length;
}

// ---------------- Step 5: Stock · Compras · Tarifas · Eventuales · Costos ----------------
// Config tabs (editable): Productos, Tarifas, Tours (column Barco).
// Log tabs (append-only, written by the app or by hand): Compras, Ajustes, Comida empleado, Pagos.
// Calculated tabs (rebuilt by rebuildFinanzas): Stock, Eventuales, Resumen semanal, Externos, Costos salida.

const PROD_HEADERS = ['ID', 'Producto', 'Grupo', 'Unidad', 'Unidades por caja', 'Control stock (sí/no)', 'Mínimo',
  'Campo FareHarbor', 'Costo unitario (MXN)', 'Activo (sí/no)', 'Notas'];
const PROD_SEED = [
  ['cer', 'Cerveza', 'Bebidas', 'lata', 24, 'sí', 48, 'Cerveza', 15.41, 'sí', ''],
  ['agu', 'Agua', 'Bebidas', 'botella', 24, 'sí', 48, 'Agua', 3.40, 'sí', ''],
  ['ref', 'Refresco', 'Bebidas', 'lata', 24, 'sí', 24, 'Coca-Cola', 9.37, 'sí', ''],
  ['vin', 'Vino La Cetto', 'Bebidas', 'botella', 12, 'sí', 6, 'Vino (botellas)', 180, 'sí', ''],
  ['jug', 'Jugo', 'Bebidas', 'botella', 1, 'sí', 0, '', 45, 'sí', 'En FareHarbor va en "Extras a bordo" (texto)'],
  ['gas', 'Gasolina', 'Combustible', 'litro', 1, 'sí', 60, 'Gasolina (litros)', '', 'sí', 'Costo = última compra'],
  ['hie', 'Hielo', 'Consumo directo', 'bolsa', 1, 'no', 0, 'Hielo (bolsas)', 20, 'sí', ''],
  ['fru', 'Fruta', 'Consumo directo', 'compra', 1, 'no', 0, 'Fruta (personas)', '', 'sí', 'Compra repartida entre salidas por personas'],
  ['des', 'Desayuno Yak (SUP)', 'Consumo directo', 'persona', 1, 'no', 0, '', 100, 'sí', 'Por persona en tours SUP'],
  ['cde', 'Comida empleado · desayuno', 'Comida empleado', 'comida', 1, 'no', 0, '', 40, 'sí', ''],
  ['cda', 'Comida empleado · almuerzo', 'Comida empleado', 'comida', 1, 'no', 0, '', 50, 'sí', '']
];
const TAR_HEADERS = ['Rol (FareHarbor)', 'Barco', 'Desde (h)', 'Hasta (h)', 'Item contiene', 'Persona', 'Monto (MXN)',
  'Unidad (salida/hora)', 'Notas'];
// First matching row wins: put specific rows first.
const TAR_SEED = [
  ['*', '*', '', '', '', 'Ignacio Arceo', '', 'salida', 'PENDIENTE: tarifa especial (tiene sueldo fijo)'],
  ['capitan', 'ponton', '', '', '', '', 450, 'salida', ''],
  ['capitan', 'catamaran', 0, 3, '', '', 600, 'salida', 'hasta 3 h'],
  ['capitan', 'catamaran', 3, 99, '', '', 700, 'salida', '4 h'],
  ['capitan', 'monocasco', '', '', '', '', 600, 'salida', ''],
  ['marinero', 'catamaran', '', '', '', '', 400, 'salida', ''],
  ['marinero', 'monocasco', '', '', '', '', 400, 'salida', ''],
  ['guia', 'ponton', '', '', '', '', 300, 'salida', ''],
  ['instructor lider', 'sup', '', '', '[HBTS]', '', 600, 'salida', 'HBTS Instructor SUP Líder'],
  ['instructor lider', 'sup', '', '', '', '', 400, 'salida', 'Instructor SUP Líder A/B'],
  ['instructor asistente', '*', '', '', '', '', 400, 'salida', ''],
  ['hora extra', '*', '', '', '', '', 100, 'hora', 'Capitán y marinero, campo "Hora extra" de la bitácora'],
  ['cancelado', '*', '', '', '', '', 0.5, 'factor', 'Tour cancelado con tripulación asignada = 50%'],
  ['festivo', '*', '', '', '', '', '', 'factor', 'PENDIENTE: Omri confirma'],
  ['traslado', '*', '', '', '', '', '', 'salida', 'PENDIENTE: falta campo en FareHarbor']
];
const BARCO_SEED = {
  258806: 'ponton', 244132: 'ponton', 398151: 'ponton', 337347: 'ponton', 398392: 'ponton', 703717: 'ponton',
  274513: 'catamaran', 696746: 'catamaran', 550017: 'catamaran', 337346: 'catamaran', 714148: 'catamaran', 695580: 'catamaran', 694472: 'catamaran', 708835: 'catamaran',
  244597: 'monocasco', 706421: 'monocasco', 337344: 'monocasco', 703332: 'monocasco',
  244136: 'hobie', 703536: 'hobie',
  244134: 'sup', 398421: 'sup', 243654: 'sup', 398153: 'sup', 337343: 'sup', 337931: 'sup', 398154: 'sup', 441111: 'sup', 703731: 'sup',
  703654: 'sup', 337932: 'sup', 258037: 'sup', 703706: 'sup',
  689738: 'kayak', 185852: 'kayak', 258044: 'kayak', 703712: 'kayak',
  723914: 'otro', 721266: 'otro'
};
const COMPRA_HEADERS = ['Compra ID', 'Fecha', 'Proveedor', 'Producto ID', 'Cantidad (unidades)', 'Costo unitario (MXN)',
  'Total (MXN)', 'Cubre hasta (fecha)', 'Nota', 'Ticket', 'Estado (activa/anulada)', 'Registrado', 'Por'];
const AJUSTE_HEADERS = ['Fecha', 'Producto ID', 'Cantidad (+/-)', 'Motivo', 'Nota', 'Por', 'Registrado'];
const COMIDA_HEADERS = ['Fecha', 'Nombre', 'Tipo (desayuno/almuerzo)', 'Cantidad', 'Nota', 'Por', 'Registrado'];
const PAGO_HEADERS = ['Semana (jueves)', 'Nombre', 'Monto (MXN)', 'Fecha pago', 'Por', 'Nota'];
const STOCK_HEADERS = ['Producto ID', 'Producto', 'Unidad', 'Compras', 'Consumo', 'Ajustes', 'Stock', 'Mínimo', 'Alerta',
  'Costo unitario (MXN)', 'Valor (MXN)'];
const EV_HEADERS = ['Semana (jueves)', 'Fecha', 'Hora', 'Item', 'Availability pk', 'Nombre', 'Usuario', 'Rol', 'Barco',
  'Duración (h)', 'Tarifa (MXN)', 'Factor', 'Horas extra', 'Hora extra (MXN)', 'Total (MXN)', 'Regla', 'Alerta'];
const RESUMEN_HEADERS = ['Semana (jueves)', 'Nombre', 'Salidas', 'Total (MXN)', 'Pagado (MXN)', 'Pendiente (MXN)', 'Alertas'];
const EXT_HEADERS = ['Fecha', 'Hora', 'Item', 'Availability pk', 'Rol', 'Nombre', 'A quién se debe (nota)', 'Alerta'];
const COSTO_HEADERS = ['Availability pk', 'Fecha', 'Hora', 'Item', 'Barco', 'Pax', 'Ingreso neto (MXN)', 'Fuente ingreso',
  'Bebidas (MXN)', 'Hielo (MXN)', 'Gasolina (MXN)', 'Fruta (MXN)', 'Desayuno (MXN)', 'Tripulación (MXN)', 'Costo total (MXN)',
  'Costo %', 'Detalle consumo', 'Alertas'];

// ----- pure helpers -----
function norm_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function ymd_(v) { return (v instanceof Date) ? fmtCell_(v) : String(v || '').slice(0, 10); }
function addDays_(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd) + n * 86400000).toISOString().slice(0, 10);
}
// Pay week runs Thursday → Wednesday
function weekStart_(d) {
  const [y, m, dd] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  return addDays_(d, -((wd - 4 + 7) % 7));
}
function hoursBetween_(a, b) {
  if (!a || !b) return null;
  const h = (new Date(b) - new Date(a)) / 3600000;
  return isNaN(h) ? null : Math.round(h * 100) / 100;
}
/** rules: rows of Tarifas. Returns {monto, unidad, regla, pendiente} or null */
function findRate_(rules, rol, barco, horas, item, persona) {
  const r = norm_(rol), b = norm_(barco), it = String(item || ''), p = norm_(persona);
  for (let i = 0; i < rules.length; i++) {
    const x = rules[i];
    const xr = norm_(x[0]), xb = norm_(x[1]);
    if (['hora extra', 'cancelado', 'festivo', 'traslado'].indexOf(xr) >= 0) continue;
    if (x[5] && norm_(x[5]) !== p) continue;
    if (xr && xr !== '*' && r.indexOf(xr) !== 0) continue;
    if (xb && xb !== '*' && xb !== b) continue;
    if (x[4] && it.indexOf(String(x[4])) < 0) continue;
    if (x[2] !== '' && horas !== null && horas <= Number(x[2])) continue;
    if (x[3] !== '' && horas !== null && horas > Number(x[3])) continue;
    return { monto: x[6] === '' ? null : Number(x[6]), unidad: x[7] || 'salida', regla: i + 2, pendiente: x[6] === '' };
  }
  return null;
}
function ruleValue_(rules, key, dflt) {
  const x = rules.find(r => norm_(r[0]) === key);
  return (x && x[6] !== '') ? Number(x[6]) : dflt;
}

/** Eventuales for one departure. sal: Salidas row (array), crew: rows, bitRows: rows of that departure */
function payForSalida_(sal, crew, bitRows, rules, barco) {
  const out = [], ext = [];
  const fecha = fmtDate_(sal[6], 'yyyy-MM-dd') || ymd_(sal[4]), hora = fmtDate_(sal[6], 'HH:mm'), horas = hoursBetween_(sal[6], sal[7]);
  const activas = Number(sal[8]) || 0;
  const factorCancel = ruleValue_(rules, 'cancelado', 0.5);
  const extraRate = ruleValue_(rules, 'hora extra', 100);
  let horasExtra = 0;
  bitRows.forEach(b => { if (/hora extra/i.test(String(b[6])) && b[8] !== '') horasExtra += Number(b[8]) || 0; });
  crew.forEach(c => {
    const rol = c[4], nombre = c[5], usuario = c[6];
    if (/extern/i.test(nombre + ' ' + usuario) || /extern/i.test(rol)) {
      ext.push([fecha, hora, sal[2], sal[0], rol, nombre, c[7] || '', c[7] ? '' : 'Falta nota: ¿a quién se debe?']);
      return;
    }
    const rate = findRate_(rules, rol, barco, horas, sal[2], nombre);
    let factor = 1, alerta = '';
    if (!activas) { factor = factorCancel; alerta = 'Sin reservas activas: ' + (factorCancel * 100) + '%'; }
    let tarifa = 0;
    if (!rate) alerta = (alerta ? alerta + ' | ' : '') + 'Sin tarifa para ' + rol + ' / ' + barco;
    else if (rate.pendiente) alerta = (alerta ? alerta + ' | ' : '') + 'Tarifa pendiente';
    else tarifa = rate.monto;
    const extra = /capitan|marinero/.test(norm_(rol)) ? horasExtra : 0;
    const extraMx = extra * extraRate;
    out.push([weekStart_(fecha), fecha, hora, sal[2], sal[0], nombre, usuario, rol, barco, horas, tarifa, factor,
      extra, extraMx, Math.round((tarifa * factor + extraMx) * 100) / 100, rate ? 'Tarifas fila ' + rate.regla : '', alerta]);
  });
  return { pay: out, ext: ext };
}

/** Consumption of one departure from its bitácora rows → {prodId: qty} */
function consumoSalida_(bitRows, productos) {
  const s = {}, r = {};
  bitRows.forEach(b => {
    const q = Number(b[8]); if (b[8] === '' || isNaN(q)) return;
    const k = norm_(b[6]);
    if (b[5] === 'Salida') s[k] = (s[k] || 0) + q; else r[k] = (r[k] || 0) + q;
  });
  const out = {};
  productos.forEach(p => {
    const f = norm_(p.campo); if (!f || p.id === 'fru') return;
    if (s[f] === undefined && r[f] === undefined) return;
    const q = (s[f] || 0) - (r[f] || 0);
    if (q) out[p.id] = q;
  });
  return out;
}

/** Fruta: each purchase covers [fecha, cubre hasta]; split by "Fruta (personas)" if filled, else by pax. */
function allocateFruta_(compras, salidas) {
  // compras: [{fecha, hasta, total}]; salidas: [{pk, fecha, fruta, pax}]
  const res = {}; const sinSalidas = [];
  compras.forEach(c => {
    const hasta = c.hasta || c.fecha;
    const inRange = salidas.filter(s => s.fecha >= c.fecha && s.fecha <= hasta);
    const withF = inRange.filter(s => s.fruta > 0);
    const base = withF.length ? withF.map(s => [s.pk, s.fruta]) : inRange.filter(s => s.pax > 0).map(s => [s.pk, s.pax]);
    const tot = base.reduce((a, x) => a + x[1], 0);
    if (!tot) { sinSalidas.push(c.fecha); return; }
    base.forEach(([pk, w]) => { res[pk] = (res[pk] || 0) + c.total * w / tot; });
  });
  return { porSalida: res, sinSalidas: sinSalidas };
}

// ----- Sheets side -----
function seedTab_(ss, name, headers, seed) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (seed && seed.length) sh.getRange(2, 1, seed.length, headers.length).setValues(seed);
  }
  return sh;
}
function readTab_(ss, name, headers) {
  const sh = sheet_(ss, name, headers);
  return sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues() : [];
}
// Adds column G "Barco" to Tours (once) and fills it from BARCO_SEED where empty
function ensureBarco_(ss) {
  const sh = ss.getSheetByName('Tours');
  if (!sh) return {};
  if (sh.getRange(1, 7).getValue() !== 'Barco') sh.getRange(1, 7).setValue('Barco (ponton/catamaran/monocasco/hobie/sup/kayak/otro)').setFontWeight('bold');
  const n = sh.getLastRow() - 1; if (n < 1) return {};
  const vals = sh.getRange(2, 1, n, 7).getValues();
  const map = {};
  let changed = false;
  vals.forEach(r => {
    if (!r[6] && BARCO_SEED[r[0]]) { r[6] = BARCO_SEED[r[0]]; changed = true; }
    map[String(r[0])] = norm_(r[6]) || (r[2] === 'renta' ? 'otro' : '');
  });
  if (changed) sh.getRange(2, 7, n, 1).setValues(vals.map(r => [r[6]]));
  return map;
}
function loadProductos_(ss) {
  return readTab_(seedTab_(ss, 'Productos', PROD_HEADERS, PROD_SEED).getParent(), 'Productos', PROD_HEADERS)
    .filter(r => r[0] && !/^n/i.test(String(r[9])))
    .map(r => ({ id: String(r[0]), nombre: r[1], grupo: r[2], unidad: r[3], stock: /^s/i.test(String(r[5])), min: Number(r[6]) || 0,
      campo: r[7], costo: r[8] === '' ? null : Number(r[8]) }));
}

function rebuildFinanzas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const productos = loadProductos_(ss);
  const rules = readTab_(seedTab_(ss, 'Tarifas', TAR_HEADERS, TAR_SEED).getParent(), 'Tarifas', TAR_HEADERS).filter(r => r[0] !== '');
  const barcos = ensureBarco_(ss);
  const compras = readTab_(ss, 'Compras', COMPRA_HEADERS).filter(r => r[0] !== '' && !/anul/i.test(String(r[10])));
  const ajustes = readTab_(ss, 'Ajustes', AJUSTE_HEADERS).filter(r => r[1] !== '');
  sheet_(ss, 'Comida empleado', COMIDA_HEADERS);
  const pagos = readTab_(ss, 'Pagos', PAGO_HEADERS).filter(r => r[1] !== '');
  const salidas = readTab_(ss, 'Salidas', SAL_HEADERS).filter(r => r[0] !== '');
  const crew = readTab_(ss, 'Tripulación', CREW_HEADERS);
  const bit = readTab_(ss, 'Bitácora', BIT_HEADERS);

  // Unit cost: latest purchase price, else Productos cost
  const lastCost = {};
  compras.slice().sort((a, b) => ymd_(a[1]).localeCompare(ymd_(b[1]))).forEach(c => { if (c[5] !== '') lastCost[String(c[3])] = Number(c[5]); });
  const cost = id => { const p = productos.find(x => x.id === id); return lastCost[id] !== undefined ? lastCost[id] : (p && p.costo) || 0; };

  const byAv = (rows, col) => { const m = {}; rows.forEach(r => { const k = String(r[col]); (m[k] = m[k] || []).push(r); }); return m; };
  const crewBy = byAv(crew, 0), bitBy = byAv(bit, 0);

  const ev = [], ext = [], costos = [], consumoTot = {};
  const frutaSal = [];
  const done = salidas.filter(s => fmtDate_(s[6], 'yyyy-MM-dd') <= today);
  done.forEach(s => {
    const pk = String(s[0]);
    const barco = barcos[String(s[1])] || '';
    const b = bitBy[pk] || [];
    let fr = 0; b.forEach(x => { if (/fruta/i.test(String(x[6])) && x[5] === 'Salida') fr += Number(x[8]) || 0; });
    const paxN = Number(String(s[9]).replace(/[^\d.]/g, '')) || 0;
    if (['ponton', 'catamaran', 'monocasco', 'hobie'].indexOf(barco) >= 0) frutaSal.push({ pk: pk, fecha: fmtDate_(s[6], 'yyyy-MM-dd'), fruta: fr, pax: paxN });
  });
  const frutaCompras = compras.filter(c => String(c[3]) === 'fru').map(c => ({ fecha: ymd_(c[1]), hasta: c[7] ? ymd_(c[7]) : '', total: Number(c[6]) || (Number(c[4]) * Number(c[5])) || 0 }));
  const fruta = allocateFruta_(frutaCompras, frutaSal);

  done.forEach(s => {
    const pk = String(s[0]);
    const barco = barcos[String(s[1])] || '';
    const b = bitBy[pk] || [];
    const p = payForSalida_(s, crewBy[pk] || [], b, rules, barco);
    p.pay.forEach(x => ev.push(x)); p.ext.forEach(x => ext.push(x));
    const cons = consumoSalida_(b, productos);
    Object.keys(cons).forEach(id => { consumoTot[id] = (consumoTot[id] || 0) + cons[id]; });
    let beb = 0, hie = 0, gas = 0; const det = [];
    Object.keys(cons).forEach(id => {
      const v = cons[id] * cost(id);
      if (id === 'hie') hie += v; else if (id === 'gas') gas += v; else beb += v;
      det.push(cons[id] + ' ' + id);
    });
    const paxN = Number(String(s[9]).replace(/[^\d.]/g, '')) || 0;
    const tipo = (loadToursCache_(ss)[String(s[1])] || {}).tipo;
    const desayuno = (barco === 'sup' && tipo !== 'renta') ? paxN * cost('des') : 0;
    const fru = fruta.porSalida[pk] || 0;
    const trip = p.pay.reduce((a, x) => a + (Number(x[14]) || 0), 0);
    const total = beb + hie + gas + fru + desayuno + trip;
    const ingreso = Number(s[17]) || 0;
    const alerts = [];
    if (/sin bit/i.test(String(s[11])) || /falta/i.test(String(s[11]))) alerts.push('Bitácora: ' + s[11]);
    p.pay.forEach(x => { if (x[16]) alerts.push(x[5] + ': ' + x[16]); });
    costos.push([pk, fmtDate_(s[6], 'yyyy-MM-dd'), fmtDate_(s[6], 'HH:mm'), s[2], barco, s[9], ingreso, s[18] || '', r2_(beb), r2_(hie), r2_(gas), r2_(fru), r2_(desayuno),
      r2_(trip), r2_(total), ingreso ? Math.round(total / ingreso * 1000) / 10 : '', det.join(', '), alerts.join(' | ')]);
  });

  // Stock
  const stock = productos.filter(p => p.stock).map(p => {
    const comp = compras.filter(c => String(c[3]) === p.id).reduce((a, c) => a + (Number(c[4]) || 0), 0);
    const aj = ajustes.filter(a => String(a[1]) === p.id).reduce((a, x) => a + (Number(x[2]) || 0), 0);
    const con = consumoTot[p.id] || 0;
    const st = comp - con + aj;
    return [p.id, p.nombre, p.unidad, comp, con, aj, st, p.min, st < 0 ? '⚠️ Negativo' : (st < p.min ? 'Bajo mínimo' : ''), cost(p.id), r2_(st * cost(p.id))];
  });

  // Weekly summary
  const sum = {};
  ev.forEach(x => {
    const k = x[0] + '|' + x[5];
    const o = sum[k] = sum[k] || { w: x[0], n: x[5], s: 0, t: 0, a: [] };
    o.s++; o.t += Number(x[14]) || 0; if (x[16]) o.a.push(x[1] + ' ' + x[16]);
  });
  const paid = {};
  pagos.forEach(p => { const k = ymd_(p[0]) + '|' + p[1]; paid[k] = (paid[k] || 0) + (Number(p[2]) || 0); });
  const resumen = Object.keys(sum).sort().reverse().map(k => {
    const o = sum[k], pg = paid[k] || 0;
    return [o.w, o.n, o.s, r2_(o.t), pg, r2_(o.t - pg), o.a.slice(0, 5).join(' | ')];
  });

  ev.sort((a, b) => (b[1] + b[2]).localeCompare(a[1] + a[2]));
  costos.sort((a, b) => (b[1] + b[2]).localeCompare(a[1] + a[2]));
  ext.sort((a, b) => (b[0] + b[1]).localeCompare(a[0] + a[1]));
  writeTab_(ss, 'Stock', STOCK_HEADERS, stock);
  writeTab_(ss, 'Eventuales', EV_HEADERS, ev);
  writeTab_(ss, 'Resumen semanal', RESUMEN_HEADERS, resumen);
  writeTab_(ss, 'Externos', EXT_HEADERS, ext);
  writeTab_(ss, 'Costos salida', COSTO_HEADERS, costos);
  if (fruta.sinSalidas.length) logError_(ss, 'Fruta', 'Compra sin salidas para repartir: ' + fruta.sinSalidas.join(', '), '');
  rebuildControl();
  return { eventuales: ev.length, costos: costos.length, stock: stock.length };
}
function r2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
let TOURS_CACHE_ = null;
function loadToursCache_(ss) { return TOURS_CACHE_ || (TOURS_CACHE_ = loadTours_(ss)); }

// ---------------- Helpers ----------------
function typeSummary_(b) {
  const m = {};
  (b.customers || []).forEach(c => { const t = custType_(c); m[t] = (m[t] || 0) + 1; });
  return Object.entries(m).map(([t, n]) => n + '× ' + t).join(', ');
}
function money_(cents) {
  return (cents === undefined || cents === null || cents === '') ? '' : Number(cents) / 100;
}
function isDuplicate_(raw, hash) {
  const last = raw.getLastRow();
  if (last < 2) return false;
  const from = Math.max(2, last - 199);
  const vals = raw.getRange(from, 2, last - from + 1, 1).getValues();
  return vals.some(r => r[0] === hash);
}
function saveToDrive_(pk, now, body) {
  const name = 'Adventure Lab Ops – Raw JSON';
  const it = DriveApp.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  return folder.createFile('booking_' + (pk || 'x') + '_' + now.getTime() + '.json', body, 'application/json').getId();
}
function logError_(ss, where, err, body) {
  sheet_(ss, 'Errores', ['Fecha', 'Dónde', 'Error', 'Inicio del payload'])
    .appendRow([new Date(), where, String(err), String(body || '').slice(0, 500)]);
}
function sha1_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function sheet_(ss, name, headers) {
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.appendRow(headers);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return s;
}

if (typeof module !== 'undefined') module.exports = { bookingPax_, computeSalida_, opsType_, cfvNumber_, parseCsv_, parseReport_, parseMoney_, controlRows_, incomeCells_, findRate_, weekStart_, payForSalida_, consumoSalida_, allocateFruta_, TAR_SEED, PROD_SEED, hoursBetween_ };

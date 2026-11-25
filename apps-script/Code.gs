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
  'Invoice (MXN)', 'Creada', 'Último evento', 'Booking uuid', 'Alerta pax', 'Fila Raw', 'Ingreso neto (MXN)', 'Fuente ingreso', 'Link FareHarbor'];
const SAL_HEADERS = ['Availability pk', 'Item pk', 'Item', 'Tipo tour', 'Fecha', 'Hora', 'Inicio', 'Fin',
  'Reservas activas', 'Pax', 'Unidades', 'Bitácora', 'Reserva salida', 'Reserva regreso', 'Tripulación',
  'Alertas', 'Actualizado', 'Ingreso neto (MXN)', 'Fuente ingreso', 'Recursos', 'Recursos pk'];
const ING_HEADERS = ['Booking pk', 'Ingreso neto (MXN)', 'Fecha tour', 'Archivo', 'Subido', 'Fila reporte'];
const CARGA_HEADERS = ['Subido', 'Archivo', 'Hash', 'Duplicado', 'Filas', 'Reservas encontradas', 'No encontradas',
  'Fechas', 'Notas'];
const CTRL_HEADERS = ['Fecha', 'Día', 'Salidas', 'Reservas activas', 'Ingreso exacto', 'Ingreso estimado', 'Estado'];
const CTRL_FROM = '2026-11-16';
const REPORTS_FOLDER = 'Adventure Lab Ops – Reportes';
const BIT_HEADERS = ['Availability pk', 'Fecha', 'Hora', 'Item', 'Booking pk', 'Tipo', 'Campo', 'Field pk',
  'Cantidad', 'Texto'];
const CREW_HEADERS = ['Availability pk', 'Fecha', 'Hora', 'Item', 'Rol', 'Nombre', 'Usuario', 'Nota', 'Rol clave'];
const TOURS_HEADERS = ['Item pk', 'Item', 'Tipo (compartido/privado/renta/otro)', 'Campo personas (field pks, coma)',
  'Lleva bitácora (sí/no)', 'Notas'];
// Tours extra columns: G Barco (ensureBarco_), H Estado, I Visto primero (added with the pk-mapping work)
const TOURS_ESTADO_HDR = 'Estado';
const TOURS_VISTO_HDR = 'Visto primero';
const TOURS_COLS = 9;

// ---- Mapping tabs (match FareHarbor things by pk, never by name) ----
const ESTADO_OK = 'OK';
const ESTADO_NUEVO = 'Nuevo – revisar';
const CT_TAB = 'Tipos de cliente', CF_TAB = 'Campos', ROL_TAB = 'Roles';
const CT_HEADERS = ['Clave', 'Nombre (FareHarbor)', 'Uso', 'Estado', 'Visto primero', 'Visto en (item)', 'Notas', 'Configurado por', 'Configurado'];
const CF_HEADERS = ['Clave', 'Nombre (FareHarbor)', 'Uso', 'Producto ID', 'Estado', 'Visto primero', 'Visto en (item)', 'Ejemplo', 'Notas',
  'Configurado por', 'Configurado'];
const ROL_HEADERS = ['Clave', 'Short name (FareHarbor)', 'Nombre rol', 'Rol tarifa', 'Estado', 'Visto primero', 'Visto en (item)', 'Notas',
  'Configurado por', 'Configurado'];
const USOS_CT = ['pax', 'no cuenta', 'ops salida', 'ops regreso'];
const USOS_CF = ['producto', 'personas', 'seats', 'hora extra', 'extras', 'costo adicional', 'ignorar'];
const PEOPLE_RE = /number of people|n[uú]mero de personas|cantidad de personas|# de personas|people in/i;
const SEATS_RE = /^QTY\s*·\s*Seats/i;

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
  let locked = false;
  try { lock.waitLock(25000); locked = true; } catch (err) { locked = false; }
  if (!locked) return rawOnly_(body); // never drop data: Raw first, derived tabs later
  try {
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

    const dup = isDuplicate_(raw, hash);
    raw.appendRow(rawRowFor_(now, hash, dup, b, body));
    const rawRow = raw.getLastRow();

    if (!dup && b.pk) {
      try {
        const M = loadMapeos_(ss);
        if (!M) {
          setRebuildPending_(); // mapping tabs not created yet: the 15-min rebuild seeds them and derives everything from Raw
        } else {
          const tours = loadTours_(ss);
          const ing = loadIngresos_(ss);
          upsertReserva_(ss, b, now, rawRow, tours, ing, M);
          if (av.pk) recomputeSalidas_(ss, [String(av.pk)], tours, ing, M);
          try { registerUnknowns_(ss, [b], M, ctxFor_(ss, tours), now); } catch (err2) { logError_(ss, 'Mapeos', err2, body); }
        }
      } catch (err) { logError_(ss, 'Derivados', err, body); }
    }
  } catch (err) {
    try { logError_(SpreadsheetApp.getActiveSpreadsheet(), 'doPost', err, body); } catch (e2) {}
  } finally {
    try { lock.releaseLock(); } catch (e3) {}
  }
  return ContentService.createTextOutput('ok');
}

/** One Raw row (same layout as always). Big payloads go to Drive. */
function rawRowFor_(now, hash, dup, b, body) {
  const av = b.availability || {};
  const item = av.item || {};
  let jsonCell = body;
  if (body.length > MAX_CELL) jsonCell = 'DRIVE:' + saveToDrive_(b.pk, now, body);
  return [now, hash, dup ? 'sí' : '', b.pk || '', b.uuid || '', b.status || '',
    av.pk || '', item.pk || '', item.name || '', av.start_at || '', typeSummary_(b), jsonCell];
}

// Lock not available: still write Raw (append-only, atomic) and ask the next 15-min run to derive everything.
function rawOnly_(body) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let parsed = {};
    try { parsed = JSON.parse(body) || {}; } catch (err) {}
    if (parsed.type === 'reporte') return ContentService.createTextOutput('{"ok":false,"error":"ocupado, intenta de nuevo"}').setMimeType(ContentService.MimeType.JSON);
    const raw = sheet_(ss, 'Raw', RAW_HEADERS);
    const hash = sha1_(body);
    raw.appendRow(rawRowFor_(new Date(), hash, isDuplicate_(raw, hash), parsed.booking || {}, body));
    setRebuildPending_();
    logError_(ss, 'doPost', 'Sin candado: guardado en Raw, se recalcula en el próximo ciclo', body);
  } catch (err) {
    try { logError_(SpreadsheetApp.getActiveSpreadsheet(), 'doPost (sin candado)', err, body); } catch (e2) {}
  }
  return ContentService.createTextOutput('ok');
}

function setRebuildPending_() {
  try { PropertiesService.getScriptProperties().setProperty('REBUILD_PENDING', '1'); } catch (e) {}
}
function isRebuildPending_() {
  try { return PropertiesService.getScriptProperties().getProperty('REBUILD_PENDING') === '1'; } catch (e) { return false; }
}
function clearRebuildPending_() {
  try { PropertiesService.getScriptProperties().deleteProperty('REBUILD_PENDING'); } catch (e) {}
}

function doGet() {
  return ContentService.createTextOutput('Adventure Lab Ops DB: OK');
}

// ---------------- Menu ----------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ops DB')
    .addItem('Preparar mapeos (Tipos de cliente, Campos, Roles)', 'prepararMapeos')
    .addItem('Reconstruir todo desde Raw', 'rebuildAll')
    .addItem('Reconstruir solo Reservas', 'rebuildReservas')
    .addItem('Importar reportes nuevos de Drive', 'importFromDrive')
    .addItem('Actualizar Control días', 'rebuildControl')
    .addItem('Actualizar stock, eventuales y costos', 'rebuildFinanzas')
    .addToUi();
}

/** Run once after deploying (menu or editor): creates + seeds the mapping tabs from Raw, then rebuilds. Idempotent. */
function prepararMapeos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const seeded = ensureMapeos_(ss);
  if (seeded || isRebuildPending_()) rebuildAll();
  return seeded ? 'Mapeos creados desde Raw y todo reconstruido' : 'Los mapeos ya existían';
}

// ---------------- Tours (config) ----------------
/** Pure: Estado of a Tours row. Empty cell → 'Nuevo – revisar' only for rows the app auto-added, else OK. */
function tourEstado_(estadoCell, notas) {
  const e = String(estadoCell || '').trim();
  if (e) return /nuevo/i.test(e) ? ESTADO_NUEVO : ESTADO_OK;
  return /^AUTO: revisar/i.test(String(notas || '')) ? ESTADO_NUEVO : ESTADO_OK;
}
/** Pure: Tours rows (any width ≥ 6) → {itemPk: {tipo, fields, bitacora, estado}} */
function toursFromRows_(rows) {
  const map = {};
  rows.forEach(r => {
    if (!r[0]) return;
    map[String(r[0])] = {
      tipo: String(r[2] || '').toLowerCase().trim(),
      fields: String(r[3] || '').split(',').map(x => x.trim()).filter(String),
      bitacora: /^s/i.test(String(r[4] || '')),
      barco: norm_(r[6]),
      estado: tourEstado_(r[7], r[5])
    };
  });
  return map;
}
function loadTours_(ss) {
  let sh = ss.getSheetByName('Tours');
  if (!sh) {
    sh = ss.insertSheet('Tours');
    sh.getRange(1, 1, 1, TOURS_HEADERS.length).setValues([TOURS_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, TOURS_SEED.length, TOURS_HEADERS.length).setValues(TOURS_SEED);
  }
  const last = sh.getLastRow();
  if (last < 2) return {};
  const w = Math.min(TOURS_COLS, Math.max(sh.getLastColumn(), TOURS_HEADERS.length));
  return toursFromRows_(sh.getRange(2, 1, last - 1, w).getValues());
}

// Adds unknown items to Tours with a guessed type and Estado "Nuevo – revisar", so nothing is silently wrong
function ensureTour_(ss, tours, b) {
  const item = (b.availability || {}).item || {};
  const k = String(item.pk || '');
  if (!k || tours[k]) return tours[k];
  const names = (b.customers || []).map(c => custType_(c));
  const guess = names.some(n => /private|privad/i.test(n)) ? 'privado' : 'compartido';
  sheet_(ss, 'Tours', TOURS_HEADERS).appendRow([item.pk, item.name || '', guess, '', 'no', 'AUTO: revisar tipo y campo de personas', '',
    ESTADO_NUEVO, new Date()]);
  tours[k] = { tipo: guess, fields: [], bitacora: false, estado: ESTADO_NUEVO, auto: true };
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
// ops = the customer's type is not a normal passenger type (OPS · Salida/Regreso, or "no cuenta")
function allCfvs_(b, M) {
  const out = (b.custom_field_values || []).map(v => ({ v: v, level: 'booking', ctype: '', ops: false }));
  (b.customers || []).forEach(c => {
    const ops = typeUso_(M, c) !== 'pax';
    (c.custom_field_values || []).forEach(v => out.push({ v: v, level: 'customer', ctype: custType_(c), ops: ops }));
  });
  return out;
}
function cfName_(v) { return ((v.custom_field || {}).name) || v.name || ''; }
function cfPk_(v) { return String(((v.custom_field || {}).pk) || ''); }

/** Pax for one booking → {pax, unidades, alerta} */
function bookingPax_(b, tour, M) {
  const cust = (b.customers || []).filter(c => typeUso_(M, c) === 'pax');
  const unidades = cust.length;
  const tipo = (tour && tour.tipo) || 'compartido';
  if (!unidades) return { pax: 0, unidades: 0, alerta: '' };
  if (tipo === 'compartido' || tipo === 'otro') return { pax: unidades, unidades: unidades, alerta: '' };

  const fields = (tour && tour.fields) || [];
  const cfvs = allCfvs_(b, M);
  let people = null;
  cfvs.forEach(x => {
    const pk = cfPk_(x.v);
    // Tours col D (field pks) first; if empty, every field whose Uso is "personas"
    const isPeople = fields.length ? fields.indexOf(pk) >= 0 : fieldUso_(M, x.v).uso === 'personas';
    if (isPeople) { const n = cfvNumber_(x.v); if (n !== null && n > 0) people = (people || 0) + n; }
  });
  let seats = null;
  cfvs.forEach(x => {
    if (fieldUso_(M, x.v).uso === 'seats') { const n = num_(x.v.value); if (n !== null && n > 0) seats = (seats || 0) + n; }
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

function opsType_(b, M) {
  const t = (b.customers || []).map(c => typeUso_(M, c));
  let o = '';
  if (t.some(x => x === 'ops salida')) o = 'Salida';
  if (t.some(x => x === 'ops regreso')) o = o ? o + '+Regreso' : 'Regreso';
  return o;
}

function fmtDate_(iso, pattern) {
  if (!iso) return '';
  const d = new Date(iso);
  return (typeof Utilities !== 'undefined') ? Utilities.formatDate(d, TZ, pattern)
    : (pattern === 'HH:mm' ? String(iso).slice(11, 16) : String(iso).slice(0, 10));
}

/**
 * Resources used by a departure, from its active customer bookings (OPS bookings are not passed in):
 * booking.resource_uses[{pk, resource:{pk,name,short_name}, use_count}] → unique by resource pk, use_count summed, first name kept.
 * → [{pk, name, n}] in first-seen order. Names are stored without the ':' and '|' separators of the "Recursos pk" column.
 */
function resourcesFrom_(bookings) {
  const by = {}, order = [];
  (bookings || []).forEach(b => (b.resource_uses || []).forEach(u => {
    const r = (u && u.resource) || {};
    const pk = String(r.pk !== undefined && r.pk !== null ? r.pk : '');
    const name = String(r.name || r.short_name || '').replace(/[:|]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!pk && !name) return;
    const key = pk || 'n:' + name.toLowerCase();
    const n = Number(u.use_count);
    if (!by[key]) { by[key] = { pk: pk, name: name || ('Recurso ' + pk), n: 0 }; order.push(key); }
    by[key].n += isFinite(n) && u.use_count !== '' && u.use_count !== null ? n : 1;
  }));
  return order.map(k => by[k]);
}
/** "pk:Name:n|pk:Name:n" (Salidas col "Recursos pk") → [{pk,name,n}] */
function resFromText_(t) {
  return String(t || '').split('|').filter(String).map(x => { const a = x.split(':'); return { pk: a[0], name: a.slice(1, -1).join(':'), n: Number(a[a.length - 1]) || 0 }; });
}
/** True when the Salidas header row is shorter than SAL_HEADERS (column added by a newer version) → history must be recomputed from Raw once */
function salHeaderStale_(headerRow) {
  return String((headerRow || [])[SAL_HEADERS.length - 1] || '') !== SAL_HEADERS[SAL_HEADERS.length - 1];
}
/** Same for Reservas (column 'Link FareHarbor' added at the end) */
function resHeaderStale_(headerRow) {
  return String((headerRow || [])[RES_HEADERS.length - 1] || '') !== RES_HEADERS[RES_HEADERS.length - 1];
}

/** Pure: rentals (Tours tipo 'renta') are the only items without bitácora; the Tours column 'Lleva bitácora' is no longer read. */
// Bitácora applies to every item except rentals and day passes (barco 'otro', e.g. 723914 Yak day pass, 721266 Carmelita Day Pass)
function bitacoraNoAplica_(tipo, barco) { return String(tipo || '').toLowerCase().trim() === 'renta' || norm_(barco) === 'otro'; }
// '4' (25 Nov 2026): Costos adicionales amounts (Costos salida col S, Externos col I) and the Bitácora text of costo adicional/extras fields → one full recompute
const BITACORA_RULE_V = '4';
// Items that got OPS · Salida/Regreso bitácora fields in FareHarbor on 24 Nov 2026 → Tours "Lleva bitácora" = sí (sheet record only)
const BITACORA_SI_20261124 = [244134, 398421, 243654, 398153, 337343, 337931, 398154, 703654, 689738, 185852, 703536, 770935];
function markBitacoraSi_(ss) {
  const sh = ss.getSheetByName('Tours'); if (!sh || sh.getLastRow() < 2) return 0;
  const n = sh.getLastRow() - 1, rng = sh.getRange(2, 1, n, 5), v = rng.getValues(); let c = 0;
  v.forEach(r => { if (BITACORA_SI_20261124.indexOf(Number(r[0])) >= 0 && !/^s/i.test(String(r[4]))) { r[4] = 'sí'; c++; } });
  if (c) sh.getRange(2, 5, n, 1).setValues(v.map(r => [r[4]]));
  return c;
}
/** Pure: true when the stored rule version differs → Salidas must be recomputed once. */
function bitacoraRuleStale_(stored) { return String(stored || '') !== BITACORA_RULE_V; }

/**
 * One departure from its bookings (latest version of each).
 * list: [{b, status, row}] → {salida:[], bit:[[...]], crew:[[...]]}
 */
function computeSalida_(avPk, list, tours, now, ing, M) {
  ing = ing || {};
  const first = (list[0] || {}).b || {};
  const av = first.availability || {};
  const item = av.item || {};
  const tour = tours[String(item.pk)] || { tipo: '?', fields: [], bitacora: false };
  const fecha = fmtDate_(av.start_at, 'yyyy-MM-dd'), hora = fmtDate_(av.start_at, 'HH:mm');
  const active = list.filter(x => x.b.status === 'booked');
  const opsBk = active.filter(x => opsType_(x.b, M));
  const custBk = active.filter(x => !opsType_(x.b, M));

  let pax = 0, unidades = 0, paxPend = false, ingreso = 0, estimados = 0;
  custBk.forEach(x => {
    const exact = ing[String(x.b.pk)];
    if (exact !== undefined) ingreso += exact; else { ingreso += netEstimate_(x.b); estimados++; }
  });
  const alerts = [];
  custBk.forEach(x => {
    const p = bookingPax_(x.b, tour, M);
    unidades += p.unidades;
    if (p.pax === '') paxPend = true; else pax += p.pax;
    if (p.alerta) alerts.push('#' + x.b.pk + ' ' + p.alerta);
  });

  const resources = resourcesFrom_(custBk.map(x => x.b));
  if (custBk.length && !resources.length) alerts.push('Sin recurso asignado');
  const sal = opsBk.filter(x => /Salida/.test(opsType_(x.b, M)));
  const reg = opsBk.filter(x => /Regreso/.test(opsType_(x.b, M)));
  if (sal.length > 1) alerts.push('Más de una reserva de salida');
  if (reg.length > 1) alerts.push('Más de una reserva de regreso');
  let bitacora = 'Sin bitácora';
  if (sal.length && reg.length) bitacora = 'Completa';
  else if (sal.length) bitacora = 'Falta regreso';
  else if (reg.length) bitacora = 'Falta salida';
  // Bitácora applies to every item except rentals (Tours tab 'Lleva bitácora' is no longer read)
  if (!opsBk.length && bitacoraNoAplica_(tour.tipo, tour.barco)) bitacora = 'No aplica';

  // Bitácora lines
  const bit = [];
  opsBk.forEach(x => {
    const tipo = /Salida/.test(opsType_(x.b, M)) ? 'Salida' : 'Regreso';
    allCfvs_(x.b, M).forEach(c => {
      if (c.level !== 'customer' || !c.ops) return;
      const n = cfvNumber_(c.v);
      const txt = (c.v.display_value !== undefined && c.v.display_value !== null) ? String(c.v.display_value) : String(c.v.value || '');
      if (n === null && !txt) return;
      const row = [avPk, fecha, hora, item.name || '', x.b.pk, tipo, cfName_(c.v), cfPk_(c.v),
        n === null ? '' : n, n === null ? txt : ''];
      // free text with digits ("Barco externo San Ángel: $2,500") must not be reduced to its first number (num_ → 2)
      if (n !== null && txt && txt.trim() !== String(n) && /^(costo adicional|extras)$/.test(bitUso_(row, M).uso)) row[9] = txt;
      bit.push(row);
    });
  });

  // Crew: from the booking received last (crew lives on the departure)
  const latest = list.slice().sort((a, b) => (a.row || 0) - (b.row || 0)).pop();
  const crewList = (((latest || {}).b || {}).availability || {}).crew_members || [];
  const crew = crewList.map(m => [avPk, fecha, hora, item.name || '',
    (m.role && m.role.short_name) || '', (m.user && m.user.name) || '', (m.user && m.user.username) || '', m.note || '', roleKey_(m)]);
  crew.forEach(c => { if (!c[4]) alerts.push('Falta rol: ' + (c[5] || c[6] || '?')); });

  const salida = [avPk, item.pk || '', item.name || '', tour.tipo || '?', fecha, hora, av.start_at || '', av.end_at || '',
    custBk.length, paxPend ? (pax ? pax + ' + pendiente' : 'pendiente') : pax, unidades, bitacora,
    sal.map(x => x.b.pk).join(', '), reg.map(x => x.b.pk).join(', '),
    crew.map(c => (c[4] || 'sin rol') + ': ' + (c[5] || c[6])).join(' · '),
    alerts.join(' | '), now, Math.round(ingreso * 100) / 100, estimados ? 'estimado' : '',
    resources.map(r => r.name + ' (' + r.n + ')').join(' · '), resources.map(r => r.pk + ':' + r.name + ':' + r.n).join('|')];
  return { salida: salida, bit: bit, crew: crew, hasCustomers: custBk.length > 0 };
}

// ---------------- Reservas ----------------
function reservaRow_(b, eventTime, rawRow, tours, ing, M) {
  ing = ing || {};
  const av = b.availability || {};
  const item = av.item || {};
  const tour = tours[String(item.pk)];
  const status = b.status || '';
  const ops = opsType_(b, M);
  const p = ops ? { pax: 0, unidades: 0, alerta: '' } : bookingPax_(b, tour, M);
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
    ...incomeCells_(b, status, ops, ing),
    b.dashboard_url || '' // 'Link FareHarbor' (last column; older sheets get it on the next full rebuild)
  ];
}

// [Ingreso neto, Fuente]: exact from report (no label) or estimate
function incomeCells_(b, status, ops, ing) {
  if (status !== 'booked' || ops) return [0, ''];
  const exact = ing[String(b.pk)];
  return exact !== undefined ? [exact, ''] : [netEstimate_(b), 'estimado'];
}

function upsertReserva_(ss, b, eventTime, rawRow, tours, ing, M) {
  ensureTour_(ss, tours, b);
  const sh = sheet_(ss, 'Reservas', RES_HEADERS);
  if (sh.getMaxColumns() < RES_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), RES_HEADERS.length - sh.getMaxColumns());
  if (sh.getRange(1, RES_HEADERS.length).getValue() !== RES_HEADERS[RES_HEADERS.length - 1]) { // column added by a newer version
    sh.getRange(1, 1, 1, RES_HEADERS.length).setValues([RES_HEADERS]).setFontWeight('bold');
    setRebuildPending_(); // older bookings lack 'Link FareHarbor': refill from Raw once (never in the webhook)
  }
  const row = reservaRow_(b, eventTime, rawRow, tours, ing, M);
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
  ensureMapeos_(ss);
  const tours = loadTours_(ss);
  const ing = loadIngresos_(ss);
  const M = loadMapeos_(ss);
  const latest = latestFromRaw_(ss);
  Object.values(latest).forEach(x => ensureTour_(ss, tours, x.b));
  registerUnknowns_(ss, Object.values(latest).map(x => x.b), M, ctxFor_(ss, tours), new Date()); // keep unknowns, never drop data
  const rows = Object.values(latest).map(x => reservaRow_(x.b, x.t, x.row, tours, ing, M));
  rows.sort((a, b) => String(a[11]).localeCompare(String(b[11])) || (a[0] - b[0]));
  writeTab_(ss, 'Reservas', RES_HEADERS, rows);
  return latest;
}

// ---------------- Salidas / Bitácora / Tripulación ----------------
function rebuildAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  clearRebuildPending_(); // a full rebuild from Raw covers whatever was pending (a webhook arriving meanwhile sets it again)
  const latest = rebuildReservas();
  const tours = loadTours_(ss);
  const ing = loadIngresos_(ss);
  const M = loadMapeos_(ss);
  const byAv = {};
  Object.values(latest).forEach(x => {
    const k = String(((x.b.availability || {}).pk) || '');
    if (!k) return;
    (byAv[k] = byAv[k] || []).push({ b: x.b, row: x.row });
  });
  const now = new Date();
  const sal = [], bit = [], crew = [];
  Object.keys(byAv).forEach(k => {
    const r = computeSalida_(k, byAv[k], tours, now, ing, M);
    sal.push(r.salida); r.bit.forEach(x => bit.push(x)); r.crew.forEach(x => crew.push(x));
  });
  sal.sort((a, b) => String(a[6]).localeCompare(String(b[6])));
  writeTab_(ss, 'Salidas', SAL_HEADERS, sal);
  writeTab_(ss, 'Bitácora', BIT_HEADERS, bit);
  writeTab_(ss, 'Tripulación', CREW_HEADERS, crew);
  rebuildFinanzas_(); // also refreshes Control días
  return sal.length;
}

// Recompute only some departures (used by each webhook)
function recomputeSalidas_(ss, avPks, tours, ing, M) {
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
    const out = computeSalida_(String(avPk), list, tours, now, ing, M);
    replaceRows_(ss, 'Salidas', SAL_HEADERS, avPk, [out.salida]);
    replaceRows_(ss, 'Bitácora', BIT_HEADERS, avPk, out.bit);
    replaceRows_(ss, 'Tripulación', CREW_HEADERS, avPk, out.crew);
  });
}

// Replace all rows whose first column == key (derived tabs only)
function replaceRows_(ss, name, headers, key, newRows) {
  const sh = sheet_(ss, name, headers);
  const lastH = headers[headers.length - 1];
  if (sh.getRange(1, headers.length).getValue() !== lastH) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold'); // new column added
    if (name === 'Salidas') setRebuildPending_(); // older departures lack the new column: recompute history from Raw once
  }
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
  recomputeSalidas_(ss, Object.keys(avs), tours, ing, loadMapeos_(ss));
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
  ['cde', 'Desayuno Staff', 'Comida empleado', 'comida', 1, 'no', 0, '', 40, 'sí', ''],
  ['cda', 'Almuerzo Staff', 'Comida empleado', 'comida', 1, 'no', 0, '', 50, 'sí', '']
];
// Staff meals are now ordinary no-stock products bought like Hielo (ids kept: cde / cda). Old display names → new ones ONLY while the live name is still the old seed name.
const STAFF_OLD_NAMES = { cde: 'Comida empleado · desayuno', cda: 'Comida empleado · almuerzo' };
/** Pure: Productos rows (as read) → {renames: [{idx, name}], appends: [seed rows]} (idempotent; never touches rows Omri edited) */
function planStaffMeals_(rows) {
  const out = { renames: [], appends: [] }, seen = {};
  (rows || []).forEach((r, idx) => {
    const id = String(r[0] || ''); if (!STAFF_OLD_NAMES[id]) return;
    seen[id] = true;
    if (String(r[1]) === STAFF_OLD_NAMES[id]) out.renames.push({ idx: idx, name: PROD_SEED.filter(x => x[0] === id)[0][1] });
  });
  Object.keys(STAFF_OLD_NAMES).forEach(id => { if (!seen[id]) out.appends.push(PROD_SEED.filter(x => x[0] === id)[0]); });
  return out;
}
function ensureStaffMeals_(ss) {
  const sh = ss.getSheetByName('Productos'); if (!sh || sh.getLastRow() < 1) return;
  const n = sh.getLastRow() - 1, rows = n >= 1 ? sh.getRange(2, 1, n, 2).getValues() : [];
  const plan = planStaffMeals_(rows);
  plan.renames.forEach(x => sh.getRange(x.idx + 2, 2).setValue(x.name));
  plan.appends.forEach(r => sh.getRange(sh.getLastRow() + 1, 1, 1, r.length).setValues([r]));
}
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
const EXT_HEADERS = ['Fecha', 'Hora', 'Item', 'Availability pk', 'Rol', 'Nombre', 'A quién se debe (nota)', 'Alerta', 'Monto (MXN)'];
const COSTO_HEADERS = ['Availability pk', 'Fecha', 'Hora', 'Item', 'Barco', 'Pax', 'Ingreso neto (MXN)', 'Fuente ingreso',
  'Bebidas (MXN)', 'Hielo (MXN)', 'Gasolina (MXN)', 'Fruta (MXN)', 'Desayuno (MXN)', 'Tripulación (MXN)', 'Costo total (MXN)',
  'Costo %', 'Detalle consumo', 'Alertas', 'Costos adicionales (MXN)'];

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

/**
 * Pure: free text of the "Costos adicionales" field → money amounts.
 * Segments are separated by · • ; + / newline, and by "," or " y " when both sides carry a number (so "San Ángel, Juan: $2,500" stays one line).
 * Amount of a segment: the token with "$", else the one followed by pesos/MXN, else the last number. "$2,500" / "2500" / "$2.500" (dot + exactly 3 digits = thousands) / "$ 300" / "300 pesos".
 * Label = text before the amount (else after it), trimmed of : - – —. ext = the segment mentions "barco externo" (accents/case ignored).
 * → {items:[{label, amount, ext}], total, unparsed:bool, rest:[segments without an amount], raw}
 */
function parseCostos_(text) {
  const raw = String(text === null || text === undefined ? '' : text).trim();
  const out = { items: [], total: 0, unparsed: false, rest: [], raw: raw };
  if (!raw) return out;
  const hasNum = x => /\d/.test(x);
  let segs = [];
  raw.split(/\s*(?:·|•|;|\+|\/|\r?\n)\s*/).forEach(strong => {
    strong = strong.trim(); if (!strong) return;
    const re = /,(?!\d)|\s+y\s+/g; let m, cur = 0;
    while ((m = re.exec(strong)) !== null) {
      const left = strong.slice(cur, m.index), right = strong.slice(m.index + m[0].length);
      if (hasNum(left) && hasNum(right)) { segs.push(left.trim()); cur = m.index + m[0].length; }
    }
    segs.push(strong.slice(cur).trim());
  });
  segs = segs.filter(Boolean);
  // "Barco externo San Ángel" · "$2,500": a label without number followed by a segment that starts with the amount
  const merged = [];
  for (let i = 0; i < segs.length; i++) {
    if (!hasNum(segs[i]) && i + 1 < segs.length && /^[\s$]*\d/.test(segs[i + 1])) { merged.push(segs[i] + ' ' + segs[i + 1]); i++; } else merged.push(segs[i]);
  }
  const clean = x => String(x).replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '').replace(/\s+/g, ' ');
  const toAmount = t => {
    const dot = t.indexOf('.') >= 0, com = t.indexOf(',') >= 0;
    if (dot && com) { const dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ','; const th = dec === '.' ? ',' : '.'; return Number(t.split(th).join('').replace(dec, '.')); }
    if (dot || com) {
      const parts = t.split(dot ? '.' : ','), last = parts[parts.length - 1];
      if (parts.length > 2 || (last.length === 3 && parts[0] !== '0' && parts[0].length <= 3)) return Number(parts.join('')); // MX thousands
      return Number(parts.join('.'));
    }
    return Number(t);
  };
  merged.forEach(seg => {
    const re = /(\$\s*)?(\d[\d.,]*\d|\d)(\s*(?:pesos|mxn|mx|m\.n\.|mn)\b\.?)?/gi; let m; const toks = [];
    while ((m = re.exec(seg)) !== null) toks.push({ i: m.index, len: m[0].length, dollar: !!m[1], unit: !!m[3], num: m[2] });
    if (!toks.length) { out.rest.push(seg); return; }
    const pick = toks.filter(t => t.dollar).pop() || toks.filter(t => t.unit).pop() || toks[toks.length - 1];
    const amount = toAmount(pick.num);
    if (isNaN(amount)) { out.rest.push(seg); return; }
    let label = clean(seg.slice(0, pick.i));
    if (!label) label = clean(seg.slice(pick.i + pick.len));
    out.items.push({ label: label, amount: Math.round(amount * 100) / 100, ext: norm_(seg).indexOf('barco externo') >= 0 });
  });
  out.total = Math.round(out.items.reduce((a, x) => a + x.amount, 0) * 100) / 100;
  out.unparsed = out.rest.length > 0;
  return out;
}
/** Pure: the "Costos adicionales" text of ONE departure (all its bitácora lines whose field has Uso 'costo adicional'). Text fields keep their text; numeric ones give the number. */
function costoAdicionalText_(bitRows, M) {
  const parts = [];
  bitRows.forEach(b => {
    if (bitUso_(b, M).uso !== 'costo adicional') return;
    const t = (b[9] !== '' && b[9] !== null && b[9] !== undefined) ? String(b[9]).trim() : (b[8] !== '' && b[8] !== null && b[8] !== undefined ? String(b[8]) : '');
    if (t) parts.push(t);
  });
  return parts.join(' · ');
}

/** Eventuales for one departure. sal: Salidas row (array), crew: rows, bitRows: rows of that departure */
function payForSalida_(sal, crew, bitRows, rules, barco, M, now) {
  const out = [], ext = [];
  const fecha = fmtDate_(sal[6], 'yyyy-MM-dd') || ymd_(sal[4]), hora = fmtDate_(sal[6], 'HH:mm'), horas = hoursBetween_(sal[6], sal[7]);
  const activas = Number(sal[8]) || 0;
  const factorCancel = ruleValue_(rules, 'cancelado', 0.5);
  const extraRate = ruleValue_(rules, 'hora extra', 100);
  let horasExtra = 0;
  bitRows.forEach(b => { if (bitUso_(b, M).uso === 'hora extra' && b[8] !== '') horasExtra += Number(b[8]) || 0; });
  crew.forEach(c => {
    const rol = c[4], nombre = c[5], usuario = c[6];
    const rolT = crewTarifa_(c, M); // Rol tarifa: mapped by role pk (Roles tab)
    if (rolT === 'ignorar') return;
    // a person named/user-named "Externo" is external whatever their role (users are not a FareHarbor config entity)
    if (/extern/i.test(nombre + ' ' + usuario) || rolT === 'externo') {
      ext.push([fecha, hora, sal[2], sal[0], rol, nombre, c[7] || '', c[7] ? '' : 'Falta nota: ¿a quién se debe?', '']);
      return;
    }
    const rate = findRate_(rules, rolT, barco, horas, sal[2], nombre);
    let factor = 1, alerta = '';
    if (!activas) { factor = factorCancel; alerta = 'Sin reservas activas: ' + (factorCancel * 100) + '%'; }
    let tarifa = 0;
    if (!rate) alerta = (alerta ? alerta + ' | ' : '') + 'Sin tarifa para ' + rol + ' / ' + barco;
    else if (rate.pendiente) alerta = (alerta ? alerta + ' | ' : '') + 'Tarifa pendiente';
    else tarifa = rate.monto;
    const extra = /capitan|marinero/.test(norm_(rolT)) ? horasExtra : 0;
    const extraMx = extra * extraRate;
    out.push([weekStart_(fecha), fecha, hora, sal[2], sal[0], nombre, usuario, rol, barco, horas, tarifa, factor,
      extra, extraMx, Math.round((tarifa * factor + extraMx) * 100) / 100, rate ? 'Tarifas fila ' + rate.regla : '', alerta]);
  });
  // Externos: the amount comes from the "barco externo" lines of Costos adicionales (OPS · Regreso bookings); one external → all of it, several → total on the first
  if (ext.length) {
    const cos = parseCostos_(costoAdicionalText_(bitRows, M));
    const monto = Math.round(cos.items.filter(x => x.ext).reduce((a, x) => a + x.amount, 0) * 100) / 100;
    const endMs = sal[7] ? new Date(sal[7]).getTime() : (sal[6] ? new Date(sal[6]).getTime() + 3 * 3600000 : NaN);
    const ended = !isNaN(endMs) && endMs < (now instanceof Date ? now.getTime() : (now ? new Date(now).getTime() : Date.now()));
    const add = (row, a) => { row[7] = row[7] ? row[7] + ' | ' + a : a; };
    ext.forEach((row, i) => {
      if (monto > 0) { if (i === 0) row[8] = monto; } else if (ended) add(row, 'Falta monto en Costos adicionales');
      if (ext.length > 1 && i === 0) add(row, 'Varios externos: repartir');
    });
  }
  return { pay: out, ext: ext };
}

/** Consumption of one departure from its bitácora rows → {prodId: qty}. Field → product by field pk (Campos tab, Uso "producto"). */
function consumoSalida_(bitRows, productos, M) {
  const s = {}, r = {};
  bitRows.forEach(b => {
    const q = Number(b[8]); if (b[8] === '' || isNaN(q)) return;
    const u = bitUso_(b, M, productos);
    if (u.uso !== 'producto' || !u.prod) return;
    if (b[5] === 'Salida') s[u.prod] = (s[u.prod] || 0) + q; else r[u.prod] = (r[u.prod] || 0) + q;
  });
  const out = {};
  productos.forEach(p => {
    if (p.id === 'fru') return; // fruit counts people (allocateFruta_), not stock
    if (s[p.id] === undefined && r[p.id] === undefined) return;
    const q = (s[p.id] || 0) - (r[p.id] || 0);
    if (q) out[p.id] = q;
  });
  return out;
}

/** People with fruit on a departure: "Salida" qty of the field mapped to product `fru` (decided by product id, not by name) */
function frutaSalida_(bitRows, M, productos) {
  let fr = 0;
  bitRows.forEach(x => { const u = bitUso_(x, M, productos); if (u.uso === 'producto' && u.prod === 'fru' && x[5] === 'Salida') fr += Number(x[8]) || 0; });
  return fr;
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
  if (sh.getLastRow() < 2) return [];
  // a calculated tab written before a column was appended is narrower than `headers` until the next rebuild: read what exists and pad
  const w = Math.min(headers.length, sh.getMaxColumns());
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, w).getValues();
  if (w < headers.length) v.forEach(r => { while (r.length < headers.length) r.push(''); });
  return v;
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

/**
 * Entry point of the 15-min trigger (and the menu). If a mapping changed (or a webhook couldn't derive its data),
 * REBUILD_PENDING is set: then everything is rebuilt from Raw instead (rebuildAll → rebuildFinanzas_).
 * The app's own writes call rebuildFinanzas_ directly so a purchase never waits for a full rebuild.
 */
function rebuildFinanzas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const seeded = ensureMapeos_(ss);
  try { // bitácora rule v2 (all items except rentals) + 'Sin recurso asignado': recompute Salidas once
    const props = PropertiesService.getScriptProperties();
    if (bitacoraRuleStale_(props.getProperty('BITACORA_RULE_V'))) { try { markBitacoraSi_(ss); } catch (e) { logError_(ss, 'markBitacoraSi', e, ''); } setRebuildPending_(); props.setProperty('BITACORA_RULE_V', BITACORA_RULE_V); }
  } catch (e) {}
  try { // Salidas created by an older version (fewer columns): recompute everything from Raw once
    const sal = ss.getSheetByName('Salidas');
    if (sal && sal.getLastRow() >= 1 && salHeaderStale_(sal.getRange(1, 1, 1, SAL_HEADERS.length).getValues()[0])) setRebuildPending_();
    const rsv = ss.getSheetByName('Reservas');
    if (rsv && rsv.getLastRow() >= 1 && rsv.getMaxColumns() >= RES_HEADERS.length && resHeaderStale_(rsv.getRange(1, 1, 1, RES_HEADERS.length).getValues()[0])) setRebuildPending_();
    else if (rsv && rsv.getMaxColumns() < RES_HEADERS.length) setRebuildPending_();
  } catch (e) {}
  try { ensureStaffMeals_(ss); } catch (e) { logError_(ss, 'ensureStaffMeals_', e, ''); }
  if (seeded || isRebuildPending_()) {
    const lock = LockService.getScriptLock();
    const had = lock.hasLock();
    if (had || lock.tryLock(20000)) {
      try {
        clearRebuildPending_(); // clear first: a webhook arriving during the rebuild sets it again
        rebuildAll(); // calls rebuildFinanzas_ itself
        return { reconstruido: true };
      } finally { if (!had) { try { lock.releaseLock(); } catch (e) {} } }
    }
    setRebuildPending_(); // couldn't get the lock: try again next time
  }
  return rebuildFinanzas_();
}

function rebuildFinanzas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const M = loadMapeos_(ss);
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
    const fr = frutaSalida_(b, M, productos);
    const paxN = Number(String(s[9]).replace(/[^\d.]/g, '')) || 0;
    if (['ponton', 'catamaran', 'monocasco', 'hobie'].indexOf(barco) >= 0) frutaSal.push({ pk: pk, fecha: fmtDate_(s[6], 'yyyy-MM-dd'), fruta: fr, pax: paxN });
  });
  const frutaCompras = compras.filter(c => String(c[3]) === 'fru').map(c => ({ fecha: ymd_(c[1]), hasta: c[7] ? ymd_(c[7]) : '', total: Number(c[6]) || (Number(c[4]) * Number(c[5])) || 0 }));
  const fruta = allocateFruta_(frutaCompras, frutaSal);

  done.forEach(s => {
    const pk = String(s[0]);
    const barco = barcos[String(s[1])] || '';
    const b = bitBy[pk] || [];
    const p = payForSalida_(s, crewBy[pk] || [], b, rules, barco, M, new Date());
    p.pay.forEach(x => ev.push(x)); p.ext.forEach(x => ext.push(x));
    const cons = consumoSalida_(b, productos, M);
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
    const cos = parseCostos_(costoAdicionalText_(b, M)); // Costos adicionales (free text in the OPS · Regreso bookings)
    const total = beb + hie + gas + fru + desayuno + trip + cos.total;
    const ingreso = Number(s[17]) || 0;
    const alerts = [];
    if (/sin bit/i.test(String(s[11])) || /falta/i.test(String(s[11]))) alerts.push('Bitácora: ' + s[11]);
    p.pay.forEach(x => { if (x[16]) alerts.push(x[5] + ': ' + x[16]); });
    if (cos.unparsed) alerts.push('Costo adicional sin monto: ' + cos.rest.join(' · '));
    costos.push([pk, fmtDate_(s[6], 'yyyy-MM-dd'), fmtDate_(s[6], 'HH:mm'), s[2], barco, s[9], ingreso, s[18] || '', r2_(beb), r2_(hie), r2_(gas), r2_(fru), r2_(desayuno),
      r2_(trip), r2_(total), ingreso ? Math.round(total / ingreso * 1000) / 10 : '', det.join(', '), alerts.join(' | '), cos.total]);
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
  try { PropertiesService.getScriptProperties().setProperty('FIN_AT', String(Date.now())); } catch (e) {} // getData compares Salidas 'Actualizado' with this (stale flag)
  return { eventuales: ev.length, costos: costos.length, stock: stock.length };
}
function r2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }
let TOURS_CACHE_ = null;
function loadToursCache_(ss) { return TOURS_CACHE_ || (TOURS_CACHE_ = loadTours_(ss)); }


// ---------------- Mapeos por pk: Tipos de cliente · Campos · Roles ----------------
// FareHarbor things are matched by pk (Clave), never by name. Anything not in these tabs is kept,
// added with Estado "Nuevo – revisar" and a safe default (the old name rules); Omri confirms it in the app
// ("Por configurar"). M = {ctype:{clave:{uso,estado,nombre,notas,row}}, field:{clave:{uso,prod,…}}, role:{clave:{tarifa,…}}}.
// Every function that takes M also works with M = null/undefined (defaults only).

// Clave = pk as text; when FareHarbor sends no pk: 'n:' + normalized name
function ctKey_(c) {
  const ct = ((c || {}).customer_type_rate || {}).customer_type || {};
  return ct.pk ? String(ct.pk) : 'n:' + norm_(ct.singular || '');
}
function cfKey_(v) { const pk = cfPk_(v); return pk ? pk : 'n:' + norm_(cfName_(v)); }
function roleKey_(m) {
  const r = (m || {}).role || {};
  return r.pk ? String(r.pk) : 'n:' + norm_(r.short_name || '');
}
function bitKey_(row) { return row[7] !== '' && row[7] !== null && row[7] !== undefined ? String(row[7]) : 'n:' + norm_(row[6]); }

/** Today's name rule for a customer type: OPS · Salida / OPS · Regreso / other OPS · … (doesn't count) / everything else = a person */
function guessCtype_(name) {
  const n = String(name || '');
  if (/OPS\s*·\s*Salida/i.test(n)) return 'ops salida';
  if (/OPS\s*·\s*Regreso/i.test(n)) return 'ops regreso';
  if (isOps_(n)) return 'no cuenta';
  return 'pax';
}
/** campos: {normalized FareHarbor field name → Producto id} (first product wins); peoplePks: {fieldPk: true} from Tours col D */
function camposMap_(prods) {
  const m = {};
  (prods || []).forEach(p => { const k = norm_(p.campo); if (k && !m[k]) m[k] = String(p.id); });
  return m;
}
/** Today's name rules for a custom field → {uso, prod}. ctx: {ops (field sits on an OPS customer), campos, peoplePks} */
function guessFieldUso_(name, pk, ctx) {
  ctx = ctx || {};
  const n = String(name || '');
  if (ctx.ops) {
    const id = ctx.campos && ctx.campos[norm_(n)];
    if (id) return { uso: 'producto', prod: id };
    if (/hora extra/i.test(n)) return { uso: 'hora extra', prod: '' };
    if (/adicional/i.test(n)) return { uso: 'costo adicional', prod: '' };
    if (/extra/i.test(n)) return { uso: 'extras', prod: '' };
  }
  if (pk && ctx.peoplePks && ctx.peoplePks[String(pk)]) return { uso: 'personas', prod: '' };
  if (PEOPLE_RE.test(n)) return { uso: 'personas', prod: '' };
  if (SEATS_RE.test(n)) return { uso: 'seats', prod: '' };
  return { uso: 'ignorar', prod: '' };
}
function guessRolTarifa_(short) { return /extern/i.test(String(short || '')) ? 'externo' : norm_(short); }

function entryFor_(tab, key, name) {
  if (!tab) return null;
  return tab[key] || (key.indexOf('n:') !== 0 && name ? tab['n:' + norm_(name)] : null) || null;
}
/** Uso of a customer's type: mapped by pk, else the name rule */
function typeUso_(M, c) {
  const e = M && entryFor_(M.ctype, ctKey_(c), custType_(c));
  return e ? e.uso : guessCtype_(custType_(c));
}
/** {uso, prod} of a custom_field_value: mapped by pk, else the name rule (people/seats only; bitácora rules need the OPS context) */
function fieldUso_(M, v, ctx) {
  const e = M && entryFor_(M.field, cfKey_(v), cfName_(v));
  return e ? { uso: e.uso, prod: e.prod || '' } : guessFieldUso_(cfName_(v), cfPk_(v), ctx);
}
/** {uso, prod} of a Bitácora row (matched by its Field pk; fallback 'n:'+name). productos: [{id, campo}] only for the unmapped default */
function bitUso_(row, M, productos) {
  const e = M && entryFor_(M.field, bitKey_(row), String(row[6] || ''));
  if (e) return { uso: e.uso, prod: e.prod || '' };
  return guessFieldUso_(row[6], row[7], { ops: true, campos: camposMap_(productos) });
}
/** Rol tarifa of a crew row (Tripulación: col 4 short name, col 8 Rol clave) */
function crewTarifa_(row, M) {
  const short = String(row[4] || '');
  const key = row[8] ? String(row[8]) : 'n:' + norm_(short);
  const e = M && entryFor_(M.role, key, short);
  return e ? String(e.tarifa || '') : guessRolTarifa_(short);
}

function ctxFor_(ss, tours) {
  const peoplePks = {};
  Object.keys(tours || {}).forEach(k => ((tours[k] || {}).fields || []).forEach(f => { peoplePks[String(f)] = true; }));
  const prods = readTab_(ss, 'Productos', PROD_HEADERS).filter(r => r[0] !== '').map(r => ({ id: String(r[0]), campo: r[7] }));
  return { campos: camposMap_(prods), peoplePks: peoplePks };
}

/** Pure: the three tabs' rows → M (rows are 1-based sheet rows, header = 1) */
function mapeosFromRows_(ctRows, cfRows, rolRows) {
  const M = { ctype: {}, field: {}, role: {} };
  const lc = v => String(v === null || v === undefined ? '' : v).toLowerCase().trim();
  const est = v => /nuevo/i.test(String(v || '')) ? ESTADO_NUEVO : ESTADO_OK;
  ctRows.forEach((r, i) => {
    if (r[0] === '' || r[0] === null) return;
    const u = lc(r[2]);
    M.ctype[String(r[0])] = { uso: USOS_CT.indexOf(u) >= 0 ? u : 'pax', estado: est(r[3]), nombre: String(r[1] || ''), visto: r[4], en: String(r[5] || ''), notas: String(r[6] || ''), row: i + 2 };
  });
  cfRows.forEach((r, i) => {
    if (r[0] === '' || r[0] === null) return;
    const u = lc(r[2]);
    M.field[String(r[0])] = { uso: USOS_CF.indexOf(u) >= 0 ? u : 'ignorar', prod: String(r[3] || '').trim(), estado: est(r[4]), nombre: String(r[1] || ''), visto: r[5], en: String(r[6] || ''), ejemplo: String(r[7] || ''), notas: String(r[8] || ''), row: i + 2 };
  });
  rolRows.forEach((r, i) => {
    if (r[0] === '' || r[0] === null) return;
    M.role[String(r[0])] = { tarifa: lc(r[3]), estado: est(r[4]), nombre: String(r[1] || ''), nombreRol: String(r[2] || ''), visto: r[5], en: String(r[6] || ''), notas: String(r[7] || ''), row: i + 2 };
  });
  return M;
}
/** Sheets: M from the three tabs, or null if any tab doesn't exist yet */
function loadMapeos_(ss) {
  if (!ss.getSheetByName(CT_TAB) || !ss.getSheetByName(CF_TAB) || !ss.getSheetByName(ROL_TAB)) return null;
  return mapeosFromRows_(readTab_(ss, CT_TAB, CT_HEADERS), readTab_(ss, CF_TAB, CF_HEADERS), readTab_(ss, ROL_TAB, ROL_HEADERS));
}

/** Pure: item for "Visto en" */
function seenIn_(b) {
  const item = ((b || {}).availability || {}).item || {};
  return (item.pk ? item.pk + ' · ' : '') + (item.name || '');
}
function sampleValue_(v) {
  const t = (v.display_value !== undefined && v.display_value !== null && v.display_value !== '') ? v.display_value : v.value;
  return String(t === undefined || t === null ? '' : t).slice(0, 60);
}
/** Pure: what one booking shows → {ctype:[{clave,nombre}], field:[{clave,nombre,ops,ejemplo}], role:[{clave,short,nombre}]} (de-duplicated) */
function observe_(b, M) {
  const out = { ctype: [], field: [], role: [] };
  const seenC = {}, seenF = {}, seenR = {};
  (b.customers || []).forEach(c => {
    const k = ctKey_(c);
    if (k === 'n:' || seenC[k]) return;
    seenC[k] = true; out.ctype.push({ clave: k, nombre: custType_(c) });
  });
  allCfvs_(b, M).forEach(x => {
    const k = cfKey_(x.v);
    if (k === 'n:') return;
    const o = seenF[k];
    if (o) { o.ops = o.ops || (x.level === 'customer' && x.ops); if (!o.ejemplo) o.ejemplo = sampleValue_(x.v); return; }
    seenF[k] = { clave: k, pk: cfPk_(x.v), nombre: cfName_(x.v), ops: x.level === 'customer' && x.ops, ejemplo: sampleValue_(x.v) };
    out.field.push(seenF[k]);
  });
  (((b.availability || {}).crew_members) || []).forEach(m => {
    const k = roleKey_(m);
    if (k === 'n:' || seenR[k]) return;
    seenR[k] = true; out.role.push({ clave: k, short: (m.role && m.role.short_name) || '', nombre: (m.role && m.role.name) || '' });
  });
  return out;
}

/**
 * Pure: finds what is not in M yet. Returns rows to append per tab (Estado "Nuevo – revisar", default Uso from the name rules)
 * and renames (known Clave, new name → only the Nombre column + "Antes: …" in Notas). Adds the new entries to M so
 * the same thing is never added twice.
 */
function collectUnknowns_(b, M, ctx, now) {
  const out = { ctype: [], field: [], role: [], renames: [] };
  if (!M) return out;
  const en = seenIn_(b), o = observe_(b, M);
  const rename = (kind, e, nuevo) => {
    if (!e || !nuevo || e.nombre === nuevo) return;
    if (e.row) out.renames.push({ kind: kind, row: e.row, nuevo: nuevo, antes: e.nombre });
    e.notas = (e.notas ? e.notas + ' | ' : '') + 'Antes: ' + e.nombre; e.nombre = nuevo;
  };
  o.ctype.forEach(x => {
    const e = entryFor_(M.ctype, x.clave, x.nombre);
    if (e) { rename('ctype', e, x.nombre); return; }
    const uso = guessCtype_(x.nombre);
    M.ctype[x.clave] = { uso: uso, estado: ESTADO_NUEVO, nombre: x.nombre, notas: '', row: 0 };
    out.ctype.push([x.clave, x.nombre, uso, ESTADO_NUEVO, now, en, '', '', '']);
  });
  o.field.forEach(x => {
    const e = entryFor_(M.field, x.clave, x.nombre);
    if (e) { rename('field', e, x.nombre); return; }
    const g = guessFieldUso_(x.nombre, x.pk, { ops: x.ops, campos: (ctx || {}).campos, peoplePks: (ctx || {}).peoplePks });
    M.field[x.clave] = { uso: g.uso, prod: g.prod, estado: ESTADO_NUEVO, nombre: x.nombre, notas: '', row: 0 };
    out.field.push([x.clave, x.nombre, g.uso, g.prod, ESTADO_NUEVO, now, en, x.ejemplo, '', '', '']);
  });
  o.role.forEach(x => {
    const e = entryFor_(M.role, x.clave, x.short);
    if (e) { rename('role', e, x.short); return; }
    const t = guessRolTarifa_(x.short);
    M.role[x.clave] = { tarifa: t, estado: ESTADO_NUEVO, nombre: x.short, notas: '', row: 0 };
    out.role.push([x.clave, x.short, x.nombre, t, ESTADO_NUEVO, now, en, '', '', '']);
  });
  return out;
}

const MAPEO_TABS_ = {
  ctype: { tab: CT_TAB, headers: CT_HEADERS, notas: 7 },
  field: { tab: CF_TAB, headers: CF_HEADERS, notas: 9 },
  role: { tab: ROL_TAB, headers: ROL_HEADERS, notas: 8 }
};
/** Sheets: collect unknowns from these bookings and append them (one setValues per tab). Returns how many rows were added. */
function registerUnknowns_(ss, bookings, M, ctx, now) {
  if (!M) return 0;
  const all = { ctype: [], field: [], role: [], renames: [] };
  bookings.forEach(b => {
    const u = collectUnknowns_(b, M, ctx, now);
    ['ctype', 'field', 'role', 'renames'].forEach(k => u[k].forEach(x => all[k].push(x)));
  });
  const n = all.ctype.length + all.field.length + all.role.length;
  if (!n && !all.renames.length) return 0;
  try { lockedRun_(() => {
    ['ctype', 'field', 'role'].forEach(k => {
      if (!all[k].length) return;
      const d = MAPEO_TABS_[k], sh = sheet_(ss, d.tab, d.headers);
      sh.getRange(sh.getLastRow() + 1, 1, all[k].length, d.headers.length).setValues(all[k]);
    });
    all.renames.forEach(r => {
      const d = MAPEO_TABS_[r.kind], sh = ss.getSheetByName(d.tab); if (!sh) return;
      sh.getRange(r.row, 2).setValue(r.nuevo);
      const c = sh.getRange(r.row, d.notas), old = String(c.getValue() || '');
      c.setValue((old ? old + ' | ' : '') + 'Antes: ' + r.antes);
    });
  }); } catch (err) { logError_(ss, 'Mapeos', err, ''); return 0; } // kept in Raw; the next rebuild adds them
  return n;
}
function lockedRun_(fn, ms) {
  const lock = LockService.getScriptLock(), had = lock.hasLock();
  if (!had) lock.waitLock(ms || 20000);
  try { return fn(); } finally { if (!had) { try { lock.releaseLock(); } catch (e) {} } }
}

/**
 * Pure: first-time seed from the bookings already in Raw, using TODAY's name rules, all Estado OK, so results on day 1 are
 * identical. entries: [{b, t}]; prodRows: Productos rows; tarRows: Tarifas rows; tours: map from toursFromRows_.
 * → {ctype:[rows], field:[rows], role:[rows]} in the tabs' column order.
 */
function seedMapeos_(entries, prodRows, tarRows, tours, now) {
  now = now || new Date();
  const prods = (prodRows || []).filter(r => r[0] !== '').map(r => ({ id: String(r[0]), campo: r[7] }));
  const ctx = { campos: camposMap_(prods), peoplePks: {} };
  Object.keys(tours || {}).forEach(k => ((tours[k] || {}).fields || []).forEach(f => { ctx.peoplePks[String(f)] = true; }));
  const ct = {}, cf = {}, rl = {};
  entries.forEach(e => {
    const b = e.b || {}, t = e.t || now, en = seenIn_(b);
    // customer types first; "ops" for a field = the customer's type by name rule is not a passenger
    (b.customers || []).forEach(c => {
      const k = ctKey_(c); if (k === 'n:') return;
      const o = ct[k] = ct[k] || { clave: k, t: t, en: en };
      o.nombre = custType_(c);
    });
    allCfvs_(b, null).forEach(x => {
      const k = cfKey_(x.v); if (k === 'n:') return;
      const o = cf[k] = cf[k] || { clave: k, pk: cfPk_(x.v), t: t, en: en, ops: false, ejemplo: '' };
      o.nombre = cfName_(x.v);
      if (x.level === 'customer' && x.ops) o.ops = true;
      if (!o.ejemplo) o.ejemplo = sampleValue_(x.v);
    });
    (((b.availability || {}).crew_members) || []).forEach(m => {
      const k = roleKey_(m); if (k === 'n:') return;
      const o = rl[k] = rl[k] || { clave: k, t: t, en: en };
      o.short = (m.role && m.role.short_name) || ''; o.nombre = (m.role && m.role.name) || '';
    });
  });
  const ctRows = Object.keys(ct).map(k => [k, ct[k].nombre, guessCtype_(ct[k].nombre), ESTADO_OK, ct[k].t, ct[k].en, '', 'Semilla', now]);
  const cfRows = Object.keys(cf).map(k => {
    const o = cf[k], g = guessFieldUso_(o.nombre, o.pk, { ops: o.ops, campos: ctx.campos, peoplePks: ctx.peoplePks });
    return [k, o.nombre, g.uso, g.prod, ESTADO_OK, o.t, o.en, o.ejemplo, '', 'Semilla', now];
  });
  const ruleRoles = (tarRows || []).map(r => norm_(r[0])).filter(x => x && x !== '*');
  const rolRows = Object.keys(rl).map(k => {
    const o = rl[k], tar = guessRolTarifa_(o.short);
    const nota = tar !== 'externo' && !ruleRoles.some(x => tar.indexOf(x) === 0) ? 'Sin regla en Tarifas' : '';
    return [k, o.short, o.nombre, tar, ESTADO_OK, o.t, o.en, nota, 'Semilla', now];
  });
  return { ctype: ctRows, field: cfRows, role: rolRows };
}

/** Sheets: every non-duplicate booking version in Raw, in order → [{b, t}] */
function rawEntries_(ss) {
  const raw = sheet_(ss, 'Raw', RAW_HEADERS), last = raw.getLastRow(), out = [];
  if (last < 2) return out;
  raw.getRange(2, 1, last - 1, RAW_HEADERS.length).getValues().forEach((v, i) => {
    if (v[2] === 'sí' || !v[3]) return;
    let json = String(v[11] || '');
    try {
      if (json.indexOf('DRIVE:') === 0) json = DriveApp.getFileById(json.slice(6)).getBlob().getDataAsString();
      const b = (JSON.parse(json) || {}).booking;
      if (b && b.pk) out.push({ b: b, t: v[0] });
    } catch (err) { logError_(ss, 'seed Raw fila ' + (i + 2), err, json); }
  });
  return out;
}
/** One-time + idempotent: Tours "Estado"/"Visto primero" columns, Tripulación "Rol clave" header */
function ensureTourCols_(ss) {
  const sh = ss.getSheetByName('Tours');
  if (!sh) return;
  if (sh.getRange(1, 8).getValue() !== TOURS_ESTADO_HDR) sh.getRange(1, 8).setValue(TOURS_ESTADO_HDR).setFontWeight('bold');
  if (sh.getRange(1, 9).getValue() !== TOURS_VISTO_HDR) sh.getRange(1, 9).setValue(TOURS_VISTO_HDR).setFontWeight('bold');
  const n = sh.getLastRow() - 1; if (n < 1) return;
  const vals = sh.getRange(2, 1, n, TOURS_COLS).getValues();
  const now = new Date();
  let changed = false;
  vals.forEach(r => {
    if (!r[0]) return;
    if (!String(r[7] || '').trim()) { r[7] = tourEstado_('', r[5]); changed = true; }
    if (r[7] === ESTADO_NUEVO && !r[8]) { r[8] = now; changed = true; }
  });
  if (changed) sh.getRange(2, 8, n, 2).setValues(vals.map(r => [r[7], r[8]]));
}
/**
 * Creates (and seeds from all of Raw) any mapping tab that doesn't exist yet. Never called by the webhook (too slow).
 * Returns true if it seeded something.
 */
function ensureMapeos_(ss) {
  loadTours_(ss);
  ensureTourCols_(ss);
  const trip = ss.getSheetByName('Tripulación');
  if (trip && trip.getRange(1, CREW_HEADERS.length).getValue() !== CREW_HEADERS[CREW_HEADERS.length - 1]) {
    trip.getRange(1, 1, 1, CREW_HEADERS.length).setValues([CREW_HEADERS]).setFontWeight('bold');
  }
  const missing = [CT_TAB, CF_TAB, ROL_TAB].filter(n => !ss.getSheetByName(n));
  if (!missing.length) return false;
  const tours = loadTours_(ss);
  const prodRows = readTab_(seedTab_(ss, 'Productos', PROD_HEADERS, PROD_SEED).getParent(), 'Productos', PROD_HEADERS);
  const tarRows = readTab_(seedTab_(ss, 'Tarifas', TAR_HEADERS, TAR_SEED).getParent(), 'Tarifas', TAR_HEADERS);
  const seed = seedMapeos_(rawEntries_(ss), prodRows, tarRows, tours, new Date());
  try {
    return lockedRun_(() => {
    const defs = [[CT_TAB, CT_HEADERS, seed.ctype], [CF_TAB, CF_HEADERS, seed.field], [ROL_TAB, ROL_HEADERS, seed.role]];
    let did = false;
    defs.forEach(([name, headers, rows]) => {
      if (ss.getSheetByName(name)) return; // created meanwhile
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1 + rows.length, headers.length).setValues([headers].concat(rows));
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sh.setFrozenRows(1);
      did = true;
    });
    return did;
    }, 25000);
  } catch (err) { logError_(ss, 'Mapeos (semilla)', err, ''); return false; } // no lock: try again next time
}

// Admin: Estado → OK + values. Pure validation, returns the normalized values or throws a Spanish message.
const ITEM_TIPOS_ = ['compartido', 'privado', 'renta', 'otro'];
function validateMapeo_(kind, valores, ctx) {
  const v = valores || {}, ids = (ctx && ctx.prodIds) || [], barcos = (ctx && ctx.barcos) || [];
  const lc = x => String(x === null || x === undefined ? '' : x).toLowerCase().trim();
  if (kind === 'tipo') {
    const uso = lc(v.uso);
    if (USOS_CT.indexOf(uso) < 0) throw new Error('Uso inválido para el tipo de cliente');
    return { uso: uso };
  }
  if (kind === 'campo') {
    const uso = lc(v.uso);
    if (USOS_CF.indexOf(uso) < 0) throw new Error('Uso inválido para el campo');
    if (uso === 'producto') {
      const prod = String(v.prod === undefined || v.prod === null ? '' : v.prod).trim();
      if (!prod) throw new Error('Elige el producto');
      if (ids.indexOf(prod) < 0) throw new Error('Producto desconocido: ' + prod);
      return { uso: uso, prod: prod };
    }
    return { uso: uso, prod: '' };
  }
  if (kind === 'rol') {
    const t = norm_(v.tarifa);
    if (!t) throw new Error('Falta el rol de tarifa');
    if (t.length > 60) throw new Error('El rol es demasiado largo');
    return { tarifa: t };
  }
  if (kind === 'item') {
    const tipo = lc(v.tipo), barco = lc(v.barco);
    if (ITEM_TIPOS_.indexOf(tipo) < 0) throw new Error('Tipo de tour inválido');
    if (barcos.indexOf(barco) < 0) throw new Error('Tipo de barco inválido');
    const list = Array.isArray(v.fields) ? v.fields : String(v.fields || '').split(',');
    const fields = list.map(x => String(x).trim()).filter(String);
    if (fields.some(f => !/^\d+$/.test(f))) throw new Error('Los campos de personas deben ser números (pk)');
    const bit = lc(v.bitacora);
    if (bit !== 'sí' && bit !== 'si' && bit !== 'no') throw new Error('Bitácora debe ser sí o no');
    return { tipo: tipo, barco: barco, fields: fields.filter((f, i) => fields.indexOf(f) === i).join(','), bitacora: bit === 'no' ? 'no' : 'sí' };
  }
  throw new Error('Tipo de configuración desconocido');
}

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

if (typeof module !== 'undefined') module.exports = { ctKey_, cfKey_, roleKey_, guessCtype_, guessFieldUso_, guessRolTarifa_, camposMap_, typeUso_, fieldUso_, bitUso_, crewTarifa_,
  mapeosFromRows_, observe_, collectUnknowns_, seedMapeos_, validateMapeo_, toursFromRows_, tourEstado_, TOURS_SEED_ROWS: TOURS_SEED, USOS_CT, USOS_CF,
  CT_HEADERS, CF_HEADERS, ROL_HEADERS, CREW_HEADERS, BIT_HEADERS, ESTADO_NUEVO, ESTADO_OK, rawRowFor_, doPost, rebuildFinanzas, rebuildAll, ensureMapeos_, loadMapeos_,
  registerUnknowns_, prepararMapeos, parseCostos_, costoAdicionalText_, EXT_HEADERS, COSTO_HEADERS, bitacoraNoAplica_, bitacoraRuleStale_, markBitacoraSi_, BITACORA_RULE_V, reservaRow_, frutaSalida_, bookingPax_, computeSalida_, opsType_, cfvNumber_, parseCsv_, parseReport_, parseMoney_, controlRows_, incomeCells_, findRate_, weekStart_, payForSalida_, consumoSalida_, allocateFruta_, TAR_SEED, PROD_SEED, hoursBetween_, resourcesFrom_, resFromText_, salHeaderStale_, resHeaderStale_, planStaffMeals_, ensureStaffMeals_, RES_HEADERS, SAL_HEADERS };

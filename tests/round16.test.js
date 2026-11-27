// Round 16: money detail of a booking (display only): Reservas columns, report Processing Fees, getData fields, booking sheet block.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { loadNew, J, test, fakeSpreadsheet, fakeEnv } = require('./lib');
const F = require('./fixtures');
const N = loadNew(), E = N.ex;
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');

const full = () => {
  const p = F.booking({ pk: 8001, av: 9500, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: F.T(24, 14), end: F.T(24, 17), paid: 100000, customers: [F.cust(100, 'Adult')] });
  const b = p.booking;
  b.receipt_subtotal = 72414; b.receipt_taxes = 11586; b.receipt_total = 84000; b.invoice_price = 84000; b.amount_paid = 84000;
  b.custom_field_values = [
    Object.assign(F.cfv(700, 'Promo Last minute', 'TheYak10', 'TheYak10'), { total_cost: { total: -8500 } }),
    Object.assign(F.cfv(701, 'Card processing fee (4%)', 'Sí', 'Sí'), { total_cost: { total: 3360 } }),
    F.cfv(555, 'Hotel', 'Magic')];
  b.payments = [{ type: 'card', amount_paid: 58300, refunds: [] }, { type: 'affiliate', amount_paid: 25700, refunds: [{ amount: 10000 }] }, { type: 'in-store', in_store_payment_type: 'cash', amount_paid: 0 }];
  return p;
};

test('pure helpers: discounts (total < 0), surcharges (> 0), payments with refunds, refunded total', () => {
  const b = full().booking;
  assert.strictEqual(E.descuentosText_(b), 'Promo Last minute · TheYak10 · -85');
  assert.strictEqual(E.cargosText_(b), 'Card processing fee (4%) · Sí · 33.6');
  assert.strictEqual(E.pagosText_(b), 'card 583 | affiliate 257 | reembolso -100 | cash 0');
  assert.strictEqual(E.reembolsadoTotal_(b), 100);
  const two = full().booking; two.custom_field_values.push(Object.assign(F.cfv(702, 'Otro', ''), { total_cost: { total: -1000 } }));
  assert.strictEqual(E.descuentosText_(two), 'Promo Last minute · TheYak10 · -85 | Otro · -10');
});

test('moneyCells_: 7 values in order; absent keys → "" (short-form backfill payloads), 0 is kept; fee from ing', () => {
  const b = full().booking;
  assert.deepStrictEqual(J(E.moneyCells_(b, '', {})), [724.14, 115.86, 'Promo Last minute · TheYak10 · -85', 'Card processing fee (4%) · Sí · 33.6', 'card 583 | affiliate 257 | reembolso -100 | cash 0', 100, '']);
  assert.strictEqual(E.moneyCells_(b, '', { 'fee:8001': 33.6 })[6], 33.6);
  assert.strictEqual(E.moneyCells_(b, '', { 'fee:8001': 0 })[6], 0, 'cash = no fee, kept as 0');
  const short = { pk: 8002, _source: 'backfill', receipt_total: 5000, amount_paid: 5000, invoice_price: 0 };
  assert.deepStrictEqual(J(E.moneyCells_(short, '', {})), ['', '', '', '', '', '', '']);
  assert.strictEqual(E.moneyCells_(b, 'Salida', { 'fee:8001': 5 })[6], '', 'OPS rows carry no fee');
});

test('RES_HEADERS: new columns appended at the END in order; earlier columns did not move; stale header triggers recompute', () => {
  const H = E.RES_HEADERS;
  assert.deepStrictEqual(J(H.slice(-11, -4)), ['Subtotal (MXN)', 'IVA (MXN)', 'Descuentos', 'Cargos extra', 'Pagos', 'Reembolsado (MXN)', 'Comisión procesamiento (MXN)']);
  assert.strictEqual(H.indexOf('Teléfono'), 37);
  assert.strictEqual(E.resHeaderStale_(H.slice(0, H.length - 11)), true);
  assert.strictEqual(E.resHeaderStale_(H), false);
  assert.strictEqual(E.reservaRow_(full().booking, 'now', 5, { 258806: { tipo: 'compartido', fields: [] } }, {}, null).length, H.length);
});

test('parseReport_: Processing Fees column optional; per-line fee; CSVs without it still parse', () => {
  const withFee = E.parseReport_(E.parseCsv_('#,Net Revenue Collected,Processing Fees\n8001,"$1,000.50",$40.02\n8001,200,\n8003,300,0'));
  assert.strictEqual(withFee.hasFee, true);
  assert.deepStrictEqual(J(withFee.lines.map(l => [l.id, l.net, l.fee])), [['8001', 1000.5, 40.02], ['8001', 200, null], ['8003', 300, 0]]);
  const none = E.parseReport_(E.parseCsv_('#,Net Revenue Collected\n8001,500'));
  assert.strictEqual(none.hasFee, false); assert.strictEqual(none.lines[0].fee, null); assert.strictEqual(none.error, '');
});

function env() {
  const ss = fakeSpreadsheet(), fe = fakeEnv(ss);
  fe.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
  const G = loadNew(fe);
  const rows = name => { const sh = ss.getSheetByName(name); return sh ? sh._d.rows.slice(1).filter(r => r.some(v => v !== '')) : null; };
  return { ss, G, rows, post: payload => G.ex.doPost({ postData: { contents: JSON.stringify(payload) } }) };
}
test('end to end: webhook fills the money columns; report fee lands in Reservas + Ingresos; rebuildAll keeps it; report without the column keeps working', () => {
  const e = env(), H = N.ex.RES_HEADERS, col = n => H.indexOf(n);
  e.post(full()); e.G.ex.ensureMapeos_(e.ss); e.G.ex.rebuildAll();
  let r = e.rows('Reservas').find(x => x[0] === 8001);
  assert.strictEqual(r[col('Subtotal (MXN)')], 724.14); assert.strictEqual(r[col('Descuentos')], 'Promo Last minute · TheYak10 · -85');
  assert.strictEqual(r[col('Comisión procesamiento (MXN)')], '');
  const net0 = r[col('Ingreso neto (MXN)')];
  const out = e.G.ex.importReport_(e.ss, '#,Net Revenue Collected,Processing Fees\n8001,800.64,33.60', 'a.csv');
  assert.strictEqual(out.ok, true);
  r = e.rows('Reservas').find(x => x[0] === 8001);
  assert.strictEqual(r[col('Comisión procesamiento (MXN)')], 33.6); assert.strictEqual(r[col('Ingreso neto (MXN)')], 834.24, 'neto = Net Revenue Collected + fee');
  const ing = e.rows('Ingresos'); assert.strictEqual(ing[0][6], 33.6);
  assert.strictEqual(e.ss.getSheetByName('Ingresos')._d.rows[0][6], 'Comisión procesamiento');
  e.G.ex.rebuildAll();
  r = e.rows('Reservas').find(x => x[0] === 8001);
  assert.strictEqual(r[col('Comisión procesamiento (MXN)')], 33.6, 'fee read back from Ingresos on a full rebuild');
  assert.strictEqual(r[col('Ingreso neto (MXN)')], 834.24);
  const out2 = e.G.ex.importReport_(e.ss, '#,Net Revenue Collected\n8001,801', 'b.csv');
  assert.strictEqual(out2.ok, true);
  r = e.rows('Reservas').find(x => x[0] === 8001);
  assert.strictEqual(r[col('Ingreso neto (MXN)')], 834.6); assert.strictEqual(r[col('Comisión procesamiento (MXN)')], 33.6, 'no fee column in the new report: previous fee stays');
  assert.notStrictEqual(net0, 801);
});

test('moneyFrom_ / getData: booking objects carry sub, iva, tot, inv, paid, saldo, disc, extra, pays, refund, fee; unknown = null', () => {
  const H = N.ex.RES_HEADERS, row = Array(H.length).fill('');
  row[22] = 840; row[23] = 583; row[24] = 840;
  Object.assign(row, { 38: 724.14, 39: 115.86, 40: 'Promo Last minute · TheYak10 · -85 | Otro · -10', 41: 'Card processing fee (4%) · 33.6', 42: 'card 583 | affiliate 257 | reembolso -100', 43: 100, 44: 33.6 });
  const m = J(N.ex.moneyFrom_ ? N.ex.moneyFrom_(row) : require('../apps-script/app.gs').moneyFrom_(row));
  assert.deepStrictEqual(m, { sub: 724.14, iva: 115.86, tot: 840, inv: 840, paid: 583, saldo: 257, disc: [{ n: 'Promo Last minute', code: 'TheYak10', v: -85 }, { n: 'Otro', code: '', v: -10 }], extra: [{ n: 'Card processing fee (4%)', code: '', v: 33.6 }], pays: [{ t: 'card', v: 583 }, { t: 'affiliate', v: 257 }], refund: 100, fee: 33.6 });
  const short = Array(H.length).fill(''); short[22] = 500; short[23] = 500;
  assert.deepStrictEqual(J(N.ex.moneyFrom_(short)), { sub: null, iva: null, tot: 500, inv: null, paid: 500, saldo: 0, disc: [], extra: [], pays: [], refund: null, fee: null });
  const unk = Array(H.length).fill(''); assert.strictEqual(N.ex.moneyFrom_(unk).saldo, null);
});

// ---- UI: moneyRows (PURE block of docs/index.html) ----
const pure = html.slice(html.indexOf('// ==PURE-BEGIN=='), html.indexOf('// ==PURE-END=='));
const U = vm.runInNewContext(pure + '\n({moneyRows, fmt})', {});
const txt = R => J(R.map(x => [x.l, x.v.replace(/<[^>]+>/g, ''), x.cls || '', !!x.tot]));
test('UI moneyRows: full booking — Subtotal · Descuento · Cargo · IVA · Total · Invoice · Pagado (tipos) · Reembolsado · Saldo · Comisión · Neto', () => {
  const b = { gross: 840, sub: 724.14, iva: 115.86, tot: 840, inv: 840, paid: 583, saldo: 257, disc: [{ n: 'Promo Last minute', code: 'TheYak10', v: -85 }], extra: [{ n: 'Card processing fee (4%)', code: '', v: 33.6 }], pays: [{ t: 'card', v: 583 }, { t: 'affiliate', v: 0 }], refund: 100, fee: 33.6, net: 800.64, est: false };
  assert.deepStrictEqual(txt(U.moneyRows(b)), [
    ['Subtotal', '$724.14', '', false], ['Descuento · Promo Last minute (TheYak10)', '−$85', '', false], ['Cargo · Card processing fee (4%)', '$33.6', '', false],
    ['IVA', '$115.86', '', false], ['Total', '$840', '', true], ['Invoice amount', '$840', '', false], ['Pagado · tarjeta / afiliado', '$583', '', false],
    ['Reembolsado', '$100', '', false], ['Saldo', '$257', 'warn', false], ['Comisión procesamiento', '$33.6', '', false], ['Neto', '$800.64 reporte', 'pos', false]]);
  assert.ok(U.moneyRows(Object.assign({}, b, { est: true })).pop().v.indexOf('est.') > 0);
});
test('UI moneyRows: short-form / unknown values — "—" only for Subtotal and IVA; saldo 0, no refund, unknown fee hidden', () => {
  const R = txt(U.moneyRows({ gross: 500, tot: 500, paid: 500, saldo: 0, sub: null, iva: null, inv: null, disc: [], extra: [], pays: [], refund: null, fee: null, net: null }));
  assert.deepStrictEqual(R, [['Subtotal', '—', '', false], ['IVA', '—', '', false], ['Total', '$500', '', true], ['Pagado', '$500', '', false]]);
  const old = txt(U.moneyRows({ gross: 300, paid: 100, net: 250, est: true })); // older cached getData without the new fields
  assert.deepStrictEqual(old.map(x => x[0]), ['Subtotal', 'IVA', 'Total', 'Pagado', 'Neto']);
});
test('UI wiring: booking sheet uses moneyRows in the dlist block; APP_VER = sw CACHE', () => {
  assert.ok(html.indexOf('moneyRows(b).map') > 0);
  assert.ok(/const APP_VER='v(1[3-9]|2\d)'/.test(html));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sw.js'), 'utf8').indexOf("const CACHE = 'al-ops-" + /const APP_VER='(v\d+)'/.exec(html)[1] + "'") >= 0);
});

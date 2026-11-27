// Round 19: external boat cost from the Capitán Externo note, Ingreso neto + processing fee, no pull-to-refresh.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { test, loadNew, J } = require('./lib');
const G = loadNew(), E = G.ex;
const ROOT = path.join(__dirname, '..');

test('barcoNota_: "Barco: X" from any crew note, (externo) and trailing parts removed', () => {
  assert.strictEqual(E.barcoNota_('Barco: El Cormoran'), 'El Cormoran');
  assert.strictEqual(E.barcoNota_('Barco: San Ángel (externo) – Juan Pérez – $3,500'), 'San Ángel');
  assert.strictEqual(E.barcoNota_('barco:La Ramona - Juan'), 'La Ramona');
  assert.strictEqual(E.barcoNota_('Juan Pérez'), ''); assert.strictEqual(E.barcoNota_(''), ''); assert.strictEqual(E.barcoNota_(null), '');
});
test('externoNota_: barco, persona, monto with – — - and amount formats', () => {
  const f = n => J(E.externoNota_(n));
  assert.deepStrictEqual(f('Barco: San Ángel (externo) – Juan Pérez – $3,500'), { barco: 'San Ángel', persona: 'Juan Pérez', monto: 3500 });
  assert.deepStrictEqual(f('Barco: San Ángel (externo) - Juan Pérez - 3500 pesos'), { barco: 'San Ángel', persona: 'Juan Pérez', monto: 3500 });
  assert.deepStrictEqual(f('Barco: San Ángel (externo) — Juan Pérez — $3.500'), { barco: 'San Ángel', persona: 'Juan Pérez', monto: 3500 });
  assert.deepStrictEqual(f('Barco: San Ángel (externo) - Juan Pérez - $2500'), { barco: 'San Ángel', persona: 'Juan Pérez', monto: 2500 });
  assert.deepStrictEqual(f('Barco: San Ángel (externo) – Juan Pérez'), { barco: 'San Ángel', persona: 'Juan Pérez', monto: null });
  assert.deepStrictEqual(f('Barco: Lancha 2 (externo) – Pedro – $900'), { barco: 'Lancha 2', persona: 'Pedro', monto: 900 }, 'digits in the boat name are not money');
  assert.deepStrictEqual(f(''), { barco: '', persona: '', monto: null });
});

const TAR = [];
const sal = ['9100', '', 'Tour', '', '', '', new Date('2026-11-20T15:00:00Z'), new Date('2026-11-20T18:00:00Z'), 5];
const NOW = new Date('2026-11-21T15:00:00Z'), BEFORE = new Date('2026-11-20T15:30:00Z');
const extCrew = note => ['9100', '', '', '', 'Capitan', 'Capitan Externo', 'capitan.externo', note, ''];
const costRow = t => ['9100', '', '', '', '', 'Regreso', 'Costos adicionales', '', '', t, '', '', ''];
const pay = (crew, bit, now) => J(E.payForSalida_(sal, crew, bit, TAR, 'ponton', null, now || NOW));

test('Externos: amount from the note; boat + persona columns; note wins over bitácora', () => {
  assert.strictEqual(E.EXT_HEADERS.slice(-3).join('|'), 'Monto (MXN)|Barco|Persona');
  const r = pay([extCrew('Barco: San Ángel (externo) – Juan Pérez – $3,500')], [costRow('Barco externo San Ángel: $2,500 · gasolina $300')]);
  assert.strictEqual(r.ext[0][8], 3500); assert.strictEqual(r.ext[0][9], 'San Ángel'); assert.strictEqual(r.ext[0][10], 'Juan Pérez'); assert.strictEqual(r.ext[0][7], '');
  assert.strictEqual(r.extMonto, 3500);
});
test('Externos: fallback to bitácora "barco externo" lines when the note has no amount; new alert text', () => {
  const r = pay([extCrew('Barco: San Ángel (externo) – Juan Pérez')], [costRow('Barco externo San Ángel: $2,500 · gasolina $300')]);
  assert.strictEqual(r.ext[0][8], 2500); assert.strictEqual(r.extMonto, 2500);
  const none = pay([extCrew('Barco: San Ángel (externo) – Juan Pérez')], []);
  assert.strictEqual(none.ext[0][7], 'Falta costo en la nota del Capitán Externo');
  assert.strictEqual(pay([extCrew('Barco: San Ángel (externo) – Juan Pérez')], [], BEFORE).ext[0][7], '', 'only after the departure ended');
  assert.strictEqual(pay([extCrew('')], [], NOW).ext[0][7], 'Falta nota: ¿a quién se debe? | Falta costo en la nota del Capitán Externo');
});

test('Costos salida counts the external cost once (note wins; bitácora non-external items kept)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8');
  assert.ok(/costoAd = Math\.round\(\(otros \+ \(p\.extMonto/.test(src) && /\+ trip \+ costoAd/.test(src) && /alerts\.join\(' \| '\), costoAd, r2_\(aj\)\]/.test(src));
  assert.ok(!/trip \+ cos\.total/.test(src), 'cos.total (which includes the external lines) is no longer added');
});

test('exactNet_ / incomeCells_: Ingreso neto = Net Revenue Collected + fee; unknown fee → unchanged; estimate untouched', () => {
  assert.strictEqual(E.exactNet_({ '1': 800.64, 'fee:1': 33.6 }, 1), 834.24);
  assert.strictEqual(E.exactNet_({ '1': 800.64 }, 1), 800.64);
  assert.strictEqual(E.exactNet_({ '1': 800.64, 'fee:1': 0 }, 1), 800.64);
  const b = { pk: 1, status: 'booked' };
  assert.deepStrictEqual(J(E.incomeCells_(b, 'booked', false, { '1': 100, 'fee:1': 5 })), [105, '']);
  assert.ok(/^\d+$/.test(E.BITACORA_RULE_V)); assert.strictEqual(E.bitacoraRuleStale_('5'), true);
});

test('app: crew bc in getData source, boat shown in departure detail, no pull-to-refresh, refresh button kept, versions bumped', () => {
  const app = fs.readFileSync(path.join(ROOT, 'apps-script/app.gs'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'docs/index.html'), 'utf8'), sw = fs.readFileSync(path.join(ROOT, 'docs/sw.js'), 'utf8');
  assert.ok((app.match(/bc: (String\(x\[9\] \|\| ''\) \|\| )?barcoNota_\(nt\)/g) || []).length === 3);
  assert.ok(/html,body\{[^}]*overscroll-behavior-y:none/.test(html) && /\.sheet,\.srwrap\{overscroll-behavior-y:none/.test(html));
  assert.ok(!/touchmove|touchstart/.test(html) && html.includes('data-refresh'));
  assert.ok(sw.includes("'al-ops-" + /const APP_VER='(v\d+)'/.exec(html)[1] + "'")); // current version: round20.test.js
  assert.ok(!/Falta monto en Costos adicionales/.test(html + app + fs.readFileSync(path.join(ROOT, 'apps-script/Code.gs'), 'utf8')));
});

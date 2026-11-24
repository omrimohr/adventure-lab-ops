// Pure UI helpers of docs/index.html (block between PURE-BEGIN / PURE-END), run in node without a DOM.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { test } = require('./lib');
const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'index.html'), 'utf8');
const m = /\/\/ ==PURE-BEGIN==[^\n]*\n([\s\S]*?)\/\/ ==PURE-END==/.exec(html);
const names = 'fdate fdt fixDates wkLabel hid hids personasTxt typesLine relAgo advanceClock bitParts money2 cacheKey strHash addD wkStart fmt esc CACHE_MAX'.split(' ');
const U = vm.runInNewContext(m[1] + '\n({' + names.join(',') + '})', {});

test('UI: dates always "dom. 15/nov 2026" (3-letter weekday + dot, day/month, year)', () => {
  assert.strictEqual(U.fdate('2026-11-15'), 'dom. 15/nov 2026');
  assert.strictEqual(U.fdate('2026-01-05'), 'lun. 5/ene 2026');
  assert.strictEqual(U.fdate('2026-11-18'), 'mié. 18/nov 2026');
  assert.strictEqual(U.fdate('2026-11-19', true), 'jue. 19/nov');
  assert.strictEqual(U.fdt('2026-11-24 10:15'), 'mar. 24/nov 2026 10:15');
  assert.strictEqual(U.fdt(''), '');
  assert.strictEqual(U.fixDates('Falta bitácora: 2026-11-23 14:00 Private Boat Tour'), 'Falta bitácora: lun. 23/nov 2026 14:00 Private Boat Tour');
  assert.strictEqual(U.fixDates('Falta reporte de Comercial del 2026-11-23'), 'Falta reporte de Comercial del lun. 23/nov 2026');
  assert.strictEqual(U.wkLabel('2026-11-19'), 'Semana jue. 19/nov – mié. 25/nov 2026');
  assert.strictEqual(U.wkLabel('2026-12-31'), 'Semana jue. 31/dic – mié. 6/ene 2027');
});

test('UI: "#" appears exactly once', () => {
  assert.strictEqual(U.hid('#123'), '#123');
  assert.strictEqual(U.hid('123'), '#123');
  assert.strictEqual(U.hid('##123'), '#123');
  assert.strictEqual(U.hid(' # 123'), '#123');
  assert.strictEqual(U.hid(''), '');
  assert.strictEqual(U.hid(null), '');
  assert.strictEqual(U.hid('ABC#12'), 'ABC#12', 'a # inside the id is kept, none is added');
  assert.strictEqual(U.hids('#1, 2,##3'), '#1, #2, #3');
  assert.strictEqual(U.hids(''), '');
});

test('UI: customer-type breakdown only with more than one distinct type; never "pax" + "Adult" saying the same thing', () => {
  assert.strictEqual(U.typesLine('2× Adult'), '');
  assert.strictEqual(U.typesLine(''), '');
  assert.strictEqual(U.typesLine('2× Adult, 1× Child'), '2 Adult · 1 Child');
  assert.strictEqual(U.typesLine('2× Adult, 18+, 1× Child'), '2 Adult, 18+ · 1 Child', 'commas inside a type name survive');
  assert.strictEqual(U.personasTxt(1), '1 pax'); assert.strictEqual(U.personasTxt(13), '13 pax');
});

test('UI: relative update time (min / h / días / date after 7 days)', () => {
  const t = Date.parse('2026-11-24T12:00:00'), at = x => t - x;
  assert.strictEqual(U.relAgo(at(20000), t), 'ahora');
  assert.strictEqual(U.relAgo(at(60000), t), 'hace 1 min');
  assert.strictEqual(U.relAgo(at(59 * 60000), t), 'hace 59 min');
  assert.strictEqual(U.relAgo(at(3600000), t), 'hace 1 h');
  assert.strictEqual(U.relAgo(at(23.9 * 3600000), t), 'hace 23 h');
  assert.strictEqual(U.relAgo(at(24 * 3600000), t), 'hace 1 día');
  assert.strictEqual(U.relAgo(at(3 * 86400000), t), 'hace 3 días');
  assert.strictEqual(U.relAgo(at(7 * 86400000), t), 'hace 7 días');
  assert.strictEqual(U.relAgo(at(8 * 86400000), t), 'lun. 16/nov 2026');
  assert.strictEqual(U.relAgo(t + 5000, t), 'ahora');
});

test('UI: advanceClock moves server time forward by the cached age (and over midnight)', () => {
  assert.deepStrictEqual({ ...U.advanceClock('2026-11-24', '10:15', 25 * 60000) }, { today: '2026-11-24', now: '10:40' });
  assert.deepStrictEqual({ ...U.advanceClock('2026-11-24', '23:30', 45 * 60000) }, { today: '2026-11-25', now: '00:15' });
  assert.deepStrictEqual({ ...U.advanceClock('2026-11-30', '08:00', 26 * 3600000) }, { today: '2026-12-01', now: '10:00' });
  assert.deepStrictEqual({ ...U.advanceClock('2026-11-24', '10:15', -5) }, { today: '2026-11-24', now: '10:15' });
});

const dep = o => Object.assign({ date: '2026-11-24', time: '10:00', end: '2026-11-24 13:00', bit: 'Sin bitácora', bookings: [{}] }, o);
test('UI: bitácora Ida/Regreso states — done / late (started / ended) / wait; no aplica', () => {
  const at = k => U.bitParts(dep({ bit: k.bit }), k.now);
  assert.deepStrictEqual({ ...at({ bit: 'Sin bitácora', now: '2026-11-24 09:00' }) }, { na: false, ida: 'wait', reg: 'wait' });
  assert.deepStrictEqual({ ...at({ bit: 'Sin bitácora', now: '2026-11-24 10:00' }) }, { na: false, ida: 'late', reg: 'wait' }, 'Ida overdue once the departure started');
  assert.deepStrictEqual({ ...at({ bit: 'Falta regreso', now: '2026-11-24 12:00' }) }, { na: false, ida: 'done', reg: 'wait' });
  assert.deepStrictEqual({ ...at({ bit: 'Falta regreso', now: '2026-11-24 13:01' }) }, { na: false, ida: 'done', reg: 'late' }, 'Regreso overdue once it ended');
  assert.deepStrictEqual({ ...at({ bit: 'Falta salida', now: '2026-11-24 14:00' }) }, { na: false, ida: 'late', reg: 'done' });
  assert.deepStrictEqual({ ...at({ bit: 'Completa', now: '2026-11-25 14:00' }) }, { na: false, ida: 'done', reg: 'done' });
  assert.strictEqual(at({ bit: 'No aplica', now: '2026-11-24 14:00' }).na, true);
  assert.strictEqual(U.bitParts(dep({ bit: 'Sin bitácora', bookings: [] }), '2026-11-24 14:00').na, true, 'no active bookings → nothing to log');
  assert.strictEqual(U.bitParts(dep({ end: '' , bit: 'Sin bitácora' }), '2026-11-24 10:30').reg, 'late', 'no end time → falls back to the start');
});

test('UI: money2 — gross (green) + net (gray, "neto", "est.") one component', () => {
  const a = U.money2(2500, 2100, false), b = U.money2(2500, 2100, true), c = U.money2(2500, null), d = U.money2(2500, undefined), e = U.money2(undefined, 5);
  assert.ok(/class="mg">\$2,500</.test(a) && /<small>neto<\/small> \$2,100/.test(a) && !/est\./.test(a));
  assert.ok(/neto<\/small> \$2,100 <em>est\.<\/em>/.test(b));
  assert.ok(/neto pendiente/.test(c) && !/class="mn"/.test(c));
  assert.ok(!/mn/.test(d.replace('m2', '')) , 'net hidden when undefined');
  assert.ok(/class="mg">—</.test(e));
  assert.ok(/m2 big/.test(U.money2(1, 1, false, true)));
});

test('UI: cache keys are per user (hash of the PIN) and range; the PIN itself is not in the key', () => {
  const k = U.cacheKey('1234', '', ''), k2 = U.cacheKey('1235', '', ''), k3 = U.cacheKey('1234', '2026-11-01', '2026-12-01');
  assert.ok(k !== k2 && k !== k3 && !/1234/.test(k) && /^adv_ops_c:/.test(k));
  assert.strictEqual(k, U.cacheKey('1234', '', ''));
  assert.ok(U.CACHE_MAX === 2000000);
});

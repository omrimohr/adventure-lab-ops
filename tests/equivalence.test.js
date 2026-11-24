// EQUIVALENCE: old name-based code (git OLD_REF) vs new pk-mapping code seeded from the same payloads → identical outputs.
const assert = require('assert');
const { loadNew, loadOld, J, test } = require('./lib');
const F = require('./fixtures');

const N = loadNew(), O = loadOld();
const NOW = new Date('2026-11-24T12:00:00Z');
const PROD_SEED = N.get('PROD_SEED'), TAR_SEED = N.get('TAR_SEED'), TOURS_SEED = N.get('TOURS_SEED'), BARCO_SEED = N.get('BARCO_SEED');
const tours = J(N.ex.toursFromRows_(TOURS_SEED));
const productos = PROD_SEED.map(r => ({ id: String(r[0]), campo: r[7] }));
const entries = F.ALL.map((x, i) => ({ b: x.booking, t: new Date(Date.UTC(2026, 10, 1, 12, i)) }));
const seed = J(N.ex.seedMapeos_(entries, PROD_SEED, TAR_SEED, tours, NOW));
const M = N.ex.mapeosFromRows_(seed.ctype, seed.field, seed.role);
const same = (a, b, msg) => assert.deepStrictEqual(J(a), J(b), msg);
const departures = Object.keys(F.DEPARTURES).map(av => ({ av: av, list: F.DEPARTURES[av].map((p, i) => ({ b: p.booking, row: i + 2 })) }));

test('seed: every key in the payloads is mapped, all Estado OK, with today\'s name-rule uso', () => {
  assert.ok(seed.ctype.length >= 7 && seed.field.length >= 12 && seed.role.length >= 5);
  [].concat(seed.ctype, seed.field.map(r => [r[0], r[1], r[2], r[4]]), seed.role.map(r => [r[0], r[1], r[2], r[4]])).forEach(r => {
    assert.ok(/^OK$/.test(r[3]) || /^OK$/.test(r[4]) , 'Estado OK');
  });
  const ct = Object.fromEntries(seed.ctype.map(r => [r[0], r[2]]));
  assert.deepStrictEqual([ct['1331886'], ct['1332005'], ct['100'], ct['102'], ct['1999']], ['ops salida', 'ops regreso', 'pax', 'pax', 'no cuenta']);
  const cf = Object.fromEntries(seed.field.map(r => [r[0], [r[2], r[3]]]));
  assert.deepStrictEqual(cf['2024601'], ['producto', 'cer']);
  assert.deepStrictEqual(cf['2024635'], ['producto', 'fru']);
  assert.deepStrictEqual(cf['2024640'], ['hora extra', '']);
  assert.deepStrictEqual(cf['2024641'], ['extras', '']);
  assert.deepStrictEqual(cf['2024642'], ['costo adicional', '']);
  assert.deepStrictEqual(cf['2024650'], ['ignorar', '']);       // "Cerveza 2": no product → ignored, as today
  assert.deepStrictEqual(cf['876388'], ['personas', '']);       // listed in Tours col D
  assert.deepStrictEqual(cf['4444'], ['personas', '']);         // name rule
  assert.deepStrictEqual(cf['1111'], ['seats', '']);
  const rl = Object.fromEntries(seed.role.map(r => [r[0], r[3]]));
  assert.deepStrictEqual([rl['11'], rl['12'], rl['16'], rl['99']], ['capitan', 'marinero', 'externo', '']);
});

test('opsType_ / bookingPax_ / reservaRow_ identical for every booking', () => {
  let n = 0;
  F.ALL.forEach(p => {
    const b = p.booking, tour = tours[String(b.availability.item.pk)];
    same(N.ex.opsType_(b, M), O.ex.opsType_(b), 'opsType ' + b.pk);
    same(N.ex.bookingPax_(b, tour, M), O.ex.bookingPax_(b, tour), 'pax ' + b.pk);
    const nr = N.get('reservaRow_')(b, NOW, 7, tours, {}, M), or = O.get('reservaRow_')(b, NOW, 7, tours, {});
    same(nr.slice(0, or.length), or, 'reservaRow ' + b.pk); // new columns (Link FareHarbor) are appended at the end
    n++;
  });
  assert.strictEqual(n, F.ALL.length);
  // sanity: the scenarios really exercise the rules
  const px = k => J(N.ex.bookingPax_(F.ALL.find(p => p.booking.pk === k).booking, tours['244132'], M));
  assert.strictEqual(px(5010).pax, 6); assert.ok(/Seats/.test(px(5011).alerta)); assert.ok(/Solo Seats/.test(px(5012).alerta)); assert.ok(/Falta/.test(px(5013).alerta));
});

test('computeSalida_ identical (salida row, bitácora lines, tripulación incl. role with no short_name)', () => {
  departures.forEach(d => {
    const n = N.ex.computeSalida_(d.av, d.list, tours, NOW, {}, M), o = O.ex.computeSalida_(d.av, d.list, tours, NOW, {});
    same(n.salida.slice(0, o.salida.length), o.salida, 'salida ' + d.av); same(n.bit, o.bit, 'bit ' + d.av);
    same(n.crew.map(r => r.slice(0, 8)), o.crew, 'crew ' + d.av); assert.strictEqual(n.hasCustomers, o.hasCustomers);
    n.crew.forEach(r => assert.strictEqual(r.length, 9)); // + Rol clave
  });
  const r = N.ex.computeSalida_('9001', departures[0].list, tours, NOW, {}, M);
  assert.ok(r.bit.length >= 12 && r.crew.length === 6 && /Completa/.test(r.salida[11]));
  assert.strictEqual(r.crew[0][8], '11'); // Rol clave = role pk
});

test('consumoSalida_ / bitQty_ / extrasText_ / fruta identical', () => {
  departures.forEach(d => {
    const o = O.ex.computeSalida_(d.av, d.list, tours, NOW, {});
    same(N.ex.consumoSalida_(o.bit, productos, M), O.ex.consumoSalida_(o.bit, productos), 'consumo ' + d.av);
    same(N.ex.bitQty_(o.bit, productos, M), O.ex.bitQty_(o.bit, productos), 'bitQty ' + d.av);
    same(N.ex.extrasText_(o.bit, M), O.ex.extrasText_(o.bit), 'extras ' + d.av);
    let fr = 0; o.bit.forEach(x => { if (/fruta/i.test(String(x[6])) && x[5] === 'Salida') fr += Number(x[8]) || 0; });
    assert.strictEqual(N.ex.frutaSalida_(o.bit, M, productos), fr, 'fruta ' + d.av);
  });
  const o = O.ex.computeSalida_('9001', departures[0].list, tours, NOW, {});
  const c = J(N.ex.consumoSalida_(o.bit, productos, M));
  assert.deepStrictEqual([c.cer, c.agu, c.ref, c.vin, c.gas, c.hie], [7, 14, 4, 1, 40, 3]);
  assert.ok(!('fru' in c));
  assert.strictEqual(N.ex.frutaSalida_(o.bit, M, productos), 8);
  assert.ok(/Jugo y botanas/.test(N.ex.extrasText_(o.bit, M)) && /Costos adicionales: \$150/.test(N.ex.extrasText_(o.bit, M)));
});

test('payForSalida_ identical (rates, hora extra, externos, role without short_name)', () => {
  let pays = 0, exts = 0;
  departures.forEach(d => {
    const o = O.ex.computeSalida_(d.av, d.list, tours, NOW, {}), n = N.ex.computeSalida_(d.av, d.list, tours, NOW, {}, M);
    const barco = BARCO_SEED[o.salida[1]] || '';
    const po = O.ex.payForSalida_(o.salida, o.crew, o.bit, TAR_SEED, barco), pn = N.ex.payForSalida_(n.salida, n.crew, n.bit, TAR_SEED, barco, M);
    same(pn.pay, po.pay, 'pay ' + d.av); same(pn.ext, po.ext, 'ext ' + d.av);
    pays += po.pay.length; exts += po.ext.length;
  });
  assert.ok(pays >= 6 && exts >= 2, 'scenarios cover pay (' + pays + ') and externos (' + exts + ')');
  // hora extra = 2 (salida 1 + regreso 1) for capitán/marinero
  const o = O.ex.computeSalida_('9001', departures[0].list, tours, NOW, {});
  const p = J(N.ex.payForSalida_(o.salida, o.crew, o.bit, TAR_SEED, 'ponton', M));
  assert.strictEqual(p.pay.find(x => x[7] === 'Capitan')[12], 2);
});

test('with M = null the old name rules still apply (safe defaults)', () => {
  departures.forEach(d => {
    const n = N.ex.computeSalida_(d.av, d.list, tours, NOW, {}), o = O.ex.computeSalida_(d.av, d.list, tours, NOW, {});
    same(n.salida.slice(0, o.salida.length), o.salida); same(n.bit, o.bit);
  });
});

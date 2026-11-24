// Synthetic FareHarbor booking payloads (shapes follow the real webhook: Booking, All Fields).
let uid = 1;
const cfv = (pk, name, value, display) => { const o = { custom_field: { pk: pk, name: name }, value: value }; if (display !== undefined) o.display_value = display; return o; };
const cust = (ctPk, ctName, fields) => ({ pk: uid++, customer_type_rate: { customer_type: { pk: ctPk, singular: ctName } }, custom_field_values: fields || [] });
const role = (pk, short, name) => { const r = { short_name: short, name: name || short }; if (pk) r.pk = pk; return r; };
const crew = (r, name, username, note) => ({ role: r, user: { name: name, username: username }, note: note || '' });
function booking(o) {
  return { booking: {
    pk: o.pk, uuid: 'u' + o.pk, display_id: 'D' + o.pk, status: o.status || 'booked',
    availability: { pk: o.av, start_at: o.start, end_at: o.end, item: { pk: o.item, name: o.itemName }, crew_members: o.crew || [] },
    customers: o.customers || [], custom_field_values: o.cfs || [],
    amount_paid: o.paid || 0, invoice_price: o.invoice || 0, receipt_total: o.paid || 0, contact: { name: 'Cliente ' + o.pk }
  } };
}
const CREW = [
  crew(role(11, 'Capitan', 'Captain'), 'Juan Pérez', 'juan'),
  crew(role(12, 'Marinero', 'Sailor'), 'Luis M', 'luis'),
  crew(role(12, 'Marinero', 'Sailor'), 'Externo Beto', 'externo1', 'Pagar a Carmelita'),
  crew(role(99, '', 'Sin nombre corto'), 'Ana R', 'ana'),
  crew(role(15, 'Guia', 'Guide'), 'Ignacio Arceo', 'iarceo'),
  crew(role(16, 'Externo', 'External'), 'Pedro X', 'pedro')
];
const salidaFields = [
  cfv(2024601, 'Cerveza', '12'), cfv(2024602, 'Agua', '24'), cfv(2024603, 'Coca-Cola', '6'), cfv(2024604, 'Hielo (bolsas)', '3'),
  cfv(2024605, 'Gasolina (litros)', '40'), cfv(2024634, 'Vino (botellas)', '2'), cfv(2024635, 'Fruta (personas)', '8'),
  cfv(2024640, 'Hora extra', '1'), cfv(2024641, 'Extras a bordo', 'Jugo y botanas'), cfv(2024642, 'Costos adicionales', '150'),
  cfv(2024650, 'Cerveza 2', '7'), cfv(2024651, 'Notas internas', 'todo bien')
];
const regresoFields = [
  cfv(2024601, 'Cerveza', '5'), cfv(2024602, 'Agua', '10'), cfv(2024603, 'Coca-Cola', '2'), cfv(2024634, 'Vino (botellas)', '1'),
  cfv(2024640, 'Hora extra', '1'), cfv(2024641, 'Extras a bordo', ''), cfv(2024642, 'Costos adicionales', '0')
];
const T = (d, h, m) => '2026-11-' + d + 'T' + h + ':' + (m || '00') + ':00Z'; // UTC; Cancun = UTC-5
// departures: availability pk → bookings
const DEPARTURES = {
  // shared Bacalar Lagoon Boat Tour (pontón), bitácora, crew incl. externo + role without short_name
  9001: [
    booking({ pk: 5001, av: 9001, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: T(20, 14), end: T(20, 17), paid: 250000, crew: CREW,
      customers: [cust(100, 'Adult'), cust(100, 'Adult'), cust(100, 'Adult'), cust(101, 'Child'), cust(102, 'Senior'), cust(1999, 'OPS · Otro')] }),
    booking({ pk: 5002, av: 9001, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: T(20, 14), end: T(20, 17), crew: CREW,
      customers: [cust(1331886, 'OPS · Salida', salidaFields)] }),
    booking({ pk: 5003, av: 9001, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: T(20, 14), end: T(20, 17), crew: CREW,
      customers: [cust(1332005, 'OPS · Regreso', regresoFields)] }),
    booking({ pk: 5004, av: 9001, item: 258806, itemName: 'Bacalar Lagoon Boat Tour', start: T(20, 14), end: T(20, 17), status: 'cancelled', crew: CREW,
      customers: [cust(100, 'Adult')] })
  ],
  // private tour: people field (Tours col D) + QTY · Seats equal
  9002: [booking({ pk: 5010, av: 9002, item: 244132, itemName: 'Private Boat Tour', start: T(21, 15), end: T(21, 18), invoice: 100000, crew: [CREW[0], CREW[1]],
    customers: [cust(200, 'Private Boat')], cfs: [cfv(876388, 'Number of people', '6', '6'), cfv(1111, 'QTY · Seats · 6', '6')] })],
  // private: people ≠ seats → alert
  9003: [booking({ pk: 5011, av: 9003, item: 244132, itemName: 'Private Boat Tour', start: T(22, 15), end: T(22, 18),
    customers: [cust(200, 'Private Boat')], cfs: [cfv(876388, 'Number of people', '4', '4'), cfv(1111, 'QTY · Seats · 6', '6')] })],
  // private: only seats
  9004: [booking({ pk: 5012, av: 9004, item: 244132, itemName: 'Private Boat Tour', start: T(23, 15), end: T(23, 18),
    customers: [cust(200, 'Private Boat')], cfs: [cfv(1111, 'QTY · Seats · 8', '8')] })],
  // private: nothing → "Falta # de personas"
  9005: [booking({ pk: 5013, av: 9005, item: 244132, itemName: 'Private Boat Tour', start: T(24, 15), end: T(24, 18), customers: [cust(200, 'Private Boat')] })],
  // private with empty Tours col D: falls back to the people regex / "Uso personas"
  9006: [booking({ pk: 5014, av: 9006, item: 703332, itemName: 'Monocasco Privado MIA', start: T(25, 15), end: T(25, 18),
    customers: [cust(201, 'Monocasco')], cfs: [cfv(4444, 'Number of people', '5', '5'), cfv(4445, 'QTY · Seats', '5')] })],
  // rental with people field, and rental without
  9007: [
    booking({ pk: 5015, av: 9007, item: 258044, itemName: 'Kayak Rental - The Yak Lakehouse', start: T(26, 15), end: T(26, 17),
      customers: [cust(300, 'Single'), cust(300, 'Single')], cfs: [cfv(720458, 'People', '3', '3')] }),
    booking({ pk: 5016, av: 9007, item: 258044, itemName: 'Kayak Rental - The Yak Lakehouse', start: T(26, 15), end: T(26, 17),
      customers: [cust(300, 'Single'), cust(301, 'Double')] })
  ],
  // new, unknown item (not in Tours): shared guess
  9008: [booking({ pk: 5017, av: 9008, item: 999001, itemName: 'Tour Nuevo', start: T(27, 15), end: T(27, 17), customers: [cust(100, 'Adult'), cust(100, 'Adult')] })]
};
const ALL = [].concat(...Object.values(DEPARTURES));
module.exports = { DEPARTURES, ALL, cfv, cust, role, crew, booking, CREW, T };

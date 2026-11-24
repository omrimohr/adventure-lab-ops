# Adventure Lab Ops — how this repo works

Owner: Omri (Adventure Lab, Bacalar). FareHarbor company `thegaiaexperience`. Spanish UI, iOS-style, phone-first.

## Pieces
| Piece | Where | Notes |
|---|---|---|
| App (UI) | `docs/index.html` → GitHub Pages `https://omrimohr.github.io/adventure-lab-ops/` | Single file. Talks to the Apps Script with `fetch` POST `{type:'api', fn, args}` (text/plain, no CORS preflight). PIN login (tab Usuarios). |
| Server + DB logic | `apps-script/*.gs` → Apps Script project `11zOKs3bVRAffBfRRq0htgFNd1a9kZM2FEGUM1stlqAdQAfNXh2Xt9fyV`, bound to Sheet "Adventure Lab Ops – DB" (`1vGIHEjNBJpi1obFR32fj79cTEUT4lLJg2kYtHsYWwow`, account ceo.gmiexperience@gmail.com) | Web app URL (never changes): `https://script.google.com/macros/s/AKfycbzUi-BEXRiNNShtlVSSc8tTMb9JZloofTHCJPougpu6h_f1HzQDF63wbjNXxf0nJI6ncQ/exec` — also the FareHarbor webhook "Ops app – DB". |
| Deploy | push to `main` touching `apps-script/**` → GitHub Action runs `clasp push -f` + `clasp deploy -i <deployment id>` (same URL). Needs repo secret `CLASPRC_JSON` (Omri's `~/.clasprc.json`, account ceo.gmiexperience@gmail.com). | Never break `doPost` (FareHarbor webhook). Check the Action run after every push. |

## Files
- `Code.gs` — webhook intake (Raw append-only → Reservas → Salidas/Bitácora/Tripulación by **availability pk**), Ingresos (Comercial report import, Drive folder "Adventure Lab Ops – Reportes"), Control días, Finanzas (Stock, Eventuales, Resumen semanal, Externos, Costos salida; trigger every 15 min `rebuildFinanzas`).
- `app.gs` — app API: `login`, `getData`, writes (append-only logs: Compras, Ajustes, Comida empleado, Pagos, Revisiones), `migrate20261124` (done).

## Rules (from Omri)
- Raw is never edited; all other tabs are rebuildable. Nothing is deleted — purchases are annulled with a reason.
- Pax: shared tours = customer-type count; private = "Number of people" custom field (Tours tab, field pks); rentals = people field or 1.
- Income: webhook estimate (label "estimado") until Comercial's report gives "Net Revenue Collected" (no label).
- Departures keyed by FareHarbor availability pk. Salida/Regreso are separate OPS bookings. Crew role/name come from FareHarbor.
- Rates live in tab Tarifas (first matching row wins). Pay week Thursday→Wednesday.
- Ask Omri before risky/irreversible actions; concise answers; always give FareHarbor IDs with their names.
- FareHarbor configuration changes are logged in the Claude Docs "Adventure Lab — FareHarbor Setup Definition" (Change log tab), not here.

## Testing
The app can be tested locally with a stubbed `fetch`; server pure functions export via `module.exports` guard for node tests.

## FareHarbor ↔ DB contract (changes on either side must update the other)
FareHarbor work is done in the claude.ai chat (browser + change log); app/DB code is done here. If FareHarbor changes any of these, the DB needs a matching change:
- Webhook: user omri → "Ops app – DB" (pk 13746), schema Booking (All Fields), New/Updated/Cancelled → the exec URL above.
- OPS customer types: 1331886 OPS · Salida, 1332005 OPS · Regreso (bitácora bookings; affiliate "OPS · Bitácora").
- Bitácora fields are matched **by name** to `Productos` col "Campo FareHarbor": Cerveza, Agua, Coca-Cola, Hielo (bolsas), Gasolina (litros), 2024634 Vino (botellas), 2024635 Fruta (personas), Extras a bordo / Costos adicionales (text), Hora extra.
- Private-tour people fields: by field pk per item in tab `Tours` (col D). New private items arrive as "AUTO: revisar".
- Crew role short names (Capitan, Marinero, Guia, Instructor Lider, Instructor asistente) are matched in `Tarifas`.

## Open items (24 Nov 2026)
- Rates pending: festivo, traslado (needs a FareHarbor field). Hobie marinero 400 is an assumption.
- 696746 Private Healing Boat Tour (La Ramona) → barco catamarán applies when it first appears in Tours.
- Need one real Comercial export to confirm the report columns (`#`, "Net Revenue Collected").
- `rebuildFinanzas` sometimes takes 1–2 min (normally ~15 s) — watch Executions.
- Omri to change seed PIN 0000 (tab Usuarios) and add staff.
- Phase 2 FareHarbor (chat side): Fruta on SUP items, full bitácora on 703536 Hobbie Cat Sailing Lesson, kayak field subset.
- Next app work: simplify colours per Omri's comments; QuickBooks later.

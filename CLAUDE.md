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

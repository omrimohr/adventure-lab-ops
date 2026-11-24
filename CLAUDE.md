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
FareHarbor work is done in the claude.ai chat (browser + change log); app/DB code is done here. **Matching is by pk, not by name**: renaming things in FareHarbor no longer breaks anything, and anything new is kept and shown in the app for one-tap confirmation.
- Webhook: user omri → "Ops app – DB" (pk 13746), schema Booking (All Fields), New/Updated/Cancelled → the exec URL above. `doPost` never drops data: if the script lock can't be taken it still appends Raw, logs to Errores and sets `REBUILD_PENDING`; if the mapping tabs don't exist yet it appends Raw, skips the derived step and sets `REBUILD_PENDING` (seeding is never done in the webhook).
- Mapping tabs (never cleared by rebuilds; **Clave** = `String(pk)`, or `'n:' + normalized name` when FareHarbor sends no pk; Estado = `OK` | `Nuevo – revisar`):
  - **Tipos de cliente** (customer_type.pk) → Uso: `pax` | `no cuenta` | `ops salida` | `ops regreso`. OPS bookings are the ones with an ops type (known: 1331886 OPS · Salida, 1332005 OPS · Regreso; affiliate "OPS · Bitácora"). Only `pax` customers count as pax/unidades.
  - **Campos** (custom_field.pk) → Uso: `producto` (+ Producto ID from Productos) | `personas` | `seats` | `hora extra` | `extras` | `costo adicional` | `ignorar`. Bitácora lines are matched on the Bitácora tab's `Field pk`. Fruta = producto with Producto ID `fru` (known: 2024634 Vino, 2024635 Fruta (personas)). Private-tour people field: Tours col D pks first; if empty, fields with Uso `personas`; `seats` = Uso `seats` (e.g. "QTY · Seats").
  - **Roles** (crew_members[].role.pk, else normalized short_name) → Rol tarifa: the string used in Tarifas col A (`capitan`, `marinero`, `guia`, `instructor lider`, `instructor asistente`, …), `externo` or `ignorar`. Tripulación has a last column `Rol clave` so pay can map role → Rol tarifa. A user whose name/username contains "extern" is still treated as externo.
  - **Tours** (item pk): tipo, Campo personas, Lleva bitácora, Barco as before, plus `Estado` (H) and `Visto primero` (I). New items are added with the guessed tipo and `Nuevo – revisar`.
  - **Productos "Campo FareHarbor" is now display/seed only.** The field→product link lives in Campos (Uso `producto` + Producto ID), chosen in the app under Más › Por configurar.
- Unknowns: any customer type / field / role / item whose Clave is not in its tab is appended with Estado `Nuevo – revisar`, a safe default Uso (the old name rule: unknown type = pax unless it looks like OPS · …, unknown field = ignorar unless it matches a product/hora extra/extras/people/seats rule), first-seen time, item pk + name and an example value. Results use the default until confirmed; nothing is dropped (Raw and Bitácora keep the raw values). If a known Clave arrives with another name only the Nombre column changes (+ "Antes: …" in Notas).
- Confirming: admin app screen "Por configurar" (Más tab, red badge) → API `setMapeo(pin, kind tipo|campo|rol|item, clave, valores)` (perm `config`) validates, writes Uso/Estado OK/Configurado por/Configurado and sets `REBUILD_PENDING`. The 15-min trigger `rebuildFinanzas` then runs `rebuildAll` (history recalculated from Raw) and clears the flag; getData returns `rebuildPending` so the app shows "Recalculando…". The app's own writes call `rebuildFinanzas_` (finanzas only) so they never wait for a full rebuild. The tabs are seeded from Raw by the first `rebuildFinanzas` run after deploy (or `prepararMapeos`, menu Ops DB); until they exist webhooks only land in Raw.
- Health warnings (app only, no email, nothing is blocked): webhook silent > 4 h between 07:00–21:00 Cancún (not Wednesday; the overnight gap does not count); bitácora missing for departures of the last 7 days (today after 21:00) with bookings that carry a bitácora or have an OPS booking; Comercial report missing (day still "estimado" after 12:00 of the next day, last 14 days); items "Nuevo – revisar" older than 2 days; Errores rows today. Admin sees all, op sees bitácora only. Logic: `saludAlerts_` in app.gs.
- Other FareHarbor facts the DB relies on: OPS bookings are Salida/Regreso bookings of the same availability; Bitácora field names are free (matched by pk now); crew role short names (Capitan, Marinero, Guia, Instructor Lider, Instructor asistente) only matter through Roles → Rol tarifa.

## Tests
`node tests/run.js` (no dependencies). Includes an equivalence test of the old name-based code (`git show c5177f3:apps-script/*.gs`, override with `OLD_REF`) vs the pk-mapping code seeded from the same payloads, unit tests (unknown detection, health rules, setMapeo validation) and an in-memory Spreadsheet run of doPost/seed/setMapeo/rebuild. `tests/` is outside `apps-script/` so clasp never pushes it.

## Open items (24 Nov 2026)
- Pay adjustments (decided 24 Nov): no automatic festivo. Jesús adds manual extra/deduction lines per person/week from pre-made concepts (e.g. "Día festivo +150") with a reason. Needs an app feature + config tab of concepts.
- Traslado (decided 24 Nov): FareHarbor bitácora will get fields "Traslado ida" / "Traslado regreso" (cost; default ON on HBTS tours). Pay per way: 100 sailing, 50 pontón. DB must read them once the fields exist (chat side creates them, then posts the field pks here).
- Hobie has no marinero: remove the 'marinero · hobie' row from Tarifas (capitán hobie 600 stays).
- pk-mapping deployed 24 Nov: the next 15-min `rebuildFinanzas` seeds Tipos de cliente / Campos / Roles from Raw automatically (or run `prepararMapeos` from the Ops DB menu). Check the first run in Executions, then the Por configurar screen.
- 696746 Private Healing Boat Tour (La Ramona) → barco catamarán applies when it first appears in Tours.
- Need one real Comercial export to confirm the report columns (`#`, "Net Revenue Collected").
- `rebuildFinanzas` sometimes takes 1–2 min (normally ~15 s) — watch Executions.
- Omri to change seed PIN 0000 (tab Usuarios) and add staff.
- Phase 2 FareHarbor (chat side): Fruta on SUP items, full bitácora on 703536 Hobbie Cat Sailing Lesson, kayak field subset.
- Next app work: simplify colours per Omri's comments; QuickBooks later.

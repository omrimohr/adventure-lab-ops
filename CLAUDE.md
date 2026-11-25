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
- Bitácora applies to EVERY item except rentals (Tours tipo = `renta`) and day passes (Tours Barco = `otro`); "No aplica" only then, and only without OPS bookings. Rule v3 also marked "Lleva bitácora = sí" (sheet record only) for the items that got bitácora fields on 24 Nov: 244134, 398421, 243654, 398153, 337343, 337931, 398154, 703654, 689738, 185852, 703536, 770935. The Tours column "Lleva bitácora" is still in the sheet but is **no longer read** (computeSalida_, saludAlerts_). Departures with customer bookings but no resource get the alert "Sin recurso asignado". Script property `BITACORA_RULE_V` ('4'): the first `rebuildFinanzas` of this version sets REBUILD_PENDING once so Salidas, Costos salida and Externos are recomputed (bump it whenever history must be recalculated).
- Rates live in tab Tarifas (first matching row wins). Pay week start = Config `semana_pago` (default jueves; Ajustes in the app). Changing it sets REBUILD_PENDING; Pagos rows keep their stored date and attach to the week that contains it.
- Ask Omri before risky/irreversible actions; concise answers; always give FareHarbor IDs with their names.
- FareHarbor configuration changes are logged in the Claude Docs "Adventure Lab — FareHarbor Setup Definition" (Change log tab), not here.

## Installable app (PWA)
`docs/manifest.webmanifest` + icons (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `apple-touch-icon.png`; regenerate with Pillow, teal lagoon + white boat/"AL") + `docs/sw.js`. Staff install it so it opens without the browser bar:
- iPhone: Safari → Compartir → "Agregar a inicio".
- Android: Chrome → ⋮ → "Instalar app".
The service worker caches only the shell (index.html, manifest, icons; cache-first) and never touches the Apps Script API (other origin / POST → network only). **Bump `CACHE` in `docs/sw.js` on EVERY change under `docs/`**, otherwise installed phones keep the old shell. A new `CACHE` makes the phone install the new worker, drop old caches and reload the page once.

## Costos adicionales and Externos (ops manual, 24 Nov 2026)
- Crew are added by hand per availability with a role; the crew Note is the boat ("Barco: El Cormoran") or, for the external captain (user "Capitan Externo"), "boat – person" = who is owed. Tripulación col H (Nota) → app crew `nt`.
- `parseCostos_(text)` (Code.gs, pure) reads amounts from the free text of the field with Campos Uso `costo adicional` (OPS · Regreso booking): `$2,500`, `2500`, `$2.500`, `$ 300`, `300 pesos`; segments split by `· ; + /` newline, and by `,` / ` y ` only when both sides have a number; segments mentioning "barco externo" get `ext:true`; segments without amount → `unparsed`. Costos salida gets the last column `Costos adicionales (MXN)` (included in Costo total / Costo %); Alertas: "Costo adicional sin monto: …".
- Bitácora keeps the full text of `costo adicional` / `extras` fields (col J) even when it contains digits (`num_` alone would keep only the first number).
- Externos: `Monto (MXN)` (last column) = sum of the `barco externo` items (one external → all; several → total on the first + "Varios externos: repartir"); alerts "Falta nota: ¿a quién se debe?" (empty crew note) and "Falta monto en Costos adicionales" (after the departure ended). Externos are not paid as staff.
- App: a departure with Ida and/or Regreso overdue (same rule as the red dots) gets the warning "Falta bitácora de ida / de regreso / de ida y regreso" in the ⚠️ count, the "Con advertencias" filter and Avisos.

## Round 7 (25 Nov 2026)
- Writes (compra, ajuste, conteo, revisado, pago, setMapeo) go through a background queue in the app (`enqueue`/`pump`, localStorage `adv_ops_q:<hash>`): sheet closes at once, optimistic row "guardando…", retries with backoff in order, toast "No se guardó … Reintentar" on final failure. Every write carries a client uuid; the server stores it in the LAST column "ID cliente" of Compras/Ajustes/Comida empleado/Pagos/Revisiones (`ensureCidCol_`, `cidRow_`) and ignores duplicates. Old clients without an id still write.
- `stockReport(pin, desde, hasta)` (admin only; pure `stockReport_`): Inicial/Compras/Consumo/Ajustes/Final/Δ/Valor per controlled product; desde = hasta = balance al día. getData moves for ajustes carry `aj, mot, nota, por, k`; purchases carry `cid`.
- Day summary excludes departures with no active bookings everywhere (`hasBk`), incl. the filters Por revisar / Con advertencias.

## Round 8 (25 Nov 2026): design system "Arena · salvia"
- Replaces the old turquoise / inset rounded groups / 34pt title rules. CSS variables in `docs/index.html` (light + dark): sand page, paper rows, hairlines, salvia accent `--acc`, status colours (`--green` money/ok, `--orange` warning, `--red` error, never themed except lightness in dark). Serif (Lora from Google Fonts, Georgia fallback) for titles and tour names; sizes 26 / 16 / 14 / 12 (+ 11 neto, 22 big figures); weights 400/500; line icons (`svgI`), no colour emoji in chrome. Flat lists: `.list` bleeds full width with hairline top/bottom, no radius. ONE filled `.btn` per screen, others soft/plain accent text.
- Operación: date nav above the serif title, flat day summary (`.dsum`), departure row `.drow` with 4 fixed lines.
- Setting `semana_inicio` (jueves | lunes) in tab **Config** (Clave | Valor | Actualizado | Por). `getData().config`; `setConfig(pin,key,value)` admin only (role, not just permission), validated by `validateConfig_`. Used only by the stock report presets (`weekStartOf`); the crew pay week (`wkStart`) stays Thursday→Wednesday. Add new settings in `CONFIG_DEFAULTS_` + `validateConfig_`.

## Round 9 (25 Nov 2026)
- Ajustes: Apariencia (Automático | Claro | Oscuro) per device (localStorage, `data-theme` on <html>); `semana_pago` (Config, any weekday, default jueves) drives Eventuales / Resumen semanal / Pagos (`weekStart_`, `payDow_`); `semana_inicio` only the stock report.
- Section gap 28px; tour hour 16/500. Departure detail lists (Bookings, Crew, Costos) use the compact `.dlist` rows with a rule line before totals. Day passes (barco otro) are excluded from Tours, Rentas and day pax (`isPase`). Rentals (tipo renta) and day passes (barco otro) render as ONE quiet gray line (round 11, `.dquiet`): kayak icon, hour, name, pax ... gross; no resources, no check-in; only the ⚠ count keeps colour. Departure lists (`.list.deps`): each row is its own paper strip separated by 8px of sand, no lines.

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
- Check-in: FareHarbor does NOT fire a webhook on check-in/no-show, so Check-in counts only refresh when a guest booking changes for another reason. Omri: fine for now (options parked: bitácora field "Personas a bordo", or check-in column from Comercial's daily report).
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

## Round 13 (25 Nov 2026)
- Stock list: every product uses the SAME unit icon 🥫 (`packs`); 📦 only for boxes; no boxes = 🥫 + number.
- Money: `fmt` (cents kept) / `fmt0` (whole pesos: stock value, report) put the minus BEFORE the $ (U+2212): "−$1,690", never "$-1,690". Use these for all money output.
- Stock report: no Periodo/Un día toggle, no date inputs. The date line is a button (`data-srcal`) opening a custom calendar sheet (Monday first, tap start then end, swap if reversed, same day twice = single day "Balance al …", future days disabled; pure helpers `srPick`, `srLabel`, `calCells`). Chips: Hoy, Esta semana, Semana pasada, Este mes, Mes pasado. Server `stockReport_` is day-inclusive at both edges (Inicial = before the first day's movements, Final = after the last day's).
- Report is one table (Producto | Inicial | Compras | Consumo | Ajuste | Final | Valor), fixed layout, grouped by Grupo, Total + "Compras $ · Consumo $" footer; fits 360px without scrolling (wrapper keeps overflow-x as fallback).

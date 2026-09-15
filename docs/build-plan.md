# Sticker Engine — Backbone & Build Plan (rev 2)

4" × 1" thermal labels, generated from Sample Note + Picklist documents, printed to Zebra via ZPL II.

Rev 2 folds in the locked D1–D7 decisions, the real logo asset, and measured geometry.

---

## Part 1 — Locked decisions

| # | Decision | Resolution |
|---|---|---|
| D1 | Resolution | **Dropdown**: 203 / 300 / 600 dpi. Template stores geometry in *dots at 203*; all other resolutions scale by `dpi/203`. Selection is per printer profile, remembered per printer. |
| D2 | Extraction transparency | **Provenance bar.** Every field carries `provenance: 'extracted' \| 'derived' \| 'manual' \| 'missing'`. Missing fields are omitted from the label, never rendered as empty separators. |
| D3 | Qty | Single `Qty` field stored in **millilitres**. Rendered `2L`, `1L 500ML`, or `310ML` — litre part suppressed when zero, ML part suppressed when zero. |
| D4 | Category | Hard-coded `MANUFACTURE - Miscelaneous Supplier` on every label for now, exposed as an editable job-level field with that default. |
| D5 | Batch no | Manual field → Code 128 barcode with HRI below. |
| D6 | ClickUp link | Paste field → **Proceed** → built-in shortener → QR. See Part 8. |
| D8 | Date order | **MDY (month first).** `09/04/2026` = 4 September 2026. Locked. |
| D7 | Logo | Converted from your JFIF. Assets generated, see `assets/`. |

### D2 in detail — the provenance bar

The header composes from up to three parts joined by `|`. Parts that were not extracted drop out entirely along with their separator:

```
customer = "Hi Fashion Holdings Pvt Ltd"   docNo = "RSMINV26091080"   category = "MANUFACTURE - Miscelaneous Supplier"
  → Hi Fashion Holdings Pvt Ltd|RSMINV26091080|MANUFACTURE - Miscelaneous Supplier

docNo missing
  → Hi Fashion Holdings Pvt Ltd|MANUFACTURE - Miscelaneous Supplier
```

This requires a `join` slot type rather than a plain `{token}` string — a template slot with `parts: []` and `separator: "|"` that filters empties. Do not solve this with string replacement and a cleanup regex; it will bite you on the first item whose name legitimately contains a pipe.

The UI bar shows one chip per field, colour-coded by provenance, with a count: *"9 of 11 fields extracted · 2 need input"*. Clicking a chip focuses the corresponding input.

---

## Part 2 — Field map

| Slot | Example | Source | Provenance |
|---|---|---|---|
| Logo | Standard Holdings mark | Printer-resident graphic | static |
| Header | `Hi Fashion Holdings Pvt Ltd\|RSMINV26091080\|MANUFACTURE - Miscelaneous Supplier` | customer + docNo + category | extracted / extracted / manual (D4 default) |
| Product name | `Win-Poly Blue 7007` | Picklist line description, via item master | extracted |
| Qty | `QTY :- 310ML` | Item master fill volume, or picklist qty × density | derived |
| MNF | `05/2026` | Operator input | manual |
| EXP | `05/2028` | MNF + shelf life, editable | derived / manual |
| Batch | `JUR260725` | Operator input or scan | manual |
| QR | ClickUp form | Pasted link → short code | manual |

---

## Part 3 — Architecture

```
documents (PDF / image)
        │
        ▼
  ingest/       pdftotext -layout  →  anchored parsers
        ▼
  model/        SampleNote + Picklist  ──join──►  LabelJob
        ▼
  enrich/       item master, qty rules, shelf life, provenance tagging
        ▼
  UI            provenance bar · line grid · manual fields · live preview
        ▼
  template/     label-4x1.json (single source of geometry)
        │
        ├────► render/zpl.js     → .zpl
        └────► render/canvas.js  → browser preview
                     ▼
              net/tcp9100.js  → printer
                     ▼
              verify/  → scan-back confirmation + audit log
```

**One rule above all:** both renderers consume the same template JSON and the same fit/metrics module. Neither contains a hard-coded coordinate.

---

## Part 4 — Measured geometry (203 dpi, 812 × 203 dots)

> Superseded on 2026-09-15: the stock is 100×25 mm (800×200) and the logo is inline. Current geometry: `docs/specs/2026-09-15-label-100x25.md`. Kept as the original design record.

Rev 2.1: header enlarged and bolded, HRI moved below the bars, product name given a static size with vertical centring.

| Slot | x | y | w | h | Notes |
|---|---|---|---|---|---|
| border | 4 | 4 | 804 | 195 | 3-dot stroke |
| logo | 14 | 50 | 140 | 140 | `^XG` recall of `R:LOGO.GRF` |
| qr | 702 | 8 | 96 | 96 | magnification from module count |
| header L1 | 166 | 8 | 524 | 22 | bold, ` \| ` separator |
| header L2 | 166 | 34 | 524 | 22 | bold |
| nameBg | 166 | 62 | 524 | 54 | filled |
| name | 175 | *centred* | 506 | 38 | reverse, static 38, shrink only if needed |
| qtyBg | 166 | 122 | *measured* | 44 | width follows text |
| qty | 175 | *centred* | — | 23 | reverse |
| mnf | *after qty* | 122 | — | 19 | |
| exp | *after qty* | 147 | — | 19 | |
| barcode bars | *after mnf* | 120 | *remainder* | 48 | `^BC…,Y` |
| barcode HRI | *centred under bars* | 171 | — | 20 | printed below the bars |

Content left edge is 166. Row 2 (qty · MNF/EXP · barcode) lays out left-to-right by measurement, so a wide quantity automatically squeezes the barcode and the guard fires when it drops below 2 dots per module. Measured barcode width in the reference case is 302 dots against a 290-dot minimum for a 9-character Code 128 — the margin is thin, which is exactly why the guard is not optional.

### Header

Bold, spaced pipes, **two lines**. This is forced, not a preference. Measured widths for `Hi Fashion Holdings Pvt Ltd | RSMINV26091080 | MANUFACTURE - Miscelaneous Supplier` in bold:

| Size | Width | Fits 524? |
|---|---|---|
| 14 dots | 599 | no |
| 18 dots | 770 | no |
| 22 dots | 942 | no |

Split across two lines at 22 dots: 473 and 408. Both fit comfortably. The engine packs parts greedily into up to two lines, dropping to 21, 20, 19… only if a part is unusually long. If it still needs three lines, the guard warns to shorten the category.

**ZPL has no bold.** Font `^A0` is a single scalable weight — asking for bold does nothing. Two ways to get it:
- **Double-strike** (default): emit the field twice, the second offset by 1 dot in x. At 203 dpi this thickens strokes convincingly and costs nothing.
- **Downloaded TrueType**: store a bold face on the printer once and alias it with `^CW`. Cleaner result, but the font must live on every printer and survive power cycles.

Start with double-strike. Only move to a TTF if a printed sample looks thin.

### Product name

Static height 38, **not** auto-maximised. `Win-Poly Blue 7007` at 46 was overpowering the bar; 38 is the house size. Auto-fit only engages downward, to a floor of 18. Text is vertically centred in the bar — `y = barTop + (barHeight − fontHeight) / 2` — so a shrunk name like `FW-777-Hybrid White Reactant Compound` sits centred rather than riding the top edge. The same centring applies to the qty bar.

### Barcode HRI

Human-readable text goes **below** the bars, never overlapping them. In ZPL this is `^BCN,48,Y,N,N` — the third parameter enables HRI, the fourth (`N`) places it below rather than above. The batch code is printed **exactly as entered**; the engine never substitutes characters.

## Part 5 — Logo assets

Generated from your JFIF at 144 × 144 dots. Both variants are in `assets/logo-store.zpl` as `~DG` commands, ready to send to the printer once.

| Variant | Object | Black coverage | Trade-off |
|---|---|---|---|
| `LOGO.GRF` | Solid navy → black | **69.9%** | Matches your current sticker exactly |
| `LOGOKO.GRF` | Line art on white | **8.7%** | Prints faster, far less printhead heat, no bleed risk |

The solid version is what you use today, so it's the default. But it's worth knowing why the knockout exists: at 144 dots, the white letterforms in `STANDARD` and `HOLDINGS` are one to two dots wide. Thermal heat spreads laterally, so thin *white gaps inside a large black field* tend to close up — the ring lettering will look muddier on paper than it does on screen, and it gets worse as the printhead ages or darkness creeps up. The knockout variant has the same information as thin *black* lines on white, which thermal printing handles cleanly.

Print one of each and compare before committing. Below 144 dots the ring lettering degrades badly at any darkness — 120 is marginal, 96 is illegible.

Send once per printer:

```
~DGR:LOGO.GRF,2592,18,<hex>
```

Recall on every label:

```
^FO14,26^XGR:LOGO.GRF,1,1^FS
```

Note the `R:` device is RAM and clears on power cycle. If your model has flash, store to `E:` instead. Either way, the app should verify the graphic exists on connect and re-send it if not — a missing `^XG` target prints a blank space with no error.

---

## Part 6 — Reference ZPL

```zpl
^XA
^PW812
^LL203
^LH0,0
^MNY
^MD10
^PR4
^CI28

^FO14,50^XGR:LOGO.GRF,1,1^FS

; header line 1 - double-struck for bold
^FO166,8^A0N,22,22^FDHi Fashion Holdings Pvt Ltd | RSMINV26091080^FS
^FO167,8^A0N,22,22^FDHi Fashion Holdings Pvt Ltd | RSMINV26091080^FS
; header line 2
^FO166,34^A0N,22,22^FDMANUFACTURE - Miscelaneous Supplier^FS
^FO167,34^A0N,22,22^FDMANUFACTURE - Miscelaneous Supplier^FS

^FO175,70^A0N,38,38^FDWin-Poly Blue 7007^FS
^FO166,62^FR^GB524,54,54^FS

^FO175,132^A0N,23,23^FDQTY :- 310ML^FS
^FO166,122^FR^GB166,44,44^FS

^FO344,122^A0N,19,19^FDMNF :- 05/2026^FS
^FO344,147^A0N,19,19^FDEXP  :- 05/2028^FS

^BY2,3,48
^FO510,120^BCN,48,Y,N,N^FDJUR260725^FS

^FO702,8^BQN,2,3^FDMA,https://sh.lk/j/AB12X^FS

^FO4,4^GB804,195,3^FS
^PQ1
^XZ
```

`^FR` precedes the field it reverses. A reversed caption is struck black first and its bar is emitted after it with `^FR`; putting `^FR` on both bold strikes flips them back into hollow outlines (see `docs/specs/2026-09-14-reversed-bold-text.md`). `^CI28` sets UTF-8. `^MNY` assumes gap-sensed stock; use `^MNM` for black-mark. `^BQ` takes `MA,` for ECC M. Name `y=70` and qty `y=132` are computed centring values, not constants — the emitter recalculates them whenever the font shrinks.

## Part 7 — The prompt sequence

**Five prompts to a working skeleton. Eight to polished.**

### Standing preamble — paste above every prompt

> **Project:** Node.js 20 + Express engine producing 4×1" ZPL labels for Zebra printers. Single external binary dependency: `poppler-utils`. No printer drivers — raw TCP to port 9100.
>
> **Standing rules:**
> 1. ESM modules, `"type": "module"`. No TypeScript, but full JSDoc typedefs on every exported function and domain object.
> 2. No framework beyond Express. No ORM. No build step for the frontend — vanilla ES modules served directly.
> 3. Every module is pure and independently testable. Side effects (fs, net, child_process) live only in named adapter modules and are injected, never imported deep in the tree.
> 4. Barcodes and QR codes are emitted as native ZPL (`^BC`, `^BQ`). Never rasterise them.
> 5. Geometry lives only in the template JSON. No renderer contains a hard-coded coordinate.
> 6. Every user-facing value carries a `provenance` tag: `extracted`, `derived`, `manual`, or `missing`. Missing values are omitted from output, never rendered as blanks or placeholder separators.
> 7. Errors are typed: throw `AppError` subclasses with a `code`, `httpStatus`, and a message safe to show a warehouse operator. Never leak stack traces to the UI.
> 8. Configuration is environment-driven with documented defaults. No magic values inline.
> 9. Every module ships with a `node:test` file beside it. Tests use fixtures, never network or a real printer.
> 10. Write the code complete and production-ready. No `TODO`, no placeholders, no `// implement later`.
> 11. Before writing code, state your assumptions in a short list. If a requirement is ambiguous, pick the most defensible option, say so, and continue — do not stop to ask.
>
> **Output:** full file contents with paths, in dependency order. Finish with one paragraph on what the next prompt should cover.

---

### Prompt 1 — Domain model, template schema, ZPL emitter

> Build the core: domain model, label template schema, and ZPL emitter.
>
> **Domain objects** (JSDoc typedefs in `src/model/types.js`):
> - `Field<T>` — `{ value: T, provenance: 'extracted'|'derived'|'manual'|'missing', note?: string }`. Every mutable label value is wrapped in this.
> - `SampleNote` — docNo, date, billTo, shipTo, placeOfSupply, lines[{ index, description, qty, uom }]
> - `Picklist` — picklistNo, date, status, customerName, createdBy, location, warehouse, assignee, totalQty, lines[{ index, description, orderNo, qtyToPick, qtyPicked, qtyRemaining, uom }]
> - `LabelJob` — id, createdAt, source, customer, docNo, category, qrUrl, qrShortCode, lines[]
> - `LabelLine` — index, itemKey, displayName, qtyMl, mnfDate, expDate, batchCode, copies, status
>
> **Template schema** `src/template/schema.js` with a validator, plus `src/template/label-4x1.json` using the measured geometry from the build plan. Slot types: `text`, `join`, `box`, `graphic`, `barcode`, `qr`.
> - Geometry is stored in dots at 203 dpi. `resolve(template, dpi)` scales every coordinate by `dpi/203` with integer rounding, so 300 and 600 dpi come free.
> - `join` slots take `parts: []` of token strings and a `separator`. Parts resolving to a missing/empty value are dropped along with their separator. This is the D2 requirement — solve it structurally, never with a cleanup regex.
> - `text` slots support `reverse` (white on a filled box), `fit` (a **static** `size` used whenever the string fits, shrinking only downward to `minH`, then truncating), `bold` (emit the field twice with a 1-dot x offset, since ZPL font `^A0` has no bold weight), and `vAlign: 'center'` (compute `y = boxTop + (boxHeight − fontHeight) / 2` and recompute it whenever the font shrinks).
> - `wrapParts` slots pack a list of parts into up to `maxLines` lines with a ` | ` separator, dropping empty parts and their separators. Step the font down only if the parts will not pack; warn if `maxLines` is still exceeded.
> - `barcode` slots place HRI **below** the bars (`^BCN,h,Y,N,N`) and never alter the data — no character substitution, ever.
> - Slots may declare `flow: 'after:<slotId>'` with a gap, so the qty bar, MNF/EXP block, and barcode lay out left-to-right by measurement. The barcode takes the remaining width.
>
> **Quantity formatting** `src/model/qty.js` — `formatMl(ml)` returns `2L`, `1L 500ML`, or `310ML`. Litre part suppressed at zero, ML part suppressed at zero. Round to whole ml. Tested at 0, 1, 999, 1000, 1001, 1500, 2000, 10500.
>
> **Text metrics** `src/render/metrics.js` — estimate rendered width for Zebra scalable font `^A0` at a given dot height, using a per-character width table scaled linearly from a reference height. Document that it is an approximation.
>
> **ZPL emitter** `src/render/zpl.js` — `emit(template, context, opts)` returns a ZPL string. Handles `^XA`/`^XZ`, `^PW`/`^LL`, `^CI28`, darkness, print rate, `^PQ`, and each slot type. Barcodes emit `^BY` + `^BC` with HRI below; QR emits `^BQ` with the ECC-prefixed data. Graphics emit `^XG`. Escape `^`, `~`, `\` inside `^FD` via `^FH` hex escapes.
>
> **Guard** `src/render/guard.js` — return warnings for: printhead width overflow, artwork crossing the label edge, quiet-zone intrusion, barcode below 2 dots per module, QR below 3 dots per module, and text shrunk below a legibility floor. Distinct warning codes for each.
>
> **Tests:** golden-file test reproducing the reference ZPL byte-for-byte from a fixture context; unit tests for join-with-missing-parts, qty formatting, fit shrinking, escaping, dpi scaling, and every guard case.

---

### Prompt 2 — Document ingestion

> Build the ingestion layer producing the domain objects from prompt 1.
>
> **Extraction** `src/ingest/extract.js` wraps `pdfinfo` and `pdftotext -layout` as an injected adapter. Detect type from text markers — Sample Notes carry "SAMPLE NOTE" and an `RSMINV` number; Picklists carry "Picklist" and a `PL-` number. Return `{ kind, pageCount, layoutText }`. Unknown kind throws `UnknownDocumentError` naming the markers searched.
>
> **Parsers** `src/ingest/parseSampleNote.js`, `src/ingest/parsePicklist.js`. Anchor-based, not positional: locate a label ("Customer Name :", "Picklist#", "Sample Note No") and read what follows. Tables are found by locating the header row and consuming until a terminator. Every extracted value is wrapped in a `Field` with provenance `extracted`; anything not found is `missing` — **never** substitute a default at this layer.
>
> **Date handling.** Confirmed: these documents are **MDY, month first** — `09/04/2026` is 4 September 2026. Still read the order from `STICKER_DATE_ORDER` (default `MDY`) rather than hard-coding it, and log the resolved order at boot, so a future document source in a different format is a config change rather than a silent corruption. Reject any date where the resolved order produces an impossible value (month > 12) instead of swapping the parts.
>
> **Join** `src/ingest/join.js` — `joinToJob(sampleNote, picklist, opts)` matches lines by normalised description (lowercase, collapsed whitespace, stripped punctuation) and reports three buckets: matched, sample-note-only, picklist-only. Picklist-only lines still produce a `LabelLine`. Sample-note-only lines produce a warning — the item was not picked. The job accepts a picklist alone, with docNo marked `missing`.
>
> **Fixtures** in `test/fixtures/`: text captures of picklist PL-76120 and sample note RSMINV26091087, six lines each. Tests cover field extraction, line counts, unit parsing, both date orders, the three join buckets, a picklist-only job, and a malformed row producing a warning rather than an exception.
>
> No OCR in this prompt. Structure `extract.js` so an OCR adapter drops in behind the same interface.

---

### Prompt 3 — Item master, enrichment, short-link service

> **Item master:** CSV-backed, loaded at boot, path from `STICKER_ITEM_MASTER`. Columns: `itemKey, aliases, sku, displayName, category, defaultUom, density, fillVolumeMl, shelfLifeMonths`. `aliases` is pipe-separated ERP descriptions. Index over itemKey and every alias.
>
> **Lookup** `src/enrich/itemMaster.js` — `resolve(description)` returns `{ item, confidence, method }` where method is `exact | alias | fuzzy | none`. Fuzzy uses trigram similarity, threshold configurable at 0.82, and is **always** surfaced in the UI, never applied silently.
>
> **Enrichment** `src/enrich/enrichJob.js` fills each line and tags provenance:
> - `displayName` from item master (`derived`), falling back to the raw picklist description (`extracted`) when unresolved
> - `qtyMl`: item master `fillVolumeMl` if present; else picked mass × density; else unresolved and marked `missing` for manual entry. Record which rule fired in `qtySource`.
> - `expDate` = `mnfDate + shelfLifeMonths` (`derived`), only when mnfDate is present; overwritten to `manual` on operator edit
> - `category` defaults to `MANUFACTURE - Miscelaneous Supplier` from `STICKER_DEFAULT_CATEGORY`
> - `status` is `ready` only when displayName, qtyMl, mnfDate, expDate and batchCode are all present
>
> **Batch code validation** `src/enrich/batch.js` — validate against `STICKER_BATCH_PATTERN` (default `^[A-Z]{3}\d{6}$`, matching `JUR260725`) and flag the letter/digit confusions a typing operator makes: `O` for `0`, `I` for `1`, `S` for `5`.
>
> **This function warns; it never rewrites.** The batch code is encoded into the barcode byte-for-byte as the operator entered it. Silently "correcting" `JUR26O725` to `JUR260725` would produce a barcode that scans as a batch nobody typed — worse than the typo. The UI shows the warning and the operator decides. The unambiguous-alphabet rule applies **only** to generated short codes, which are the system's own values, and never touches batch codes.
>
> Warn on a duplicate batch code within one job.
>
> **Short-link service** `src/enrich/shortlink.js` — the operator pastes a full ClickUp URL and presses **Proceed**; the service validates the URL, mints a short code, stores the mapping, and returns the short URL plus its resulting QR module count so the UI can confirm the symbol will be scannable before anything is printed. Re-pasting the same target URL returns the existing code rather than minting a duplicate. `GET /j/:code` 302-redirects to the target. The QR encodes `STICKER_SHORT_BASE + '/j/' + code`. Codes are 5 characters from an **uppercase-only** unambiguous alphabet excluding `O`, `0`, `I`, `1`.
>
> The QR payload is emitted **entirely in uppercase** (`HTTPS://YOURDOMAIN/J/AB12X`). QR alphanumeric mode covers only uppercase, digits and a few symbols; a single lowercase character forces byte mode and costs symbol size. Uppercasing buys an ECC upgrade from M to Q at identical dimensions. This makes the redirect route **case-insensitive on the path** a hard requirement — upper-case the path parameter before lookup, since HTTP paths are case-sensitive by default even though DNS is not.
>
> Enforce a module ceiling: reject a target that would push the symbol past 27 modules, since that drops it below 3 dots per module at the label's 96-dot budget. Mappings persist to a JSON file and are archived with the job — a printed label must resolve years later. See Part 8 for why this is built in rather than adopted.
>
> Tests: every qty rule, shelf-life arithmetic across a year boundary, alias and fuzzy lookup, unresolved items, batch pattern acceptance and rejection, short code collision handling, and redirect behaviour for unknown codes.

---

### Prompt 4 — HTTP API and job store

> **Job store** `src/store/jobStore.js` — Map with TTL sweeper (default 30 min, `STICKER_JOB_TTL`), interface `create / get / patchLine / patchJob / list / delete`. Uploads stage in `STICKER_TMP` and are removed on expiry. Completed jobs archive to disk so a reprint months later needs no re-upload. No store internals leak into route handlers.
>
> **Routes:**
> - `POST /api/jobs` — multipart upload of one or two documents; extract, parse, join, enrich; returns the job with all warnings and a provenance summary
> - `GET /api/jobs/:id`
> - `PATCH /api/jobs/:id` — category, customer, docNo, qrUrl
> - `PATCH /api/jobs/:id/lines/:index` — batch, dates, qty, copies; re-enriches that line and returns it with recomputed status and provenance
> - `POST /api/jobs/:id/lines/:index/preview` — `{ zpl, warnings }`
> - `GET /api/jobs/:id/zpl?lines=1,3,4` — concatenated download
> - `GET /api/template?dpi=203` — resolved template for the browser renderer
> - `GET /j/:code` — short-link redirect
> - `GET /api/health` — poppler availability, item master rows, printer reachability, active jobs
>
> **Middleware:** request ID, structured JSON logging (never log document contents), upload limits (10 MB; PDF/PNG/JPEG validated by magic bytes, not extension), and a central error handler mapping `AppError` to `{ error: { code, message, requestId } }`.
>
> **Config** `src/config.js` validates all environment variables at boot and fails fast listing what is missing — including `STICKER_DATE_ORDER`, which has no default.
>
> Tests: supertest coverage of every route including failure paths.

---

### Prompt 5 — Browser UI with live preview

> Single-page frontend. Vanilla ES modules, no framework, no build step, served from `public/`.
>
> **Canvas renderer** `public/js/render-canvas.js` consumes the *same* resolved template as the ZPL emitter and imports the *same* metrics and fit logic — no reimplementation. Draws at exact dot dimensions, scaled for display, strictly 1-bit with no anti-aliasing, so the preview shows what actually prints. Quiet zone and printhead limits as dashed overlays.
>
> **Layout:** upload panel → provenance bar → line grid → preview pane.
>
> **Provenance bar (D2):** one chip per job-level field showing extracted / derived / manual / missing, with a running count. Clicking a chip focuses its input. Missing fields are visually distinct from empty-but-optional ones.
>
> **Job-level inputs:** resolution dropdown (203/300/600), printer selector, category (defaulted), and a ClickUp link field.
>
> **Link flow:** the operator pastes the full ClickUp URL into a normal-width field and presses **Proceed**. The field then collapses to show the short URL, its character count, and the resulting QR module count with a green/amber/red indicator against the 3-dots-per-module floor. An **Edit** action restores the original URL for correction. The full URL is never encoded into the QR — it cannot fit at this label size.
>
> **Line grid** — one row per picked line: item (badged when the master match was fuzzy or missing), qty in ml, MNF, EXP (auto-filled, editable), batch code, copies, status.
>
> **Data entry ergonomics — this is a warehouse tool, treat it as the main feature:**
> - Batch field autofocuses on row select, accepts scanner input, validates against the pattern live; Enter commits and jumps to the next incomplete row
> - MNF accepts `MM/YYYY`, `MM/YY`, `MMYYYY`; normalises on blur; a "fill down" action copies the column
> - Every edit PATCHes optimistically and reconciles with the server
> - Rows not `ready` are visually distinct and excluded from print by default
> - Full keyboard operation; no action requires the mouse
>
> **Print all:** select-all, a per-row copies column, and a confirmation dialog stating the exact total label count before anything is sent. Above `STICKER_CONFIRM_THRESHOLD` (default 50) require typing the number to confirm. Accidentally sending 400 labels is the failure mode this prevents.
>
> **Preview** updates on every committed edit. Guard warnings render as annotated markers on the canvas, not just a text list.
>
> **Calibration mode** `?calibrate=1` overlays a 1 mm grid with a draggable slot inspector reporting live coordinates, so geometry is tuned against a real printed label and the corrected JSON copied out.
>
> Design for a shop floor: large hit targets, high contrast, legible at arm's length, persistent "N of M ready" status line.

---

### Prompt 6 — Printing and verification

> `src/net/printer.js` — raw TCP to port 9100 with connect and write timeouts (default 5 s). Named printers from `STICKER_PRINTERS` as `name=host:port,dpi`. On connect, verify the logo graphic exists and re-send it if not.
>
> Serialised per-printer queue so two operators cannot interleave. `POST /api/jobs/:id/print` takes a line selection and printer name.
>
> **Scan-back verification.** After a print run, present a single field and ask the operator to scan one printed label's barcode. Compare against expected; on mismatch, show which batch code was expected versus read and block the run from being marked complete. This catches darkness drift, a dirty printhead, and label stock changes before a whole pallet goes out wrong. It costs almost nothing to build and is the highest-value quality control in the whole system.
>
> Append-only audit log: who printed which batch code, when, how many copies, to which printer, and whether verification passed. Reprints require a reason code — a duplicate batch code in circulation is a traceability event.
>
> `~HS` host status with a documented caveat that many networked Zebras do not answer, degrading gracefully.

---

### Prompt 7 — CLI, hardening, documentation

> Headless CLI `bin/sticker.js`: `parse <file>`, `job <sampleNote> <picklist>`, `zpl <job.json> --line N --dpi 203`, `print <job.json> --printer NAME`, `validate-template <path>`, `logo <image> --size 144 --knockout`. Exit codes distinguish usage errors, parse failures, and print failures.
>
> Harden: end-to-end test from fixture documents to golden ZPL; documented error-code table; README covering setup, every environment variable, the item master CSV format, template calibration, logo regeneration, and troubleshooting for the three clipping sources plus barcode and QR scan failures.

---

### Prompt 8 — Optional: OCR fallback

Only if you'll be handed phone photos rather than PDFs. A tesseract adapter behind the existing extract interface, with deskew and threshold preprocessing. Treat OCR output as low-confidence: every field arrives with provenance `extracted` but a `confidence` note, and the UI flags the whole job for review.

---

## Part 8 — Findings and recommendations

### 1. The QR payload — resolved, and better than expected

Measured module counts at the 96-dot QR budget the label allows. Three dots per module is the practical scan floor at 203 dpi.

| Payload | Chars | ECC | Modules | Dots/module |
|---|---|---|---|---|
| ClickUp form URL + prefill | 104 | M | 43 | 2 ✗ |
| ClickUp form URL, plain | 60 | M | 35 | 2 ✗ |
| `https://sh.lk/j/AB12X` | 21 | M | 27 | 3 ✓ |
| `HTTPS://SH.LK/J/AB12X` | 21 | **Q** | **27** | 3 ✓ |
| `HTTPS://STANDARDHOLDINGS.LK/J/AB12X` | 35 | M | 27 | 3 ✓ |

Two findings that change the design for the better:

**Encode the URL in uppercase.** QR has an alphanumeric mode covering uppercase letters, digits, and a few symbols; any lowercase character forces the less efficient byte mode. Uppercasing the same 21-character URL buys an ECC upgrade from M to Q at *identical* symbol size — meaning the code tolerates more smudging, scuffing, and print drift on a drum label, for free.

This imposes one requirement: **the redirect route must treat its path case-insensitively.** DNS is already case-insensitive, but HTTP paths are not. Generate codes from an uppercase-only alphabet and upper-case the path in the route handler.

**You do not need a short domain.** A 35-character URL on your existing company domain still lands at 27 modules and 3 dots per module, because alphanumeric mode packs efficiently. Buying a vanity domain buys you an ECC bump, not scannability. Use the domain you already have.

Dropping `HTTPS://` entirely gets to 23 modules and 4 dots — but many phone cameras will not offer to open a scheme-less string. Not worth the trade.

### 2. Build the shortener, don't adopt one

Mature self-hosted options exist — YOURLS is the long-standing PHP one, with Kutt, Polr, Shlink, Dub and Cloudflare-Workers-based Sink also in the field. **Use none of them here.**

A shortener is three operations: mint a code, store a mapping, 302 redirect. That is roughly forty lines inside the Express server you are already building. Adopting a project instead means:

- a second service to deploy, monitor, back up and upgrade — for links printed permanently onto drums that must resolve in five years
- the mapping living outside your job archive, so reprinting a six-month-old label means querying another system
- no way to enforce the constraint that actually matters: **the code must be short enough to hold the QR at or under 27 modules.** A general-purpose shortener hands you whatever length it likes, and a code two characters too long silently pushes the symbol to the next version and below the scan floor

Build it in. Codes are 5 characters from an uppercase alphabet excluding `O`, `0`, `I`, `1`. Mappings persist to disk and are archived with the job. Re-pasting the same target returns the existing code.

**The real decision is hosting, not software.** Whatever serves `/J/:CODE` must resolve from whatever device scans the label, and must keep resolving for as long as the drums exist. Worth settling before the first production print:

- **Public** — anyone outside the factory scans it. Needs a public host on a domain you control and intend to keep.
- **Internal only** — only staff on factory wifi scan it. An internal hostname works and can be very short, but a phone on mobile data will get nothing. Since the QR points at a ClickUp form and ClickUp is itself a public web app, this is likely the wrong choice.
- **Cloudflare Workers + KV** — a good middle path if you would rather not run an always-on server. The app pushes mappings up; Cloudflare serves the redirect. Effectively free and very hard to kill.

### 3. Validate the batch code, don't just accept it

`JUR260725` typed by hand at the end of a shift becomes `JUR26O725` — letter O for zero. Code 128 encodes both happily and the barcode scans fine; it just scans as the wrong batch. A pattern check plus a specific warning on the `O/0`, `I/1`, `S/5` confusions costs ten lines of code.

Better still: if the material drums already carry that code as a printed barcode, scan it rather than typing it. **This is still unconfirmed** — the field is built to accept both, since a handheld scanner presents as a keyboard and fills a text input identically. Concretely, to settle it: go and look at a drum, and separately ask whoever writes `JUR260725` today where they read it from. If a barcode is there, scanning it removes a defect source entirely and the UI needs no change.

One hypothesis worth testing while you are asking: `260725` looks like a date, but it matches neither the 05/2026 manufacture nor the 05/2028 expiry on the sample label. If it turns out to encode a goods-receipt date, part of the code may be derivable rather than entered — which would be worth knowing before operators type it thousands of times.

### 4. Scan one label back after every run

The single highest-value addition to this system, and it's in prompt 6. Print, scan one, confirm. It catches darkness drift, a partly failed printhead element, and wrong label stock — all of which produce labels that look fine to a human and fail at the customer.

### 5. Consider the knockout logo

8.7% black coverage against 69.9%. Faster printing, much less heat into the printhead, and no risk of the thin white ring lettering bleeding shut as the head ages. Both variants are in `assets/logo-store.zpl`; print one of each and decide with the samples in hand.

### 6. Never dither the logo

Threshold it. Floyd–Steinberg on a two-tone logo at 203 dpi produces speckle that reads as printing defects and wastes heat. Dithering is for photographs, and there are none on this label.

### 7. Keep printer settings per-printer, not global

Darkness, print rate, media type (`^MN`), and label-top offset (`^LT`) vary by machine, ribbon, and stock. A single global darkness value means every new printer needs someone to edit a config file. Make them a printer profile alongside host, port, and dpi.

### 8. Archive completed jobs

A reprint six months later should not require finding the original PDF. Archive the resolved job — including the short code mapping — so any historical label can be reproduced exactly.

---

## Part 9 — Still needed before prompt 1

| # | Item | Status |
|---|---|---|
| 1 | Date order | ✅ **MDY, month first.** Locked. |
| 2 | Item master spreadsheet — ERP description, display name, SKU, fill volume in ml, shelf life in months; density only where kg converts to ml | Outstanding, blocking prompt 3 |
| 3 | Batch code source — printed on the drum, or transcribed? | Outstanding. Not blocking; the field accepts typing and scanning identically. See finding 3 for how to settle it. |
| 4 | Printer model and dpi | Outstanding, sets the dropdown default |
| 5 | Domain for the redirect | Your existing company domain works — see finding 1. Decide the hosting, not the name. |
| 6 | Both source documents as real PDFs rather than screenshots | Outstanding; makes the parsers far more reliable and removes the need for prompt 8 |

Only item 2 blocks a prompt. Prompts 1 and 2 can start now.

# Sticker Engine

Thermal label generation for 4×1 inch Zebra stickers: reads Picklist and Sample
Note PDFs, and emits ZPL II straight to the printer. Complete: domain model,
template and ZPL emitter, document ingestion, enrichment with the x.gd
short-link service, the HTTP API, the browser interface, socket printing with
scan-back verification and an audit trail, and a headless CLI.

```
sticker-engine/
├── ecosystem.config.cjs      PM2 process definition (fork mode, one instance)
├── .env.example              copy to .env; holds the x.gd key
├── package.json
│
├── src/
│   ├── server.js             HTTP entry point
│   ├── config.js             env validation; date order logged at boot
│   ├── errors.js             typed AppError hierarchy
│   │
│   ├── model/
│   │   ├── types.js          Field wrapper + document and job typedefs
│   │   └── qty.js            verbatim quantity formatting (0.30KG, 310ML, 1.5L)
│   │
│   ├── ingest/
│   │   ├── extract.js        reader interface + poppler adapter + classification
│   │   ├── anchors.js        label lookup, column alignment, row collection
│   │   ├── dates.js          order-driven date parsing
│   │   ├── parsePicklist.js      Picklist    -> domain object
│   │   ├── parseSampleNote.js    Sample Note -> domain object
│   │   ├── parseSalesOrder.js    Sales Order -> domain object
│   │   └── join.js           documents -> one LabelJob
│   │
│   ├── enrich/
│   │   ├── enrichJob.js      manufacturer default, manual-entry checks, readiness
│   │   ├── batch.js          batch code checks and duplicate detection
│   │   └── shortlink.js      x.gd client, local archive, QR payload planning
│   │
│   ├── template/
│   │   ├── schema.js         validation + resolve(template, dpi)
│   │   ├── label-4x1.json    measured geometry, authored at 203 dpi
│   │   └── bind.js           {token} resolution and part dropping
│   │
│   ├── store/
│   │   ├── jobStore.js       in-memory jobs, TTL sweeper, disk archive
│   │   └── files.js          staged uploads
│   │
│   ├── http/
│   │   ├── app.js            Express wiring; every side effect injected
│   │   ├── serialise.js      wire shape + provenance summary
│   │   ├── probes.js         poppler and printer health checks
│   │   ├── middleware/       request id, logging, uploads, error handler
│   │   └── routes/           jobs, template, short links, redirect, health
│   │
│   ├── net/
│   │   ├── printer.js        raw TCP to port 9100, ~HS, logo presence
│   │   └── printQueue.js     serialised per printer
│   │
│   ├── print/
│   │   └── runService.js     runs, reprint gating, scan-back verification
│   │
│   ├── audit/
│   │   └── auditLog.js       append-only JSON lines
│   │
│   ├── logo.js               PNG -> ~DG, no dependencies
│   │
│   └── render/
│       ├── metrics.js        ^A0 width estimation, fit, truncation, centring
│       ├── symbology.js      Code 128 and QR module planning
│       ├── layout.js         measure -> place -> placed elements
│       ├── zpl.js            serialise placed elements to ZPL II
│       └── guard.js          clipping and scannability warnings
│
├── public/                   the interface: vanilla ES modules, no build step
│   ├── index.html
│   ├── css/app.css           shop-floor styling: large targets, high contrast
│   └── js/
│       ├── app.js            wiring and keyboard shortcuts
│       ├── state.js          optimistic edits, serialised per line
│       ├── render-canvas.js  preview; imports /src/render/layout.js directly
│       ├── symbols.js        Code 128 encoder for the preview bars
│       ├── browserPrint.js   Zebra Browser Print, wrapped in promises
│       ├── print.js          the four-step print flow
│       ├── diagnostics.js    the printer troubleshooting page
│       ├── api.js, dom.js, format.js
│       └── components/       provenance bar, line grid, link field,
│                             print dialog, calibration inspector
│
├── test/
│   ├── *.test.js             421 tests, node:test, no network, no printer
│   └── fixtures/             document captures + the golden ZPL
│
├── bin/
│   └── sticker.js            headless CLI
│
├── scripts/
│   └── write-golden.js       regenerate the golden fixtures (run deliberately)
│
├── assets/
│   ├── ui-*.png              screenshots of the three screens
│   ├── logo-store.zpl        ~DG commands; send to each printer once
│   ├── logo-solid-144.png    the two logo variants, 1-bit at 144 dots
│   ├── logo-knockout-144.png
│   └── label-mockup-*.png    reference renderings at true dot size
│
├── docs/
│   ├── deploy.md                 VPS deployment, start to finish
│   ├── print-guide.md            the operator's six steps, with screenshots
│   ├── prompt-browser-print.md   the build spec this was implemented from
│   ├── build-plan.md             the eight-prompt plan and design decisions
│   ├── errors.md                 every error code and what to do about it
│   └── sh-it-hub-integration.md  API contract, deployment, open questions
│
├── data/                     short-link archive, staged uploads   [gitignored]
└── logs/                     PM2 output                           [gitignored]
```

    npm start               # listens on STICKER_PORT (6969)
    npm test                # 421 tests
    npm run golden          # regenerate the golden ZPL fixture (deliberate)

## Design notes

**One geometry authority.** `layout.js` produces placed elements; `zpl.js` and
`guard.js` only read them. The browser preview in prompt 5 will consume the same
output, which is what stops preview and print from drifting apart.

**Three passes, because one is not enough.** Text is measured before anything is
placed. The quantity bar sizes itself to its own caption, but the caption is
positioned from the bar, so the bar must be placed first — a circular order
that only resolves if measurement is separate from placement. (In the ZPL the
bar is then *emitted* after its caption: the caption is struck black and the
bar is reversed over it with `^FR`, which leaves the bold caption white.) The
schema validates the two reference kinds differently for exactly this reason.

**Native symbols only.** Barcodes and QR codes emit as `^BC` and `^BQ`. Nothing
here can produce a `^GFA`, and a test asserts it.

**Data is never rewritten.** A batch code typed with a letter `O` instead of a
zero prints as typed. Correcting it silently would produce a barcode that scans
as a batch nobody entered — worse than the typo. Warning belongs in the UI.

## Two things to verify against a real printer

**Font metrics are an approximation.** Zebra publishes no advance table for
font `^A0`. `metrics.js` models it on Helvetica metrics with a single
calibration constant, `EM_PER_DOT_HEIGHT`, deliberately biased to over-estimate
width — over-estimating shrinks text slightly, under-estimating runs it off the
label. Print a sample, measure it, adjust that one constant.

**The barcode margin is thin.** In the reference layout the barcode gets 322
dots against the 308 a nine-character Code 128 needs with full quiet zones. A
longer date format or a wider quantity eats that quickly, and the guard is what
stands between you and an intermittently scannable pallet. Raising dpi helps
strictly in proportion — everything else on the label scales too — so a layout
at 1.1 dots per module needs roughly double the density, not half again.

## Ingestion notes

**Nothing is spawned in tests.** The poppler adapter takes its process runner by
injection, so the whole pipeline runs without poppler installed. An OCR reader
drops in behind the same `{ id, accepts, read }` interface and its `confidence`
travels through to the UI untouched.

**Anchors, not offsets — but alignment where alignment is the fact.** Values are
found by their printed label. Inside a table, however, a wrapped cell's column
*is* determined by where it sits, so continuation fragments are matched to their
parent column by horizontal overlap. Two real cases the fixtures cover:

- The order number wraps as `RSMSO2609` then `0040`. Read naively, `0040` is row
  forty and the table falls apart. Rows are only started by the ordinal the
  sequence expects next, and the fragment rejoins its column with no space.
- The Bill To address and the Sample Note Date share horizontal space. Reading
  the address until a blank line swallows the date into the customer's address.

**Dates are never guessed.** `13/04/2026` under `MDY` is rejected outright rather
than swapped to `DMY` — silently reinterpreting it is precisely how a document in
an unexpected format gets read wrong without anyone noticing. The resolved order
is logged at boot with a worked example.

**One arithmetic check exists, so it is made.** The join sums the picked
quantities and compares them against the total the Picklist prints. That catches
the failure that is otherwise invisible: a row the parser could not read,
dropped with a warning nobody looked at.

**The picked weight is not the label quantity.** The Picklist records kilograms;
the label prints millilitres. `qtyMl` stays absent until the item master supplies
a density or fill volume. Putting the picked mass there would print a number that
means something else.

## What comes from where

The **Sample Note and the Picklist are the working pair** — between them they
carry everything the label prints. A Sales Order is accepted but optional.

| Document | Number | Supplies | Role |
|---|---|---|---|
| Sample Note | `RSMINV…` | The number in the label header | Primary |
| Picklist | `PL-…` | **Item name and quantity**, with its unit | Primary |
| Sales Order | `RSMSO…` | Customer fallback, ordered-line cross-check | Optional |

Everything printed comes off a document except five values the operator
supplies: batch number, manufacture date, expiry date, ClickUp link and
manufacturer.

**There is no item master.** The item name is the Picklist description printed
verbatim, and the quantity is the Picklist's own numeral and unit. Nothing is
looked up, so there is no spreadsheet to build or keep in step with the ERP.

**Nothing is converted.** A Picklist line saying `0.30 kg` prints `0.30KG`; one
saying `310 ml` prints `310ML`; one saying `1.5 l` prints `1.5L`. Units come
from the document, so no densities, no fill volumes, no litre splitting. The
numeral keeps its trailing zeros —
`1.000` prints as `1.000`, because "as written" is the rule and the zeros are
the document's own statement of precision.

**The manufacturer prints after a fixed prefix.** The operator pastes
`Miscellaneous Supplier`; the label renders `MANUFACTURER - Miscellaneous
Supplier`. If nothing is pasted, the whole part drops out of the header rather
than printing an orphaned `MANUFACTURER - `.

**No batch format is enforced by default.** The batch code appears on no
document, so the system has no basis for deciding what a valid one looks like.
Set `STICKER_BATCH_PATTERN` if your codes really do follow one shape; only then
does a mismatch get flagged and a confusable `O`-for-`0` get pointed at. Either
way the code is printed byte-for-byte as entered — a silently corrected code
produces a barcode that scans as a batch nobody typed.

**The operator's edit always wins.** Once a field is `manual`, enrichment leaves
it alone. It re-runs on every keystroke that changes a date and must not
overwrite what was just typed.

## Short links — x.gd

There is nowhere to host a redirect, so shortening is delegated to x.gd through
`GET https://xgd.io/V1/shorten`. Set `STICKER_XGD_API_KEY`.

**Their `shortid` parameter is what makes this work.** It accepts a custom id of
6 to 15 characters from `[0-9a-zA-Z_]`, so the service requests an all-uppercase
id. That keeps the QR in alphanumeric mode, which buys error correction level Q
instead of M at the same symbol size — more tolerance for scuffing and print
drift on a drum label, free.

Measured at the label's 96-dot budget:

| Payload | Mode | ECC | Modules | Dots/module |
|---|---|---|---|---|
| Raw ClickUp form URL | byte | M | 37 | 2 — refused |
| `https://x.gd/aB3xK9` (their random id) | byte | Q | 29 | 3 |
| `HTTPS://X.GD/HFH7K2` (uppercase custom id) | alphanumeric | **Q** | 29 | 3 |

**Case is handled carefully.** Scheme and host are uppercased because RFC 3986
makes them case-insensitive. The path is never touched, because it is not —
uppercasing a code someone else generated points the QR at a different link or
at nothing. The win is taken at mint time by choosing the id, not afterwards.

**Every mapping is written locally as well.** A printed drum label depends on
x.gd staying up, and nothing can fix that once the label is on the drum. The
local archive at least preserves what each code was supposed to mean, and makes
moving to a self-hosted redirect a new provider rather than a rewrite.

**Analytics defaults off.** x.gd enables click tracking unless told otherwise,
and a scan on a factory floor is not something a third party needs a record of.
Set `STICKER_XGD_ANALYTICS=true` to opt in.

**Without an API key the system still works.** Minting is refused with a clear
message, and a link shortened by hand at x.gd can be adopted instead.

## HTTP API

    POST   /api/jobs                          multipart "documents", one or two PDFs
    GET    /api/jobs
    GET    /api/jobs/:id
    PATCH  /api/jobs/:id                      manufacturer, customer, docNo, qrUrl
    DELETE /api/jobs/:id
    PATCH  /api/jobs/:id/lines/:index         batchCode, mnfDate, expDate, qty, copies
    POST   /api/jobs/:id/lines/:index/preview { zpl, warnings, dpi }
    GET    /api/jobs/:id/zpl?lines=1,3&dpi=203
    GET    /api/template?dpi=203
    POST   /api/shortlinks                    { url } -> code, payload, symbol plan
    GET    /j/:code                           302 from the local archive
    GET    /api/health

**Provenance is the field a client builds its form around.** Every value is
`extracted`, `derived`, `manual` or `missing`, and a `missing` field carries a
note saying what it is waiting for. That is enough to render the whole screen
generically, without hard-coding which fields an operator may edit.

**Editing re-runs enrichment rather than patching around it.** Enrichment is a
pure function of the job, so a line PATCH recomputes status and provenance from
scratch and returns them. Nothing can drift out of step with the fields it
describes.

**Uploads are judged by content.** Type comes from magic bytes, not the
filename — an extension is attacker-controlled text. Stored names are generated;
the uploaded one never reaches a path.

**Logs never contain document contents.** Uploads are logged as a size and a
type. Customer names, order numbers and extracted values stay out of the log
file, and a test asserts it.

**Health distinguishes down from degraded.** Missing poppler is `unhealthy`,
because nothing can be read without it. An unreachable printer is `degraded` —
an operator can still prepare a job, and reporting that as down would train
whoever watches the endpoint to ignore it.

**The job store is deliberately in-process.** That is why `ecosystem.config.cjs`
pins PM2 to fork mode with one instance: cluster workers do not share memory, so
an operator's edit would land on a worker that has never seen their job. Scaling
past one process means moving the store to shared storage first.

## The interface

Open `http://host:6969` — **through the server, not as a file.** The page links
`/css/app.css` and `/js/app.js` as absolute paths, which only resolve from the
site root. Double-clicking `public/index.html` gives unstyled HTML and a dead
page, because both requests 404 against the filesystem.

    npm start          # then http://localhost:6969

Drop a Picklist and a Sample Note on the page, or pick them with the file field.
Screenshots of all three screens are in `assets/ui-*.png`.

It follows the SH-IT house style: soft grey ground, white cards with a gradient
hairline, monospace uppercase labels above a heavy sans heading. Two deliberate
departures, because this is read at arm's length in a warehouse rather than at a
desk — data text is darker than the reference's muted grey, and every state that
matters carries a shape or a word as well as a colour. Fonts are system stacks:
a warehouse machine may have no route to a font CDN, and a page that falls back
to Times the one day the network is down is worse than one that never asked.

**Preview and print cannot drift apart, structurally.** The canvas renderer
imports `/src/render/layout.js` — the same module the ZPL emitter calls — so
there is one implementation of placement, fit and wrapping rather than two that
have to be kept in step. A test fails if anyone reimplements it in the browser,
and another walks the whole module graph over HTTP so a missing file cannot
leave a blank page with one line in the console.

**The preview is 1-bit with smoothing off.** A grey anti-aliased edge would
suggest a precision the printhead does not have: a dot is either burned or it
is not, and softening that hides exactly the problems this is here to reveal.
Guard warnings are drawn as markers on the artwork rather than listed
underneath, because the useful question is *which part of the label*.

**The barcode in the preview is real.** Code 128 is encoded properly, subsets B
and C both, matching what the printer does — verified against an independent
encoder. The QR is exact in size, position and module count but its pattern is
indicative; the printer generates the real symbol from `^BQ`, and carrying a
second QR encoder here would mean two implementations that could disagree. The
pane says so, so nobody scans the screen to test it.

**Data entry is keyboard-first.** The batch field takes scanner input as
ordinary keystrokes, and Enter commits and jumps to the next row still needing
work — scan, Enter, scan, Enter, which is the actual rhythm of the job. Dates
accept `05/2026`, `5/26`, `052026` or `05-2026` and normalise on blur rather
than mid-keystroke. Each column has a fill-down. Nothing on the screen needs a
mouse.

**Renders are deferred by a frame.** An edit commits from a blur handler, and
rebuilding the panel while the browser is still dispatching that blur removes the
node being blurred and throws part-way through. Deferring also coalesces a burst
into one pass, which matters when a fill-down touches every row.

**A line that becomes ready joins the run by itself.** Finishing a row and then
having to tick it as well is a step nobody would thank us for, and forgetting it
means the label silently does not print. Unticking still holds: a deliberate
exclusion is remembered and not undone.

**Edits are optimistic but serialised.** A field commits visually at once and
reconciles with the server's answer, since only the server knows the recomputed
status and warnings. Edits to one line are queued rather than fired in
parallel: two PATCHes in flight can land out of order, and with a batch number
the loser silently overwrites the winner, which is a wrong label nobody can see
is wrong.

**Nothing important is carried by colour alone.** Every provenance has a border
weight and style as well as a hue; every row status has a word. Colour is the
first thing to fail under bad warehouse lighting or on a cheap panel.

**A large run has to be typed out.** The confirmation dialog states the exact
total, and above `STICKER_CONFIRM_THRESHOLD` (default 50) it will not proceed
until the number has been entered — which cannot be done by muscle memory.

**Calibration mode** is `?calibrate=1`. It overlays a one millimetre grid and
lets slots be dragged, reporting live coordinates, so the template geometry can
be tuned against a real printed label and the corrected JSON copied out.

## Printing

A Zebra listens on port 9100 and prints whatever ZPL arrives. There is no
driver and no spooler, which is convenient and also the hazard: the printer
acknowledges nothing, reports nothing, and will consume a malformed job in
silence. Everything checkable is checked; everything else is said out loud.

**Jobs to one printer are serialised.** Two operators pressing Print at the same
moment would otherwise interleave their ZPL on the wire, and a `^XA` arriving
inside another label's field data produces garbage on both runs with nothing to
show for it. Queues are per printer, so two machines still work at once.

**The logo is checked before the first label.** A missing `^XG` target prints a
blank space and reports nothing, so the labels come out looking almost right —
the worst kind of wrong. The graphic object is queried once per printer per
process; if the printer will not answer, it is sent anyway. `R:` is RAM and
clears on a power cycle.

**`~HS` is best-effort by design.** Many networked Zebras never answer it. Older
firmware, print servers and some ZD models simply stay quiet, and a silent
printer is not a broken one — so no reply is reported as `unknown` rather than
as a fault. Treating silence as a fault would block printing on healthy
hardware.

**A successful write means the bytes left this machine.** It does not mean a
label came out. Nothing in the protocol can tell you that, which is why the next
part exists.

### Scan-back verification

After a run, scan one printed label. The code is compared against what the run
should have produced. A match completes the run; a mismatch blocks it and shows
which code was expected against which was read.

This is the highest-value check in the system and it costs almost nothing.
Darkness drift, one dead printhead element and a change of label stock all
produce labels that look fine to a human and fail at the customer. A scanner
reading one label back catches all three before the pallet moves.

A case-only difference is diagnosed specifically: the barcode encodes exactly
what was typed, so `jur260721` against `JUR260721` means the label is wrong, not
the scanner.

### The audit trail

Append-only JSON lines at `STICKER_AUDIT_LOG`, never rewritten — an audit trail
that can be edited is not one. Every run is recorded with who, when, which
printer, how many labels, and whether verification passed; every batch code gets
its own line as well, because the question asked months later is almost always
"where did this batch go". A truncated final line from an interrupted write
costs that line and nothing else.

**A reprint needs a reason.** If a batch code in a run has been printed before,
the run is refused until one is given. A second label carrying a batch already
in circulation is a traceability event, and it is never allowed to happen
silently.

## Command line

    sticker parse <file.pdf>                      read a document, print the parsed JSON
    sticker job <picklist.pdf> [sampleNote.pdf]   build a job as JSON
    sticker zpl <job.json> --line N [--dpi 203]   emit ZPL for one line
    sticker print <job.json> --printer NAME       send ready lines to a printer
    sticker printers                              list printers and probe each one
    sticker status --printer NAME                 ask a printer how it is (~HS)
    sticker validate-template <template.json>     check a template, report its slots
    sticker logo <image.png> [--size 144]         convert a logo to a ~DG command
                             [--knockout] [--out file.zpl]

Exit codes distinguish a bad document (3) from a dead printer (4) from your own
mistake (2), so a script can branch without parsing stderr. See `docs/errors.md`.

## Calibrating the template

The geometry was measured from a rendering, not from a printed label. To tune it
against real output:

1. Print one label and hold it against the screen.
2. Open the interface with `?calibrate=1`. A one millimetre grid overlays the
   preview and slots can be dragged; the readout gives live coordinates.
3. Copy the corrected template out and paste it into
   `src/template/label-4x1.json`.
4. `sticker validate-template src/template/label-4x1.json`, then `npm run
   golden` and read the diff before committing it.

Only one constant should ever need moving for a font mismatch:
`EM_PER_DOT_HEIGHT` in `src/render/metrics.js`. It is biased to over-estimate
width, because over-estimating shrinks text slightly while under-estimating runs
it off the label.

## Regenerating the logo

    sticker logo assets/logo-solid-144.png --size 144 --out assets/logo-store.zpl
    sticker logo assets/logo-solid-144.png --size 144 --knockout --out assets/logo-ko.zpl

PNG only. A JPEG is refused with the conversion command rather than
half-decoded: writing a JPEG decoder to convert a two-tone logo would be a lot
of code for a worse result than converting the file once.

Send the result to each printer once — `cat assets/logo-store.zpl | nc HOST
9100` — and every label then recalls it with a two-byte `^XG` instead of pushing
2.6 KB per label.

The solid mark is 69.9% black; the knockout is 8.7%. **Print one of each before
choosing.** At 144 dots the white ring lettering in the solid version is one to
two dots wide, thermal heat spreads sideways, and thin white gaps inside a large
black field tend to close up as a printhead ages. Below 144 dots the lettering
degrades badly at any darkness: 120 is marginal, 96 is illegible.

## Troubleshooting

### Text or artwork is cut off

Three different causes, reported separately because the fix differs.

| Warning | Cause | Fix |
|---|---|---|
| `PRINTHEAD_OVERFLOW` | The artwork is wider than the printhead | The label is 4 in; check the printer is not a 2 in model |
| `EDGE_OVERFLOW` | The artwork runs past the label edge | A template bug — calibrate, or shorten the content |
| `QUIET_ZONE_INTRUSION` | Artwork within 1.5 mm of the edge | Tolerable, but it will clip on a misfed label. The printed border opts out deliberately with `edge: true` |

### The barcode will not scan

Check `BARCODE_TOO_NARROW` first: below two dots per module, Code 128 scans
intermittently, which is worse than not scanning because it passes on the desk
and fails in the warehouse. The margin is thin by design — the reference layout
gives the barcode 322 dots against the 308 a nine-character code needs with full
quiet zones. A longer date format or a wider quantity eats that quickly.

Raising the resolution helps strictly in proportion, because every text element
scales with it too and the barcode's share of the label never changes. A layout
at 1.1 dots per module needs roughly double the density, not half again.

If the geometry is fine and it still will not scan, it is the printer: darkness
too low, a dirty or worn printhead, or the wrong stock. That is exactly what
scan-back verification catches.

### The QR will not scan

Below three dots per module a QR is unreliable at 203 dpi. The interface shows
the count before anything prints, with a green, amber or red indicator.

A full ClickUp URL needs 37 modules and cannot fit — shorten it. The system asks
x.gd for an all-uppercase custom id, which keeps the payload in QR's
alphanumeric mode and buys error correction Q instead of M at the same symbol
size, meaning more tolerance for scuffing on a drum.

### Labels print without the logo

The graphic is missing from printer memory. `R:` is RAM and clears on a power
cycle. Re-send `assets/logo-store.zpl`; the service does this automatically on
its first job to each printer after a restart, but not after the *printer*
restarts mid-session. Use `POST /api/printers` state or restart the service to
clear the cache.

### The dates on printed labels are wrong by months

`STICKER_DATE_ORDER`. `09/04/2026` is 4 September under `MDY` and 9 April under
`DMY`. The resolved order is logged at boot with a worked example, and an
impossible date is refused rather than reinterpreted.

## Deploying

`docs/deploy.md` covers a fresh Ubuntu VPS start to finish: prerequisites,
install, persistent data, every environment variable, PM2, nginx, TLS, the
verification checklist, backups and upgrades.

**Read section 0 first.** A Zebra listens on port 9100 on your factory LAN, and
a VPS off-site cannot open a socket to it — the connection has to be initiated
from inside your network. Everything else works identically either way, so
deploy first and settle printing after.

## USB printers

Every operator has a Zebra on **USB**, which a server cannot reach. Printing
therefore runs through **Zebra Browser Print**: a small per-workstation
application plus a JavaScript library that hands raw ZPL to a locally connected
printer. `STICKER_PRINT_TRANSPORT=browser` is the default.

**The server generates identical ZPL either way.** A test asserts the bytes
handed to the browser are the same as the network path would have sent. Only
the delivery moved.

Two files have to be dropped into `public/vendor/` from Zebra's download —
`BrowserPrint.js` and, optionally, `BrowserPrint-Zebra.js`. They are not
redistributed here. See `public/vendor/README.md`. Until they are present the
interface says so in a sentence naming the file and falls back to downloading a
`.zpl`.

**The audit trail records events, not intentions.** In browser mode the print
request creates a run as `pending` and writes nothing; the browser confirms
through `POST /api/runs/:id/sent`, and only then are the run and its batch codes
recorded. A failed send writes the failure and **no** label entries, so a batch
that never reached a printer does not enter the reprint history and get refused
next time as a duplicate.

**`/diagnostics`** is the page to open when labels are not coming out: whether
the application is reachable, every printer it can see, a test label with a
scannable Code 128, and a raw ZPL box. Each failure is explained in a sentence
saying what to do.

**Do not print through the browser's own print dialog.** That routes the page
through the Windows driver, which rasterises it — the barcode becomes a bitmap,
narrow bars round to inconsistent dot widths at 203 dpi, and it scans
intermittently. Intermittent is worse than broken: it passes at the desk and
fails in the warehouse.

**Scan-back is now in the interface.** A dialog opens by itself after every run
with the field focused. It can be skipped, but skipping is deliberate and the
run stays unverified.

## Next

Nothing is outstanding from the build plan. The two things worth doing next are
both operational rather than code: settle where this is hosted relative to the
factory network (`docs/sh-it-hub-integration.md`, section 5 — a hosted service
cannot reach a printer behind NAT), and put `data/` somewhere a redeploy will
not wipe, since it holds the short-link archive and the audit trail.

See `docs/sh-it-hub-integration.md` for how this API plugs into SH-IT_Hub, and
for the deployment question that matters more than any of it: a hosted service
cannot reach a printer behind factory NAT.

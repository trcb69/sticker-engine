# Reversed bold text prints unreadable

Status: spec, Revision 2. Date: 2026-09-14.
Baseline: dev clone `main` at `e9e7a81`, which is also what is live.
Rev 2 folds in plan-critic's verdict of APPROVE-WITH-CHANGES, findings N1 to N7.

## Problem

**Hardware, 2026-09-14.** A GC420t at 203 dpi printed label RSMSO26090053 through Browser Print. The white-on-black item name and QTY came out as scattered white scratches inside solid black bars. Everything else was readable.

**Emulator, 2026-09-13.** Finding Q2 in `docs/specs/2026-09-13-calibration/README.md:18`: hollow outlines, with a name box ink ratio of 0.961.

**Cause.** Bold is a double strike, the second one 1 dot to the right (`src/render/zpl.js:107-113`). A reversed element puts `^FR` on **both** strikes (`zpl.js:111-112`). `^FR` flips every dot the field covers, so the second strike turns most of the first strike's white dots black again. Only the dots the two strikes do not share stay white, which leaves outlines.

## Fix

For a reversed text in a filled box, emit the text strikes first, in plain black. Then emit the box, **with** `^FR`. Flipping is symmetric, so the box inverts the bold union of the strikes: bold white glyphs on a black bar. That is the shape the preview already draws (`public/js/render-canvas.js:295-300`).

Reference label, name bar. Before:
```
^FO166,64^GB512,54,54^FS
^FO175,72^FR^A0N,38,38^FH_^FDWin-Poly Blue 7007^FS
^FO176,72^FR^A0N,38,38^FH_^FDWin-Poly Blue 7007^FS
```
After:
```
^FO175,72^A0N,38,38^FH_^FDWin-Poly Blue 7007^FS
^FO176,72^A0N,38,38^FH_^FDWin-Poly Blue 7007^FS
^FO166,64^FR^GB512,54,54^FS
```

Alternatives rejected:
- **Single `^FR` strike, no bold.** The preview still draws two strikes (`render-canvas.js:298`), so preview and print would disagree. Thin white strokes are also the most likely to fill in on thermal stock.
- **Reordering elements in `layout.js`.** The preview draws in element order (`render-canvas.js:103`), so the black box would cover the white text on screen.

### Changes

- **`src/template/schema.js` `validateTemplate`** gets two new rules (N1, N2):
  - A slot with `reverse: true` must have `box` pointing at a slot of type `box` with `fill: true`. Otherwise it fails with `slot "<id>" is reversed but its box "<box>" is not a filled box` (or `…has no box`).
  - A filled box may be the `box` of at most one reversed slot. Otherwise it fails with `box "<id>" is the backdrop of more than one reversed slot`.
  - The comment at `schema.js:142-147` is rewritten: the bar is *placed* before its caption, and *emitted* after it.
- **`src/render/layout.js`**:
  - Placed `text` elements carry `box: slot.box ?? null`. No other field or coordinate changes.
  - The `elements` typedef (`layout.js:46`) changes from "In emission order" to "In placement order (the preview draws in this order; the ZPL emitter defers a reversed text's box until after the text)".
- **`src/render/zpl.js`**:
  - Before emitting, collect the ids of boxes referenced by placed reversed text elements.
  - Those boxes are skipped at their own position. Straight after the referencing text element, emit `^FO{x},{y}^FR^GB{w},{h},{h}^FS`.
  - Reversed text strikes carry no `^FR`.
  - If a reversed text reaches the emitter and its box is not among the placed filled boxes, throw a `TypeError`. That cannot happen with a validated template.
  - Everything else is emitted unchanged, in the same order.
- **Tests that contradict the new behaviour are rewritten, not deleted** (N4):
  - `test/zpl.test.js:76-82` becomes AC1.
  - `test/zpl.test.js:113-119` becomes AC6.
  - The comment at `test/schema.test.js:73-74` is updated.
- **Golden fixtures** `test/fixtures/golden-4x1-203.zpl` and `test/fixtures/golden-pipeline-203.zpl` are regenerated. Their diff may contain only the moved box lines and the moved `^FR`.
- **Docs** (N4):
  - `README.md:128-130`: the caption is emitted before its bar, which reverses over it.
  - `docs/build-plan.md:200`: `^FR` on the bar, after the text.
  - `docs/specs/2026-09-13-pdf-proof-print.md` (untracked; another session's spec) D-P5 and its Text row: any `^FR` field XORs the dots under it, whatever its kind. The Box row gains "`^FR` box: XOR".

## Acceptance criteria

AC1 to AC7 and AC10 are enforced by `npm test`. AC8 is an evidence script. AC9 is the human.

- **AC1** Reference label, 203 dpi. For `name` and for `qty`, the emitted lines are in this order:
  - both strikes, x and x+1, with no `^FR`
  - then immediately `^FO{box.x},{box.y}^FR^GB{w},{h},{h}^FS`

  `^FO166,64^GB512,54,54^FS` without `^FR` appears nowhere.
- **AC2** The reference label contains exactly 2 `^FR`, both on `^GB` lines. No `^A0` line contains `^FR`.
- **AC3** Non-reversed bold text (header, MNF, EXP) is unchanged: a double strike 1 dot apart, no `^FR`. The border is still `^FO4,4^GB804,195,3^FS`, and it stays the last element.
- **AC4** Missing values:
  - `displayName` absent: `nameBg` is emitted as `^FO166,64^GB512,54,54^FS` with no `^FR`, at its original position (right after the header lines).
  - `qtyText` absent: no `qtyBg` is emitted (`layout.js:332-334`).
- **AC5** `validateTemplate` rejects each of these, with the messages above:
  - reverse with no box
  - reverse pointing at an outline box
  - reverse pointing at a non-box slot
  - two reversed slots sharing one box

  The shipped template still validates.
- **AC6** A shrunk long name (`longNameContext`): its box line carries `^FR`, its text lines do not, and the text size is between 18 and 38.
- **AC7** Shipped template at 203, 300 and 600 dpi, with `referenceContext` and `longNameContext`. For each reversed bar, no other placed element's ink rectangles intersect the bar rectangle.
  - Ink rectangles: an outline box is its four bands of width `thickness`; any other element is `(x, y, w, h)`.
  - The reversed text inside the bar is exempt.
- **AC8 Emulator evidence** (script, run once, output committed). One context: `contextWith(...)` with every identifying value from `calibration-label.zpl`, and manufacturer replaced by a same-length made-up string. Logo line removed. Render through Labelary 8dpmm 4×1:
  - (a) `emit()` from this branch
  - (o) `emit()` from `e9e7a81`
  - (b) (a) with both `^FR` box lines removed, which gives the black strikes on white

  Within each bar rectangle:
  - IoU of white(a) against black(b) is ≥ 0.97
  - IoU of white(o) against black(b) is < 0.80, which shows the threshold separates broken from fixed

  Outside both bar rectangles, (a) and (o) are pixel-identical. Evidence goes in `docs/specs/2026-09-14-reversed-bold-text/`.
  - **Needs the human's OK before the call** (N6). Only made-up strings leave the server.
- **AC9 Hardware** (the human). Reprint the RSMSO26090053 label on the GC420t. The item name and QTY are readable white-on-black, and nothing else got worse.
- **AC10** `npm test` fully green.

## Non-goals

- The logo not being on the printer.
- The border looking cut off, which waits on the label measurement.
- The barcode quiet zone and the preview's barcode offset.
- `isReadyToPrint`, the misleading HTTPS message, darkness and print speed.
- Any preview change.

## Risks

- **Firmware ignoring `^FR` on `^GB`.** This is standard ZPL II. AC8 checks the emulator and AC9 the printer.
- **Ribbon bleed filling thin white gaps.** AC9 would show it. The remedy is darkness, which is a non-goal.
- **Glyph ink beyond the measured rectangle** (`metrics.js` is an estimate). The smallest gaps are about 4 dots (header to name bar) and 10 dots (QTY bar to MNF). AC8 shows any real overlap as a pixel difference outside the bars.

## Rollback

`git revert` the commit, push, `shdeploy sticker-engine`. No data or configuration is involved.

# Printer assets

## Logo

**The label uses `logo-lineart-bold-144.png`**, carried inline in every label as
`^GFA` (the template's `logo` slot holds its bits). It is the line-art variant
with the STANDARD HOLDINGS lettering one dot bolder, chosen after a GC420t test
print on 2026-09-15: the solid variant's white lettering filled in. Regenerate
the template data with `node scripts/write-logo-data.js assets/logo-lineart-bold-144.png`
(the bold PNG itself comes from `docs/specs/2026-09-15-label-100x25/make-bold-logo.py`).

`logo-store.zpl` holds the two original 144×144 dot variants as `~DG` download
commands, for templates that recall a stored graphic with `^XG` instead.

    cat assets/logo-store.zpl | nc 192.168.1.50 9100

| Object | Variant | Black coverage |
|---|---|---|
| `R:LOGO.GRF` | Solid navy on white — matches the current sticker | 69.9% |
| `R:LOGOKO.GRF` | Line art, white background | 8.7% |

A template with `"source": "R:LOGO.GRF"` recalls the solid one; `R:LOGOKO.GRF` the line art.

**Print one of each before deciding.** At 144 dots the white lettering in the
solid version is one to two dots wide, and thermal heat spreads sideways, so
thin white gaps inside a large black field tend to close up. The ring will look
muddier on paper than on screen, and it worsens as the printhead ages or
darkness creeps up. The knockout variant carries the same information as thin
*black* lines on white, which thermal printing handles cleanly, and uses an
eighth of the heat.

Below 144 dots the ring lettering degrades badly at any darkness: 120 is
marginal, 96 is illegible.

**`R:` is RAM and clears on power cycle.** If your model has flash, store to
`E:` instead. Either way the app should verify the object exists on connect and
re-send it if not — a missing `^XG` target prints a blank space with no error.

## Reference images

| File | What it is |
|---|---|
| `label-mockup-203dpi.png` | The original 4×1 in reference label at 812×203 dots (the stock is now 100×25 mm, 800×200) |
| `layout-stress-tests.png` | Three cases: normal, long product name, missing document number |

Both are 1-bit renderings at true dot size — what the printhead actually fires,
not an anti-aliased preview.

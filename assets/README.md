# Printer assets

## Logo

`logo-store.zpl` holds two 144×144 dot variants of the Standard Holdings mark as
`~DG` download commands. Send the file to a printer **once** — the graphic then
lives in printer memory and every label recalls it with a two-byte `^XG`
instead of re-sending 2.6 KB of bitmap per label.

    cat assets/logo-store.zpl | nc 192.168.1.50 9100

| Object | Variant | Black coverage |
|---|---|---|
| `R:LOGO.GRF` | Solid navy on white — matches the current sticker | 69.9% |
| `R:LOGOKO.GRF` | Line art, white background | 8.7% |

The template recalls `R:LOGO.GRF`. Point it at `R:LOGOKO.GRF` to switch.

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
| `label-mockup-203dpi.png` | The reference label at exact 812×203 dot dimensions |
| `layout-stress-tests.png` | Three cases: normal, long product name, missing document number |

Both are 1-bit renderings at true dot size — what the printhead actually fires,
not an anti-aliased preview.

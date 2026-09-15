# Evidence for the 100×25 mm label, 2026-09-15

| File | What it is |
|---|---|
| `make-bold-logo.py` | Makes `assets/logo-lineart-bold-144.png` (lettering one dot bolder). Run from the repo root. |
| `proto.mjs` | The geometry prototype, which changed the template in memory before the spec was written. |
| `evidence.mjs`, `measure.py` | AC9. Emits a made-up label from this tree, swaps the logo for an outline box, renders it through Labelary (8dpmm, 3.937×0.984 in) and measures it. |
| `made.zpl/.png`, `madeLong.zpl/.png` | Labelary input and output. Every value is made up, and the company mark was never sent. |
| `logo-local.png` | The template's logo hex rendered **locally** (4×), for looking at. |
| `ac9-overview.png` | `made.png` next to the logo. |
| `measurements.txt` | Results. |

AC9 results (a dot is black when its grey value is below 128):

| Check | Need | made | madeLong |
|---|---|---|---|
| Ink in the outer 12 dots, border excluded | 0 | **0** | **0** |
| Clear space between MNF/EXP ink and the first bar | ≥ 20 | **27** | **27** |

A real-browser smoke check against the dev instance (`node test/browser/smoke.mjs "/root/Sticker gen/PKG-146468.PDF"`) showed the preview at `800×200 dots`, "No layout problems on this label", and no console errors or failed requests.

AC10 (10 consecutive labels on the GC420t) is the human's.

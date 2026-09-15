# AC8 emulator evidence, 2026-09-14

Source: Labelary `POST https://api.labelary.com/v1/printers/8dpmm/labels/4x1/0/`, 203 dpi.
Emulator evidence only; AC9 (a real GC420t print) confirms it on hardware.
The human approved the call on 2026-09-14. Every value on the label is made up. The logo recall line was removed.

`emit.mjs` builds one made-up context and emits it from two trees: this fix, and `e9e7a81` extracted with `git archive`. It writes:

| File | What it is |
|---|---|
| `a-fixed.zpl` / `.png` | Emitted by this fix |
| `o-before.zpl` / `.png` | Emitted by `e9e7a81`, which was live when the fix was made |
| `b-strikes-only.zpl` / `.png` | `a` with both `^FR` bar lines removed: the bold strikes in black on white |
| `bars.json` | The two bar rectangles, from the placed layout |
| `before-after.png` | `o` above `a`, at 2× scale |

`measurements.txt`: a dot is black when its grey value is below 128.

| Check | Need | Result |
|---|---|---|
| nameBg: IoU of white(a) with black(b) | ≥ 0.97 | **1.0000** |
| qtyBg: IoU of white(a) with black(b) | ≥ 0.97 | **1.0000** |
| nameBg: IoU of white(o) with black(b) | < 0.80 | 0.0933 |
| qtyBg: IoU of white(o) with black(b) | < 0.80 | 0.1193 |
| Dots differing between a and o outside both bars | 0 | **0** |

In `a`, the white dots inside each bar are exactly the bold strike shape. The name bar's ink ratio in `o` is 0.961, which matches finding Q2 in `../2026-09-13-calibration/README.md`, so the "before" render reproduces the known bug.

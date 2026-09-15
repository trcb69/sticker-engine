"""Make assets/logo-lineart-bold-144.png from assets/logo-knockout-144.png.

Every black dot inside the lettering ring (51.5 < r < 65.5 about the centre)
also blackens the dot to its right, so STANDARD HOLDINGS reads one dot bolder.
Circles and the SH mark are untouched. Run from the repo root.
"""
import math
from PIL import Image

src = Image.open('assets/logo-knockout-144.png').convert('L').point(lambda v: 0 if v < 128 else 255)
W, H = src.size
cx, cy = (W - 1) / 2, (H - 1) / 2
inside = lambda x, y: 51.5 < math.hypot(x - cx, y - cy) < 65.5
out = src.copy()
s, o = src.load(), out.load()
for y in range(H):
    for x in range(W - 1):
        if s[x, y] == 0 and inside(x, y) and inside(x + 1, y):
            o[x + 1, y] = 0
out.convert('1', dither=Image.NONE).save('assets/logo-lineart-bold-144.png')

import json
from PIL import Image
meta = json.load(open('meta.json'))
out = []
for name in ('made', 'madeLong'):
    im = Image.open(f'{name}.png').convert('L'); W, H = im.size; px = im.load()
    black = lambda x, y: px[x, y] < 128
    # Border is x 12..786, y 12..187, 2 dots thick: its dots are the only ink allowed in the outer 12.
    stray = [(x, y) for y in range(H) for x in range(W) if black(x, y) and (x < 12 or y < 12 or x >= 788 or y >= 188)]
    m = meta[name]; b = m['batch']
    # MNF/EXP ink right edge, measured in the rows those lines occupy.
    rows = range(m['mnf']['y'], m['exp']['y'] + m['exp']['h'])
    text_right = max(x for y in rows for x in range(m['mnf']['x'], b['x'] + b['quietZone']) if black(x, y))
    first_bar = min(x for y in range(b['y'] + 2, b['y'] + 30) for x in range(b['x'], W - 12) if black(x, y))
    out.append(f"{name}: ink outside the 12-dot margin: {len(stray)} (need 0); {W}x{H}; "
               f"MNF/EXP ink ends x={text_right}, first bar x={first_bar}, gap={first_bar - text_right - 1} (need >= 20)")
rows = open('logo-rows.txt').read().split()
logo = Image.new('L', (144, 144), 255); lp = logo.load()
for y, r in enumerate(rows):
    bits = bin(int(r, 16))[2:].zfill(len(r) * 4)
    for x in range(144):
        if bits[x] == '1': lp[x, y] = 0
logo.resize((576, 576), Image.NEAREST).save('logo-local.png')
open('measurements.txt', 'w').write('\n'.join(out) + '\n'); print('\n'.join(out))

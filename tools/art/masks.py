# Paint masks for liveries: for each aircraft, where the tail, the fuselage and
# the engines can be seen (what lies in front of them is taken out), aligned
# with its game picture. Saved as one PNG: red = tail, green = fuselage,
# blue = engines.
import sys, os, json, re
sys.path.insert(0, '.')
import numpy as np
from PIL import Image
from standard import get, classify, tight
from kit import render

OUT = 'out/mask'
os.makedirs(OUT, exist_ok=True)
PAINT = {'TAIL': 0, 'FUSELAGE': 1, 'ENGINES': 2}


def masks(i, width=640, out=None, ret=None):
    W, H, ls = ret if ret else get(i)
    im = render(W, H, ls)
    tb = tight(im)
    cw, ch = tb[2] - tb[0], tb[3] - tb[1]
    cov = np.zeros((3, ch, cw), np.float32)
    for l in ls:
        if l.part is None or not l.visible:
            continue
        g, r = classify(l)
        a = np.zeros((ch, cw), np.float32)
        x0, y0 = l.x - tb[0], l.y - tb[1]
        pa = np.asarray(l.part.getchannel('A'), np.float32) / 255
        sx0, sy0 = max(0, -x0), max(0, -y0)
        dx0, dy0 = max(0, x0), max(0, y0)
        w = min(pa.shape[1] - sx0, cw - dx0)
        h = min(pa.shape[0] - sy0, ch - dy0)
        if w <= 0 or h <= 0:
            continue
        a[dy0:dy0 + h, dx0:dx0 + w] = pa[sy0:sy0 + h, sx0:sx0 + w]
        if r == 'BASE':
            # a paintable surface covers whatever was painted below it
            for k in range(3):
                cov[k] *= (1 - a)
            if g in PAINT and not re.search(r'prop|blade|spinner|exhaust|nozzle|core|cone', l.path, re.I):
                cov[PAINT[g]] = np.maximum(cov[PAINT[g]], a)
    rgb = (np.clip(cov, 0, 1) * 255).astype(np.uint8).transpose(1, 2, 0)
    m = Image.fromarray(rgb, 'RGB')
    h = round(ch * width / cw)
    m = m.resize((width, h), Image.LANCZOS)
    o = out or OUT
    m.save(f'{o}/{i}.png', optimize=True)
    return dict(id=i, h=h, kb=os.path.getsize(f'{o}/{i}.png') // 1024)


if __name__ == '__main__':
    from config import C
    from builds2 import BUILDS2
    ids = sys.argv[1:] or list(C) + list(BUILDS2)
    for i in ids:
        try:
            print(json.dumps(masks(i)), flush=True)
        except Exception as e:
            import traceback; traceback.print_exc()
            print(json.dumps(dict(id=i, error=str(e)[:200])), flush=True)

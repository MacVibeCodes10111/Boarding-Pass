# Paint masks for liveries: for each aircraft, where each paintable part can be
# seen (what lies in front of it is taken out), aligned with its game picture.
# Saved as one PNG twice the picture's height: the top half red = tail (fin),
# green = fuselage, blue = engines; the bottom half red = wings, green =
# winglets / wingtips, blue = horizontal stabilisers.
import sys, os, json, re
sys.path.insert(0, '.')
import numpy as np
from PIL import Image
from standard import get, classify, tight, R_FX
from kit import render

OUT = 'out/mask'
os.makedirs(OUT, exist_ok=True)
PAINT = {'TAIL': 0, 'FUSELAGE': 1, 'ENGINES': 2, 'WINGS': 3, 'WINGLETS': 4, 'STAB': 5}
R_WINGLET = re.compile(r'winglet|sharklet|scimitar|wing ?tip|wingtip|raked|blended', re.I)
R_STAB = re.compile(r'stab|horizontal|elevator|tailplane', re.I)


def part_of(l, g, rear=False, cw=1):
    if g != 'WINGS':
        return g
    name = l.path.split('/')[-1]
    # a winglet by its own name, and small (a whole wing in a 'winglets' group isn't one)
    if R_WINGLET.search(name) and l.part.width < 0.12 * cw:
        return 'WINGLETS'
    # tailplanes: by name, or any wing part on the last quarter of the aircraft
    if R_STAB.search(name) or R_STAB.search(l.path) or rear:
        return 'STAB'
    return 'WINGS'


def soft(pa):
    """Mostly see-through: shading or a highlight, not a surface."""
    on = pa > 0.02
    return on.any() and (pa[on] > 0.9).mean() < 0.5


def masks(i, width=640, out=None, ret=None):
    W, H, ls = ret if ret else get(i)
    im = render(W, H, ls)
    tb = tight(im)
    cw, ch = tb[2] - tb[0], tb[3] - tb[1]
    cov = np.zeros((6, ch, cw), np.float32)
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
        if r == 'BASE' and (l.blend != 'NORMAL' or R_FX.search(l.name) or soft(pa)):
            continue  # shading the classifier took for a surface: it neither paints nor covers
        if r == 'BASE':
            # a paintable surface covers whatever was painted below it
            for k in range(6):
                cov[k] *= (1 - a)
            p = part_of(l, g, cw=cw)
            if p in PAINT and not re.search(r'prop|blade|spinner|exhaust|nozzle|core|cone', l.path, re.I):
                cov[PAINT[p]] = np.maximum(cov[PAINT[p]], a)
    # wing layers often hold the tailplane too: wing paint on the last quarter is the tailplane
    rear = int(cw * 0.76)
    for k in (3, 4):
        cov[5][:, rear:] = np.maximum(cov[5][:, rear:], cov[k][:, rear:])
        cov[k][:, rear:] = 0
    # some templates draw the tailplane in the tail layer: tail paint below the fuselage's top edge is the tailplane
    if (cov[5] > 0.5).sum() < 20:
        top = np.full(cw, -1)
        fus = cov[1] > 0.5
        cols = np.where(fus.any(axis=0))[0]
        for x in cols:
            top[x] = np.argmax(fus[:, x])
        if len(cols):
            last = cols[-1]
            top[last + 1:] = top[last]
            ys = np.arange(ch)[:, None]
            low = (ys > top[None, :] + 3) & (top[None, :] >= 0)
            low[:, : int(cw * 0.6)] = False
            moved = np.where(low, cov[0], 0)
            cov[5] = np.maximum(cov[5], moved)
            cov[0] = np.where(low, 0, cov[0])
    # one layer for the whole body (no tail layer): the fin is the body above the roof line at the back
    if (cov[0] > 0.5).sum() < 0.01 * (cov[1] > 0.5).sum():
        fus = cov[1] > 0.5
        xs = np.arange(cw)
        top = np.array([np.argmax(fus[:, x]) if fus[:, x].any() else -1 for x in xs])
        mid = (xs > cw * 0.2) & (xs < cw * 0.55) & (top >= 0)
        if mid.sum() > 10:
            b, a0 = np.polyfit(xs[mid], top[mid], 1)
            roof = a0 + b * xs
            bot = np.array([fus.shape[0] - 1 - np.argmax(fus[::-1, x]) for x in xs[mid]])
            hc = float(np.median(bot - top[mid]))
            ys = np.arange(ch)[:, None]
            # a third of the body's height above the roof line, so an upswept rear fuselage stays fuselage
            # and from where the top edge climbs steeply (the fin's leading edge)
            steep = np.where((xs > cw * 0.55) & (top >= 0) & (top < roof - hc * 0.8))[0]
            x_f = (steep.min() - cw * 0.02) if len(steep) else cw * 0.55
            fin = (ys < roof[None, :] - max(2, hc * 0.33)) & (xs[None, :] > max(cw * 0.55, x_f))
            cov[0] = np.maximum(cov[0], np.where(fin, cov[1], 0))
            cov[1] = np.where(fin, 0, cov[1])
    h = round(ch * width / cw)
    halves = []
    for k in (0, 3):
        rgb = (np.clip(cov[k:k + 3], 0, 1) * 255).astype(np.uint8).transpose(1, 2, 0)
        halves.append(Image.fromarray(rgb, 'RGB').resize((width, h), Image.LANCZOS))
    m = Image.new('RGB', (width, h * 2))
    m.paste(halves[0], (0, 0))
    m.paste(halves[1], (0, h))
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

# Winglets for aircraft whose templates don't name them (v2.71): in these side
# views a winglet, sharklet or wingtip fence is where the wing's top edge
# climbs steeply at its outer end. Edits the paint masks in place (top half:
# tail, fuselage, engines; bottom half: wings, wingtips, tailplane), so they
# stay aligned with the pictures. Only types that really have
# winglets or wingtip fences are listed.
#   python3 winglets.py [public/aircraft]
import sys, os
import numpy as np
from PIL import Image

WINGLETS = ['a318-100', 'a319-100', 'a320-200', 'a321-100', 'a321-200', 'a320-p2f', 'a321-p2f', 'a300-600r', 'a300-600f',
            'a310-300', 'a380-800', 'crj-200', 'crj-550', 'crj-700', 'crj-705', 'crj-900', 'crj-1000',
            'comac-c919', 'comac-c919-std', 'tu-204-100', 'tu-204c', 'tu-214']
# Types without winglets whose templates have a 'wingtip' paint layer: no wingtip part for them
NO_WINGLETS = ['a220-100', 'a220-300', 'an-12bk', 'an-24rv', 'an-124-100', 'il-76td-90', 'sj-100', 'c208b-ex', 'c208b-cargo', 'xian-ma60']


def clear(path):
    m = np.asarray(Image.open(path).convert('RGB')).copy()
    h = m.shape[0] // 2
    bot = m[h:]
    bot[..., 0] = np.maximum(bot[..., 0], bot[..., 1])
    bot[..., 1] = 0
    Image.fromarray(m, 'RGB').save(path, optimize=True)
    return 'no winglets'


def fix(path, i):
    m = np.asarray(Image.open(path).convert('RGB')).astype(np.int16).copy()
    h, w = m.shape[0] // 2, m.shape[1]
    top, bot = m[:h], m[h:]
    if (bot[..., 1] > 100).sum() > 20:
        return 'has winglets'
    wing = bot[..., 0] > 60
    wx = np.where(wing.any(axis=0))[0]
    if len(wx) < 20:
        return 'no wing'
    x0w, x1w = wx.min(), wx.max()
    xs = np.arange(w)
    topw = np.array([np.argmax(wing[:, x]) if wing[:, x].any() else -1 for x in xs])
    # the wing's top edge along its middle, and how far it climbs at the tip
    mid = (xs > x0w + (x1w - x0w) * 0.25) & (xs < x0w + (x1w - x0w) * 0.7) & (topw >= 0)
    b, a0 = np.polyfit(xs[mid], topw[mid], 1)
    line = a0 + b * xs
    span = float(np.median([wing.shape[0] - 1 - np.argmax(wing[::-1, x]) - topw[x] for x in xs[mid]]))  # the wing's depth on screen
    rise = max(3.0, span * 0.35)
    outer = xs > x0w + (x1w - x0w) * 0.7
    cols = np.where(outer & (topw >= 0) & (topw < line - rise))[0]
    ys = np.arange(h)[:, None]
    band = np.zeros_like(wing)
    if len(cols):
        band[:, cols.min() - 1:cols.max() + 2] = True
        # the winglet: what stands above the wing's top edge at the tip
        tip = wing & band & (ys < line[None, :] - 1)
        kind = 'winglet'
    else:
        # a small wingtip fence: the outer end of the wing
        band[:, int(x1w - (x1w - x0w) * 0.08):] = True
        tip = wing & band
        kind = 'wingtip'
    bot[..., 1] = np.where(tip, bot[..., 0], bot[..., 1])
    bot[..., 0] = np.where(tip, 0, bot[..., 0])
    Image.fromarray(np.clip(m, 0, 255).astype(np.uint8), 'RGB').save(path, optimize=True)
    return f'{kind} {int(tip.sum())} px'


if __name__ == '__main__':
    d = sys.argv[1] if len(sys.argv) > 1 else '../../public/aircraft'
    for i in WINGLETS:
        print(i, fix(f'{d}/{i}.mask.png', i))
    for i in NO_WINGLETS:
        print(i, clear(f'{d}/{i}.mask.png'))

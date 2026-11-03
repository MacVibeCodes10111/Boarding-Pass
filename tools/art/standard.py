# Standard templates: every aircraft as one Photoshop file laid out the same way,
# plus the picture the game shows.
#   Canvas: 8:3, plane centred, 4% margin each side, transparent background.
#   Groups (bottom to top): TAIL, FUSELAGE, WINGS, ENGINES, DETAILS.
#   Inside each: BASE (the paintable surface), DETAILS (lines), then
#   DOORS & WINDOWS (fuselage only), then EFFECTS (shading). Gear up, white.
import os, re, sys, json, hashlib
sys.path.insert(0, '.')
import numpy as np
from PIL import Image, ImageChops
from psd_tools import PSDImage
from psd_tools.constants import BlendMode
from kit import *
from builds import BUILDS
from builds2 import BUILDS2
from config import C, HIDE_EXTRA, BY

OUT = os.environ.get('ART_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out'))
GROUPS = ['ANTENNAS', 'TAIL', 'FUSELAGE', 'WINGS', 'ENGINES', 'DETAILS']
ROLES = ['BASE', 'DETAILS', 'DOORS & WINDOWS', 'EFFECTS']

R_PART = [
    ('ENGINES', r'engine|exhaust|nacelle|cowl|spinner|prop|blade|intake|inlet|pylon|reverser|nozzle|\bps90\b|\bcfm\b|\biae\b|\bleap\b|\bpw\b|\bge\b|\brr\b'),
    ('ANTENNAS', r'antenna|strobe|light|beacon'),
    ('DETAILS', r'probe|pitot|tailskid|vortex|satcom|wiper|cam\b|static'),
    ('DOORS', r'door|window|cockpit|visor|eyebrow|bandit|raccoon|porte|exit|config|glass'),
    ('TAIL', r'(?<!de)tail(?!skid| ?cone)|^fins?\b|rudder|vertical|\bfin\b'),
    ('WINGS', r'wing|winglet|sharklet|scimitar|fence|flap|aileron|slat|elevator|stab|h[ -]?stab|horizontal|surfaces|rake|fairing|leading edge'),
    ('FUSELAGE', r'fuselage|body|nose|radome|belly|cargo|metal|dirt|details?$|effects?$'),
]
R_ROLE = [('EFFECTS', r'effect|shad|highlight|shine|reflect|dirt|glow'), ('DETAILS', r'detail|line|panel|rivet|stripe|text|mark')]


def classify(l):
    names = l.path.split('/')
    part = None
    for n in reversed(names):          # the layer's own name first, then its groups
        for g, rx in R_PART:
            if re.search(rx, n, re.I):
                part = g
                break
        if part: break
    part = part or 'FUSELAGE'
    role = 'BASE'
    for r, rx in R_ROLE:
        if re.search(rx, names[-1], re.I):
            role = r
            break
    if part == 'DOORS':
        return 'FUSELAGE', 'DOORS & WINDOWS'
    return part, role


def canonical(ls):
    """The standard group order, as far as it can go without changing the look:
    two layers keep their original order whenever they overlap."""
    n = len(ls)
    rank = []
    for l in ls:
        g, r = classify(l)
        rank.append(GROUPS.index(g) * 10 + ROLES.index(r))
    boxes, masks = [], []
    for l in ls:
        if l.part is None:
            boxes.append(None); masks.append(None); continue
        boxes.append((l.x, l.y, l.x + l.part.width, l.y + l.part.height))
        masks.append(np.asarray(l.part.getchannel('A')) > 8)
    def overlap(i, j):
        a, b = boxes[i], boxes[j]
        if a is None or b is None: return False
        x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
        if x0 >= x1 or y0 >= y1: return False
        ma = masks[i][y0 - a[1]:y1 - a[1], x0 - a[0]:x1 - a[0]]
        mb = masks[j][y0 - b[1]:y1 - b[1], x0 - b[0]:x1 - b[0]]
        return bool((ma & mb).any())
    before = [set() for _ in range(n)]       # before[j]: layers that must stay below j
    for i in range(n):
        for j in range(i + 1, n):
            if overlap(i, j):
                before[j].add(i)
    # Kahn's algorithm, lowest rank first, original position as tie-break.
    # Only pairs that would swap need a constraint: others keep the order either way
    # once ranks are sorted, except equal ranks, which keep the original order.
    done, order = set(), []
    left = list(range(n))
    while left:
        ready = [k for k in left if before[k] <= done]
        k = min(ready, key=lambda k: (rank[k], k))
        # a layer may not jump above an overlapping layer that came after it and ranks higher
        order.append(k); done.add(k); left.remove(k)
    out = []
    for k in order:
        g, r = classify(ls[k])
        out.append((g, r, ls[k]))
    return out


def diff(a, b):
    x = np.asarray(a, dtype=np.int16)
    y = np.asarray(b, dtype=np.int16)
    m = (x[..., 3] > 0) | (y[..., 3] > 0)
    d = np.abs(x - y).max(axis=-1)
    return float((d[m] > 24).mean()) if m.any() else 0.0


def get(i):
    if i in BUILDS2:
        return BUILDS2[i]()
    v = C[i]
    if 'build' in v:
        fn = BUILDS[v['build']]
        return fn(v['base']) if 'base' in v else fn()
    W, H, ls = load(v['src'], v.get('show', ()), list(v.get('hide', ())) + HIDE_EXTRA.get(v['src'], []), keep_gear=v.get('gear', False))
    if 'BCF_V2' in v['src']:
        # its fuselage shading spills past the fuselage: clip it to the fuselage
        fus = find(ls, r'^FUSELAGE/FUSELAGE$')[0].img.getchannel('A')
        ls = [l.copy(Image.merge('RGBA', l.img.split()[:3] + (ImageChops.multiply(l.img.getchannel('A'), fus),))) if re.search(r'^FUSELAGE/Effects/', l.path) else l for l in ls]
    return W, H, ls


def tight(im):
    a = np.asarray(im.getchannel('A'))
    ys, xs = np.where(a > 24)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def frame(W, H, ls, b=None):
    b = b or bbox(ls)
    bw, bh = b[2] - b[0], b[3] - b[1]
    cw = round(bw / 0.92)
    ch = max(round(cw * 3 / 8), round(bh / 0.9))
    ox = (cw - bw) // 2 - b[0]
    oy = (ch - bh) // 2 - b[1]
    return cw, ch, ox, oy


def standardise(i, name, psd_path, img_path, width=640):
    W, H, ls = get(i)
    orig = render(W, H, ls)
    tb = tight(orig)
    cw, ch, ox, oy = frame(W, H, ls, tb)
    order = canonical(ls)
    test = render(W, H, [l for _, _, l in order])
    d = diff(orig, test)
    keep_order = d > 0.004            # re-ordering changed the look: keep the template's order
    if keep_order:
        order = [(classify(l)[0], classify(l)[1], l) for l in ls]
    # merge consecutive layers with the same group, role and blend
    merged = []
    for g, r, l in order:
        if merged and merged[-1][0] == g and merged[-1][1] == r and merged[-1][2].blend == l.blend == 'NORMAL':
            im = merged[-1][2].img
            im.alpha_composite(l.img)
            merged[-1] = (g, r, merged[-1][2].copy(im))
        else:
            merged.append((g, r, l))
    # Photoshop file
    psd = PSDImage.new('RGBA', (cw, ch))
    groups = []
    run = []
    for k, (g, r, l) in enumerate(merged):
        if l.part is None: continue
        bm = getattr(BlendMode, l.blend, BlendMode.NORMAL)
        lay = psd.create_pixel_layer(l.part, name=r if r != 'BASE' else 'BASE', top=l.y + oy, left=l.x + ox, blend_mode=bm)
        run.append((g, lay))
    # group consecutive runs
    cur, members = None, []
    for g, lay in run + [(None, None)]:
        if g != cur and members:
            psd.create_group(layer_list=members, name=cur)
            members = []
        cur = g
        if lay is not None:
            members.append(lay)
    os.makedirs(os.path.dirname(psd_path), exist_ok=True)
    psd.save(psd_path)
    # game picture
    pic = orig.crop(tb)
    h = round(pic.height * width / pic.width)
    pic = pic.resize((width, h), Image.LANCZOS)
    os.makedirs(os.path.dirname(img_path), exist_ok=True)
    pic.save(img_path, 'WEBP', quality=82, method=6)
    return dict(id=i, reordered=not keep_order, diff=round(d, 4), w=width, h=h, kb=os.path.getsize(img_path) // 1024)


if __name__ == '__main__':
    sys.path.insert(0, '.')
    names = dict(l.split('\t') for l in open('ours.tsv').read().strip().split('\n'))
    ids = sys.argv[1:] or list(C) + list(BUILDS2)
    rep = []
    for i in ids:
        try:
            r = standardise(i, names[i], f'{OUT}/psd/{names[i]}.psd', f'{OUT}/img/{i}.webp')
        except Exception as e:
            import traceback; traceback.print_exc()
            r = dict(id=i, error=str(e)[:200])
        print(json.dumps(r), flush=True)
        rep.append(r)
    json.dump(rep, open(f'{OUT}/report-{os.getpid()}.json', 'w'))

# Aircraft with no template of their own, built from parts of the closest
# real templates (so they keep the artists' shading): stretched, shortened,
# scaled, with engines swapped or added.
import sys
sys.path.insert(0, '.')
from builds import *
from PIL import ImageDraw

P = lambda v: v + PAD


def plane_box(ls):
    return bbox(ls)


def ppm(ls, length_m):
    b = bbox([l for l in ls if re.search(r'fuselage|body', l.path, re.I)] or ls)
    return (b[2] - b[0]) / length_m


def pitch_of(ls, rx):
    sel = find(ls, rx)
    if not sel: return 1
    a = np.asarray(sel[0].img.getchannel('A'))
    cols = (a > 40).any(axis=0)
    starts = [i for i in range(1, len(cols)) if cols[i] and not cols[i - 1]]
    d = np.diff(starts)
    d = d[(d > 5) & (d < 200)]
    return int(np.median(d)) if len(d) else 1


def body(ls, x, w, keep, rx_win=None, fixed=None, src=None):
    """Plug (w > 0) or cut (w < 0) w px at template x. keep='right': the nose moves;
    keep='left': the tail moves. Layers matching `fixed` are left alone."""
    if rx_win:
        x = win_gap(ls, rx_win, x) - PAD
    X = P(x)
    out = []
    for l in ls:
        if fixed and re.search(fixed, l.path, re.I):
            out.append(l); continue
        im = l.img
        if w > 0:
            im = plug(im, X, w, keep=keep, src=None if src is None else P(src))
        else:
            im = cut(im, X + w, X, keep='right') if keep == 'right' else cut(im, X, X - w, keep='left')
        out.append(l.copy(im))
    return out


def scale_all(ls, f):
    """Scale the whole plane (canvas too)."""
    W, H = CANVAS
    CANVAS[0], CANVAS[1] = int(W * f), int(H * f)
    out = []
    for l in ls:
        if l.part is None: out.append(l); continue
        p = l.part.resize((max(1, round(l.part.width * f)), max(1, round(l.part.height * f))), Image.LANCZOS)
        n = L(l.name, l.path, p, l.blend, l.visible, round(l.x * f), round(l.y * f))
        out.append(n)
    return CANVAS[0], CANVAS[1], out


def moved(ls, dx, dy=0):
    return [L(l.name, l.path, l.part, l.blend, l.visible, l.x + dx, l.y + dy) for l in ls if l.part is not None]


def scaled(ls, f, ax, ay, bx, by):
    """Layers scaled by f about canvas point (ax, ay) and moved so that point lands on (bx, by)."""
    out = []
    for l in ls:
        if l.part is None: continue
        p = l.part.resize((max(1, round(l.part.width * f)), max(1, round(l.part.height * f))), Image.LANCZOS)
        out.append(L(l.name, l.path, p, l.blend, l.visible, round(bx + (l.x - ax) * f), round(by + (l.y - ay) * f)))
    return out


def centre(ls, rx):
    b = bbox(find(ls, rx))
    return (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b


def glazed_nose(ls, box, name='NAVIGATOR GLAZING'):
    """A glazed navigator's nose (An-12, An-24, Il-76): dark glass panes over the nose (template px box)."""
    x0, y0, x1, y1 = [P(v) for v in box]
    W, H = CANVAS
    m = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(m)
    d.polygon([(x0, y1 - (y1 - y0) * 0.15), (x0 + (x1 - x0) * 0.18, y0), (x1, y0 + (y1 - y0) * 0.05), (x1 - (x1 - x0) * 0.08, y1)], fill=255)
    fus = find(ls, r'fuselage(_base)?$|^FUSELAGE$|FUSELAGE/FUSELAGE')
    if fus:
        m = ImageChops.multiply(m, fus[0].img.getchannel('A'))
    glass = Image.new('RGBA', (W, H), (52, 66, 82, 0)); glass.putalpha(m.point(lambda v: v * 215 // 255))
    # pane frames
    fr = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(fr)
    for k in (0.35, 0.65):
        xx = x0 + (x1 - x0) * k
        dr.line([(xx, y0), (xx - (x1 - x0) * 0.1, y1)], fill=255, width=max(2, (x1 - x0) // 60))
    dr.line([(x0 + (x1 - x0) * 0.1, (y0 + y1) / 2), (x1, (y0 + y1) / 2)], fill=255, width=max(2, (x1 - x0) // 60))
    fr = ImageChops.multiply(fr, m)
    frames = Image.new('RGBA', (W, H), (225, 228, 232, 0)); frames.putalpha(fr)
    glass.alpha_composite(frames)
    hi = Image.new('L', (W, H), 0)
    ImageDraw.Draw(hi).polygon([(x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.1), (x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.06), (x0 + (x1 - x0) * 0.3, y0 + (y1 - y0) * 0.45)], fill=60)
    hi = ImageChops.multiply(hi, m)
    h2 = Image.new('RGBA', (W, H), (255, 255, 255, 0)); h2.putalpha(hi)
    glass.alpha_composite(h2)
    return L(name, name, None).copy(glass)


def extra_engines(ls, rx, dx, dy, f=1.0):
    """A second engine on each side for four-engine types: a copy of the engine
    layers, a little further back and up, drawn behind the first one."""
    eng = find(ls, rx)
    cx, cy, b = centre(ls, rx)
    copy = scaled(eng, f, cx, cy, cx + dx, cy + dy)
    first = min(i for i, l in enumerate(ls) if re.search(rx, l.path, re.I))
    return ls[:first] + copy + ls[first:]


# ---------------------------------------------------------------------------
NOT_WE = r'wing|winglet|engine|blade|prop|spinner|pylon|exhaust|flap|gear|wheel|tire'


def a220(target):
    W, H, ls = load('E195-E2.psd')
    k = ppm(ls, 41.5)
    p = pitch_of(ls, r'^DOORS/WINDOWS$')
    cut_px = round((41.5 - target) * k / p) * p
    f = (cut_px // 2) // p * p
    ls = body(ls, 430, -f, 'right', r'^DOORS/WINDOWS$')
    ls = body(ls, 1120, -(cut_px - f), 'left', r'^DOORS/WINDOWS$')
    return W, H, ls


def c919():
    W, H, ls = load('Airbus A320neo.psd')
    k = ppm(ls, 37.57)
    p = pitch_of(ls, r'^DOORS & WINDOWS$')
    w = max(p, round(1.33 * k / p) * p)
    ls = body(ls, 600, w // 2 // p * p or p, 'right', r'^DOORS & WINDOWS$')
    rest = w - (w // 2 // p * p or p)
    if rest > 0:
        ls = body(ls, 1320, rest, 'left', r'^DOORS & WINDOWS$')
    return W, H, ls


def mc21():
    W, H, ls = load('NEW A321 & A321neo.psd', [r'^NEO PW'], [r'^CEO IAE', r'SHARKLET'])
    k = ppm(ls, 44.51)
    rx = r'DOORS & WINDOWS \(A\)'
    p = pitch_of(ls, rx)
    cut_px = round(2.21 * k / p) * p
    f = cut_px // 2 // p * p
    ls = body(ls, 560, -f, 'right', rx)
    ls = body(ls, 1420, -(cut_px - f), 'left', rx)
    return W, H, ls


def c909(cargo=False):
    W, H, ls = load('McDonnell Douglas MD-87.psd')
    _, _, C = load('Bombardier CRJ-900.psd')
    CANVAS[0], CANVAS[1] = W, H
    k = ppm(ls, 39.75)
    p = pitch_of(ls, r'^WINDOW$')
    cut_px = round(6.29 * k / p) * p
    ls = body(ls, 680, -cut_px, 'right', r'^WINDOW$')
    # CF34-10A engines (CRJ-900's CF34-8C, 10% larger) in place of the JT8Ds
    mx, my, mb = centre(ls, r'^ENGINE/ENGINE$')
    cx, cy, cb = centre(C, r'^ENGINE/ENGINE$')
    f = (mb[3] - mb[1]) / (cb[3] - cb[1]) * 0.98
    eng = scaled(find(C, r'^ENGINE/'), f, cb[0], cy, mb[0] + (mb[2] - mb[0]) * 0.08, my)
    ls = [l for l in ls if not l.path.startswith('ENGINE/')] + eng
    if cargo:
        _, _, B = load('e0d57353-Boeing_737-800BCF_V2.0.psd')
        CANVAS[0], CANVAS[1] = W, H
        ls = freighter(ls, r'^WINDOW$', 30)
        fus = find(ls, r'^FUSELAGE$')[0]
        g = 150 / 162
        door1 = find(ls, r'^DOOR$')[0]
        at = (door1.x - PAD + round(70 * g), fus.y - PAD + round(8 * g))
        door = patch(B, r'FUSELAGE/BCF Door$', (613, 426, 772, 531), g, at, 'CARGO DOOR')
        sill = patch(B, r'FUSELAGE/Cargo Door detail option$', (618, 515, 767, 531), g, (at[0] + round(5 * g), at[1] + round(89 * g)), 'CARGO DOOR DETAILS')
        ls = clear_box(ls, r'^WINDOW$', (at[0] - 2, 0, at[0] + round(159 * g) + 2, 712))
        ls = insert_after(ls, r'^WINDOW$', [door, sill])
    return W, H, ls


def j31(target_len, scale=1.0, plug_m=0.0, cargo=False):
    W, H, ls = load('13f04f98-British_Aerospace_Jetstream_31.psd', hide=[r'^Layer 4$'])
    if scale != 1.0:
        W, H, ls = scale_all(ls, scale)
    if plug_m:
        k = ppm(ls, 14.37 * scale)
        w = round(plug_m * k)
        f = w // 2
        ls = body(ls, round(1150 * scale), w, 'left', fixed=NOT_WE, src=round(905 * scale))
    if cargo:
        ls = freighter(ls, r'DETAILS/WINDOWS$', 60)
    return W, H, ls


def dhc6(target, gear):
    W, H, ls = load('De Havilland Canada DHC-6.psd', keep_gear=gear)
    k = ppm(ls, 15.77)
    w = round((target - 15.77) * k)
    if w:
        # the high wing stays; the cabin and tail stretch behind it
        ls = body(ls, 470, w, 'left', fixed=r'^Wing|^Engine|^Prop|TIRE')
    return W, H, ls


def p2012():
    W, H, ls = load('Britten-Norman BN-2 Islander.psd', keep_gear=True)
    k = ppm(ls, 10.86)
    w = round(0.94 * k)
    return W, H, body(ls, 440, w, 'left', fixed=r'^WING SET/(?!ELEVATOR)|^ENGINE SET|TIRES|LANDING GEAR')


def metro(cargo=False):
    W, H, ls = load('British Aerospace Jestream 41.psd')
    k = ppm(ls, 19.25)
    p = pitch_of(ls, r'^DOORS & WINDOWS$')
    w = max(p, round(1.16 * k / p) * p)
    ls = body(ls, 585, -w, 'left', r'^DOORS & WINDOWS$')
    if cargo:
        ls = freighter(ls, r'^DOORS & WINDOWS$', 26)
    return W, H, ls


def f27(target, glazed=False):
    W, H, ls = load('Fokker27.psd')
    k = ppm(ls, 25.06)
    w = round((target - 25.06) * k)
    if w:
        ls = body(ls, 1780, w, 'left', r'WINDOWS')
    if glazed:
        fx, fy, fb = centre(ls, r'^FUSELAGE$')
        nose = (fb[0] - PAD + 8, fb[1] - PAD + (fb[3] - fb[1]) * 0.42, fb[0] - PAD + (fb[2] - fb[0]) * 0.07, fb[1] - PAD + (fb[3] - fb[1]) * 0.80)
        ls = insert_after(ls, r'^FUSELAGE_EFFECTS$', [glazed_nose(ls, [round(v) for v in nose])])
    return W, H, ls


def cn235_stretch(target):
    W, H, ls = load('CASA IPTN CN-235.psd', hide=[r'FUSELAGE/SHADOW$', r'TAIL/SHADOW$'])
    k = ppm(ls, 21.4)
    w = round((target - 21.4) * k)
    f = w // 2
    ls = body(ls, 470, f, 'right')
    ls = body(ls, 1650, w - f, 'left')
    return W, H, ls


BUILDS2 = {
    'a220-100': lambda: a220(35.0), 'a220-300': lambda: a220(38.7),
    'comac-c919': c919, 'comac-c919-std': c919, 'mc-21-310': mc21,
    'comac-c909': c909, 'comac-c909ccf': lambda: c909(True),
    'emb-110': lambda: j31(15.1, 1.05), 'metro-23': metro, 'metro-3-cargo': lambda: metro(True),
    'c402c': lambda: j31(11.1, 0.77),
    'do-228ng': lambda: dhc6(16.56, False), 'l-410-uvp': lambda: dhc6(14.42, False), 'c408': lambda: dhc6(16.7, True),
    'tecnam-p2012': p2012,
    'xian-ma60': lambda: f27(24.7), 'an-24rv': lambda: f27(23.53, True),
    'an-26b': lambda: cn235_stretch(23.8),
}


def plug_tiled(ls, X, w, src, sw, fixed=None, nofill=None):
    """A long forward plug at canvas X (the nose moves forward), made of copies
    of the clean strip src..src+sw so it never repeats wings or engines."""
    out = []
    for l in ls:
        if fixed and re.search(fixed, l.path, re.I):
            out.append(l); continue
        im = l.img
        W, H = im.size
        strip = im.crop((src, 0, src + sw, H))
        o = Image.new('RGBA', (W, H))
        o.paste(im.crop((X, 0, W, H)), (X, 0))
        o.paste(im.crop((0, 0, X, H)), (-w, 0))
        x = X - w
        while x < X and not (nofill and re.search(nofill, l.path, re.I)):
            o.paste(strip.crop((0, 0, min(sw, X - x), H)), (x, 0))
            x += sw
        out.append(l.copy(o))
    return out


def body_c(ls, X, w, keep, fixed=None):
    """body() with canvas coordinates."""
    return body(ls, X - PAD, w, keep, fixed=fixed)


def cn_based(target, d_scale, ppm_to, glazed=False, engines='cn', t_tail=False, eng_f=1.0, windows=None):
    W, H, ls = load('CASA IPTN CN-235.psd', hide=[r'FUSELAGE/SHADOW$', r'TAIL/SHADOW$', r'ENGINE/ENGINE_SHADOW$'])
    k = ppm(ls, 21.4)
    s = d_scale * ppm_to / k
    W, H, ls = scale_all(ls, s)
    X = lambda tx: round((tx + PAD) * s)
    total = round((target - 21.4 * d_scale) * ppm_to)
    if total:
        # room for the longer nose
        ls = moved(ls, total)
        CANVAS[0] += total
        p = pitch_of(ls, r'DOORS AND WINDOW/WINDOWS$')
        Xp = win_gap(ls, r'DOORS AND WINDOW/WINDOWS$', X(700) + total - PAD)
        Xs = win_gap(ls, r'DOORS AND WINDOW/WINDOWS$', X(528) + total - PAD)
        ls = plug_tiled(ls, Xp, total, Xs, p, fixed=r'^ENGINE/|^WING/(WING_BASE|DETAILS|FLAPS|SHADOWS)$',
                        nofill=r'antenna|OTHER_DETAILS|DOORS AND WINDOW/DOORS|^FUSELAGE/DETAILS$')
    wing = bbox(find(ls, r'^WING/WING_BASE$'))
    if engines == 'cn':
        cx, cy, eb = centre(ls, r'^ENGINE/')
        ls = extra_engines(ls, r'^ENGINE/', round(0.55 * ppm_to), round(-0.12 * ppm_to), 0.96)
    else:
        src, rx, length, keepgear = {'il96': ('Ilyushin Il-96-300.psd', r'^ENGINE0', 55.35, False),
                                     '747': ('Boeing 747-400F.psd', r'^GE/ENGINE0', 70.6, False)}[engines]
        CW = list(CANVAS)
        _, _, E = load(src)
        CANVAS[0], CANVAS[1] = CW
        ke = ppm(E, length)
        eng = find(E, rx)
        eb = bbox(eng)
        f = ppm_to / ke * eng_f
        ls = [l for l in ls if not l.path.startswith('ENGINE/')]
        tx = wing[0] - (eb[2] - eb[0]) * f * 0.12
        ty = wing[3] - (eb[3] - eb[1]) * f * 0.02
        ls = ls + scaled(eng, f, eb[0], eb[1], tx, ty)
    if t_tail:
        fin = bbox(find(ls, r'^TAIL/TAIL_BASE$'))
        el = find(ls, r'^WING/ELEVATOR$')[0]
        dy = fin[1] - el.y + round(0.01 * (fin[3] - fin[1]))
        dx = fin[2] - (el.x + el.part.width) + round(0.04 * (fin[2] - fin[0]))
        ls = [L(l.name, l.path, l.part, l.blend, l.visible, round(l.x + dx), l.y + dy) if l is el else l for l in ls]
    if windows is not None:
        wl = find(ls, r'DOORS AND WINDOW/WINDOWS$')[0]
        keep = wl.img.crop((0, 0, wl.x + windows, CANVAS[1]))
        im = Image.new('RGBA', tuple(CANVAS)); im.paste(keep, (0, 0))
        ls = [l.copy(im) if l is wl else l for l in ls]
    if glazed:
        fb = bbox(find(ls, r'^FUSELAGE/FUSELAGE_BASE$'))
        nose = (fb[0] - PAD + 6, fb[1] - PAD + (fb[3] - fb[1]) * 0.40, fb[0] - PAD + (fb[2] - fb[0]) * 0.06, fb[1] - PAD + (fb[3] - fb[1]) * 0.78)
        ls = insert_after(ls, r'^FUSELAGE/FUSELAGE_EFFECTS$', [glazed_nose(ls, [round(v) for v in nose])])
    return CANVAS[0], CANVAS[1], ls


def hstretch(ls, X0, X1, new_w, fixed=None):
    """Columns X0..X1 (canvas) of each layer stretched to new_w; what lies behind moves with them."""
    out = []
    for l in ls:
        if fixed and re.search(fixed, l.path, re.I):
            out.append(l); continue
        im = l.img
        W, H = im.size
        o = Image.new('RGBA', (W, H))
        o.paste(im.crop((0, 0, X0, H)), (0, 0))
        mid = im.crop((X0, 0, X1, H)).resize((new_w, H), Image.LANCZOS)
        o.paste(mid, (X0, 0))
        o.paste(im.crop((X1, 0, W - (new_w - (X1 - X0)), H)), (X0 + new_w, 0))
        out.append(l.copy(o))
    return out


def caravan(cargo=False):
    W, H, ls = load('Cessna 172 Skyhawk.psd', keep_gear=True)
    box = (P(215), P(150), P(1900), P(700))
    ls = [l.copy(only(l.img, box)) for l in ls]
    k = ppm(ls, 8.28)
    s = 1.22
    W, H, ls = scale_all(ls, s)
    w = round((12.67 - 8.28 * s) * k * s)
    X0, X1 = round((1060 + PAD) * s), round((1480 + PAD) * s)
    ls = hstretch(ls, X0, X1, X1 - X0 + w, fixed=r'^WING/|LANDING GEAR|^PROP/|PITOT')
    if cargo:
        ls = [l for l in ls if not re.search(r'^COCKPIT INTERIOR$', l.path)]
    return CANVAS[0], CANVAS[1], ls


def pc12():
    W, H, ls = load('Pilatus PC-24.psd', hide=[r'PILATUS_LOGO', r'CRYSTAL'])
    _, _, S = load('Cessna 172 Skyhawk.psd')
    CANVAS[0], CANVAS[1] = W, H
    k = ppm(ls, 16.85)
    w = round(2.45 * k)
    ls = [l for l in ls if not l.path.startswith('ENGINE/')]
    # the engines' shadow on the fuselage goes with the engines
    eff = find(ls, r'^FUSELAGE/BODY_EFFECTS$')[0]
    a = np.asarray(eff.img).copy()
    a[P(290):P(410), P(1255):P(1575)] = a[P(290):P(410), P(1250):P(1251)]
    ls = [l.copy(Image.fromarray(a, 'RGBA')) if l is eff else l for l in ls]
    ls = body(ls, 600, -w // 2, 'right', r'^FUSELAGE/WINDOWS$')
    X0, X1 = P(1120), P(1700)
    ls = hstretch(ls, X0, X1, X1 - X0 - (w - w // 2), fixed=r'^WING/')
    # a turboprop nose: the propeller and spinner of the Skyhawk, sized for a PT6
    prop = find(S, r'^PROP/(Prop Cone|Prop Cone Effects|Prop Blades)$')
    pb = bbox(prop)
    ks = ppm(S, 8.28)
    f = k / ks * 1.15
    fb = bbox(find(ls, r'^FUSELAGE/FUSELAGE$'))
    ny = fb[1] + (fb[3] - fb[1]) * 0.42
    ls = ls + scaled(prop, f, pb[2], (pb[1] + pb[3]) / 2, fb[0] + 6, ny)
    return W, H, ls


BUILDS2.update({
    'l-382g': lambda: cn_based(32.3, 1.48, 80, windows=60),
    'an-12bk': lambda: cn_based(33.1, 1.40, 80, glazed=True, windows=110),
    'il-76td-90': lambda: cn_based(46.6, 1.75, 55, glazed=True, engines='il96', t_tail=True, eng_f=0.8, windows=40),
    'an-124-100': lambda: cn_based(69.1, 2.55, 40, engines='747', eng_f=1.05, windows=0),
    'c208b-ex': caravan, 'c208b-cargo': lambda: caravan(True),
    'pilatus-pc12': pc12,
})

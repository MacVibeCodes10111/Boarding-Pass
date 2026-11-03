# Side views drawn from scratch, for aircraft with no community template.
# Same look as the templates (white, soft cylindrical shading, grey panel
# lines, dark windows) and the same standard layers.
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

SS = 3            # supersampling
PPM = 52          # pixels per metre at 1x for a 30 m aircraft; scaled per type


class Canvas:
    def __init__(self, L, H, ppm):
        self.ppm = ppm
        self.ox, self.oy = 0.06 * L, 0.0  # nose at 6% in
        self.W = int((L * 1.12) * ppm)
        self.Hpx = int(H * ppm)
        self.base_y = 0.62 * H            # y (m, up) of fuselage bottom on the canvas

    def p(self, x, y):
        """metres (x aft from nose, y up from the fuselage bottom) -> supersampled px"""
        return ((x + self.ox) * self.ppm * SS, (self.Hpx / self.ppm - (y + self.base_y)) * self.ppm * SS)

    def new(self):
        return Image.new('L', (self.W * SS, self.Hpx * SS), 0)


def catmull(pts, n=10, closed=True):
    out = []
    P = pts + pts[:3] if closed else [pts[0]] + pts + [pts[-1]]
    m = len(pts) if closed else len(pts) - 1
    for i in range(m):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    if not closed:
        out.append(pts[-1])
    return out


def poly_mask(cv, pts_m, smooth=True):
    m = cv.new()
    pts = catmull(pts_m) if smooth else pts_m
    ImageDraw.Draw(m).polygon([cv.p(*q) for q in pts], fill=255)
    return m


def down(img):
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


def colour(mask, rgb, alpha=1.0):
    """RGBA layer: a flat colour through a supersampled mask."""
    m = down(mask)
    o = Image.new('RGBA', m.size, rgb + (0,))
    o.putalpha(m.point(lambda v: int(v * alpha)))
    return o


def shading(cv, mask, top, bottom, strength=1.0, light=0.68):
    """Cylindrical shading inside `mask` between heights bottom..top (m): dark
    at the belly, a soft highlight just above the middle, darker at the crown."""
    m = down(mask)
    w, h = m.size
    ys = np.arange(h, dtype=np.float32)
    # heights in metres of each row
    ym = cv.Hpx / cv.ppm - ys / cv.ppm - cv.base_y
    t = np.clip((ym - bottom) / max(top - bottom, 1e-3), 0, 1)
    dark = np.where(t < light, (1 - t / light) ** 1.6 * 0.30, ((t - light) / (1 - light)) ** 2.2 * 0.10)
    a = (dark * 255 * strength).astype(np.float32)[:, None] * (np.asarray(m, dtype=np.float32) / 255)
    o = Image.new('RGBA', (w, h), (40, 48, 58, 0))
    o.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    return o


def outline(mask, width=1, alpha=70, rgb=(60, 66, 74)):
    m = down(mask)
    e = ImageChops.subtract(m, m.filter(ImageFilter.MinFilter(1 + 2 * width)))
    o = Image.new('RGBA', m.size, rgb + (0,))
    o.putalpha(e.point(lambda v: v * alpha // 255))
    return o


def lines(cv, segs, alpha=60, width=1.0, rgb=(70, 76, 84)):
    m = cv.new()
    d = ImageDraw.Draw(m)
    for s in segs:
        d.line([cv.p(*q) for q in s], fill=255, width=max(1, int(width * SS)))
    return colour(m, rgb, alpha / 255)


def rrect(cv, x0, y0, x1, y1, r):
    """rounded rectangle polygon in metres"""
    pts = []
    for cx, cy, a0 in ((x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270)):
        for k in range(7):
            a = math.radians(a0 + k * 15)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def merge(*layers):
    o = Image.new('RGBA', layers[0].size)
    for l in layers:
        o.alpha_composite(l)
    return o


# ---------------------------------------------------------------------------
def fuselage_pts(s):
    """Outline of the fuselage in metres, nose to tail."""
    L, D = s['L'], s['D']
    n = s.get('nose', 2.2 * D)          # nose length
    t = s.get('cone', 2.6 * D)          # tail cone length
    tip = s.get('nose_tip', 0.38)       # nose tip height / D
    up = s.get('upsweep', 0.62)         # belly height at the tail end / D
    end = s.get('tail_end', 0.86)       # crown height at the tail end / D
    bl = s.get('blunt', 0.0)            # boxy noses (Do 228, SkyCourier)
    top = [(0, tip * D), (0.015 * n, (tip + 0.10 + 0.08 * bl) * D), (0.10 * n, (0.58 + 0.12 * bl) * D), (0.32 * n, (0.83 + 0.06 * bl) * D),
           (0.62 * n, 0.965 * D), (n, D), (L - t, D), (L - 0.6 * t, 0.99 * D), (L - 0.25 * t, (end + 0.07) * D), (L, end * D)]
    bot = [(L, (end - 0.12) * D), (L - 0.06 * t, (up + 0.02) * D), (L - 0.3 * t, (up * 0.7) * D), (L - 0.62 * t, 0.12 * D), (L - t, 0.0),
           (0.9 * n, 0.0), (0.55 * n, 0.025 * D), (0.25 * n, (0.09 - 0.05 * bl) * D), (0.06 * n, (tip - 0.16 + 0.06 * bl) * D)]
    return top + bot


def build(s):
    """All layers for one aircraft: list of (group, role, RGBA image)."""
    L, D = s['L'], s['D']
    below = max([0.6 * D] + [g[2] + g[1] for g in s.get('gear', [])] + [-(e['y'] - e.get('prop_r', e['d'] / 2)) for e in s.get('engines', [])] + [-(e['y'] - e['d'] / 2) for e in s.get('engines', [])])
    Htot = s.get('fin_h', 2.2 * D) + 0.92 * D + below + 1.2
    ppm = 1700 / L
    cv = Canvas(L, Htot, ppm)
    cv.base_y = below + 0.5
    layers = []
    WHITE = (250, 251, 252)

    fus = poly_mask(cv, fuselage_pts(s))
    # -- tail fin
    fc = s.get('fin_c', 1.8 * D)           # root chord
    fx = L - fc - s.get('fin_back', 0.35)  # fin root leading edge
    fh = s.get('fin_h', 2.0 * D)           # height above the crown
    fsw = s.get('fin_sweep', 0.9)          # tip set-back / height
    ftc = s.get('fin_tip_c', 0.45)         # tip chord / root chord
    ytop = D * 0.92
    fin = [(fx, ytop), (fx + fh * fsw, ytop + fh), (fx + fh * fsw + fc * ftc, ytop + fh), (fx + fc, ytop - 0.08 * D), (fx + fc * 0.3, ytop - 0.04 * D)]
    if s.get('dorsal'):
        fin = [(fx - s['dorsal'] * D, ytop + 0.02 * D)] + fin
    finm = poly_mask(cv, fin, smooth=False)
    layers += [('TAIL', 'BASE', colour(finm, WHITE)), ('TAIL', 'EFFECTS', shading(cv, finm, ytop + fh, ytop, 0.35, 0.3)),
               ('TAIL', 'DETAILS', outline(finm, 1, 60))]
    # rudder hinge line
    layers.append(('TAIL', 'DETAILS', lines(cv, [[(fx + fc * 0.68, ytop + 0.05), (fx + fh * fsw + fc * ftc * 0.7, ytop + fh - 0.1)]], 55)))

    # -- fuselage
    layers += [('FUSELAGE', 'BASE', colour(fus, WHITE)),
               ('FUSELAGE', 'DETAILS', merge(outline(fus, 1, 80),
                                             lines(cv, [[(x, 0.02 * D), (x, 0.98 * D)] for x in np.arange(s.get('nose', 2.2 * D) + 1.0, L - s.get('cone', 2.6 * D), 2.6)], 16),
                                             lines(cv, [[(s.get('nose', 2.2 * D) * 0.6, 0.30 * D), (L - s.get('cone', 2.6 * D) * 0.7, 0.30 * D)]], 18)))]
    # -- cockpit windows
    cw = s.get('cockpit', 'jet')
    n = s.get('nose', 2.2 * D)
    if cw == 'glazed':  # glazed navigator nose plus flight deck windows
        g = [(0.02 * n, (s.get('nose_tip', 0.38)) * D), (0.18 * n, 0.66 * D), (0.32 * n, 0.68 * D), (0.30 * n, 0.40 * D), (0.10 * n, 0.24 * D)]
        layers.append(('FUSELAGE', 'DOORS & WINDOWS', colour(poly_mask(cv, g, False), (58, 70, 84), 0.85)))
    if cw != 'none':
        cx0 = s.get('cockpit_x', 0.20 * n)
        ck = [(cx0, 0.60 * D), (cx0 + 0.07 * n, 0.715 * D), (cx0 + 0.30 * n, 0.81 * D), (cx0 + 0.33 * n, 0.69 * D), (cx0 + 0.05 * n, 0.585 * D)]
        ckm = poly_mask(cv, ck, False)
        layers.append(('FUSELAGE', 'DOORS & WINDOWS', merge(colour(ckm, (46, 56, 66)), outline(ckm, 1, 90, (30, 34, 40)))))
        # frames
        layers.append(('FUSELAGE', 'DOORS & WINDOWS', lines(cv, [[(cx0 + 0.13 * n, 0.62 * D), (cx0 + 0.13 * n, 0.76 * D)], [(cx0 + 0.23 * n, 0.65 * D), (cx0 + 0.23 * n, 0.795 * D)]], 220, 1.4, (232, 234, 237))))
    # -- cabin windows
    win = s.get('windows')
    if win:
        x0, x1, pitch = win['from'], win['to'], win['pitch']
        wy = win.get('y', 0.56) * D
        ww, wh = win.get('w', 0.24), win.get('h', 0.34)
        skip = win.get('skip', [])
        m = cv.new()
        d = ImageDraw.Draw(m)
        x = x0
        while x <= x1:
            if not any(a <= x <= b for a, b in skip):
                r = min(ww, wh) * (0.5 if win.get('round') else 0.32)
                d.polygon([cv.p(*q) for q in rrect(cv, x - ww / 2, wy - wh / 2, x + ww / 2, wy + wh / 2, r)], fill=255)
            x += pitch
        wl = colour(m, (52, 62, 72))
        layers.append(('FUSELAGE', 'DOORS & WINDOWS', wl))
    # -- doors (outlines) and cargo doors
    dm = []
    for dd in s.get('doors', []):
        x, w, h = dd[0], dd[1], dd[2]
        yb = dd[3] if len(dd) > 3 else 0.16 * D
        r = min(w, h) * 0.18
        dm.append(rrect(cv, x, yb, x + w, yb + h, r))
    if dm:
        m = cv.new(); d = ImageDraw.Draw(m)
        for q in dm:
            d.line([cv.p(*a) for a in q + [q[0]]], fill=255, width=int(1.3 * SS))
        layers.append(('FUSELAGE', 'DOORS & WINDOWS', colour(m, (96, 102, 110), 0.75)))
    layers.append(('FUSELAGE', 'EFFECTS', shading(cv, fus, D, 0.0, 1.0)))

    # -- wing
    wx = s.get('wing_x', 0.40 * L)         # root leading edge
    wc = s.get('wing_c', 0.12 * L)         # root chord
    span = s.get('span_vis', 0.32 * L)     # how far back-up the tip appears
    high = s.get('high_wing', False)
    if high:
        wy = D * 1.0
        wing = [(wx, wy - 0.02 * D), (wx + 0.18 * wc, wy + 0.10 * D), (wx + wc * 0.9, wy + 0.08 * D), (wx + wc * 1.05, wy - 0.04 * D)]
        wm = poly_mask(cv, wing, True)
        fair = poly_mask(cv, [(wx - 0.4 * wc, wy - 0.04 * D), (wx + 0.2 * wc, wy + 0.13 * D), (wx + 1.1 * wc, wy + 0.10 * D), (wx + 1.6 * wc, wy - 0.06 * D)], True)
        layers += [('WINGS', 'BASE', colour(fair, WHITE)), ('WINGS', 'EFFECTS', shading(cv, fair, wy + 0.14 * D, wy - 0.06 * D, 0.5)),
                   ('WINGS', 'DETAILS', outline(fair, 1, 55))]
        if s.get('strut'):
            sx = wx + 0.35 * wc
            st = poly_mask(cv, [(sx - 0.1, 0.18 * D), (sx + 0.12, 0.18 * D), (sx + 0.6 * wc, wy - 0.01), (sx + 0.6 * wc - 0.2, wy - 0.01)], False)
            layers += [('WINGS', 'BASE', colour(st, (236, 238, 240))), ('WINGS', 'DETAILS', outline(st, 1, 80))]
    else:
        wy = s.get('wing_y', 0.20) * D
        tipx, tipy = wx + span, wy + s.get('dihedral', 0.36) * D
        wing = [(wx, wy), (wx + 0.25 * wc, wy + 0.07 * D), (tipx, tipy + 0.04 * D), (tipx + 0.25 * wc * s.get('taper', 0.35), tipy), (wx + wc * 0.95, wy - 0.06 * D), (wx + wc * 0.4, wy - 0.10 * D)]
        wm = poly_mask(cv, wing, False)
        belly = poly_mask(cv, [(wx - 0.25 * wc, 0.16 * D), (wx + 0.3 * wc, -0.05 * D), (wx + 1.2 * wc, -0.04 * D), (wx + 1.55 * wc, 0.18 * D), (wx + 0.6 * wc, 0.3 * D)], True)
        layers += [('WINGS', 'BASE', colour(belly, WHITE)), ('WINGS', 'EFFECTS', shading(cv, belly, 0.2 * D, -0.1 * D, 0.6)),
                   ('WINGS', 'BASE', colour(wm, (226, 229, 233))), ('WINGS', 'EFFECTS', shading(cv, wm, tipy + 0.05 * D, wy - 0.1 * D, 0.45, 0.8)),
                   ('WINGS', 'DETAILS', merge(outline(wm, 1, 90), lines(cv, [[(wx + 0.55 * wc, wy - 0.02), (tipx + 0.1 * wc, tipy - 0.02)]], 50)))]
        if s.get('winglet'):
            wl = poly_mask(cv, [(tipx - 0.05 * wc, tipy), (tipx + 0.05 * wc, tipy + 0.55 * D), (tipx + 0.17 * wc, tipy + 0.55 * D), (tipx + 0.22 * wc, tipy)], False)
            layers += [('WINGS', 'BASE', colour(wl, (236, 238, 241))), ('WINGS', 'DETAILS', outline(wl, 1, 90))]

    # -- horizontal stabiliser
    hc = s.get('stab_c', 0.9 * D)
    hx = L - 1.55 * hc - s.get('stab_back', 0.25)
    if s.get('t_tail'):
        hy = ytop + fh - 0.05 * D
        hx = fx + fh * fsw - 0.15 * hc
    else:
        hy = s.get('stab_y', 0.72) * D
    st = poly_mask(cv, [(hx, hy), (hx + 0.35 * hc, hy + 0.10 * D), (hx + hc * 1.5, hy + 0.20 * D), (hx + hc * 1.55, hy + 0.12 * D), (hx + hc, hy - 0.06 * D)], False)
    layers += [('WINGS', 'BASE', colour(st, (232, 234, 238))), ('WINGS', 'EFFECTS', shading(cv, st, hy + 0.2 * D, hy - 0.06 * D, 0.4, 0.8)),
               ('WINGS', 'DETAILS', outline(st, 1, 90))]

    # -- engines
    for e in s.get('engines', []):
        layers += engine(cv, s, e)
    # -- fixed gear
    if s.get('gear'):
        layers += gear(cv, s)
    return cv, layers


def engine(cv, s, e):
    D = s['D']
    kind, x, y, l, d = e['kind'], e['x'], e['y'], e['l'], e['d']
    out = []
    WHITE = (248, 249, 250)
    if kind == 'fan':        # podded turbofan
        body = [(x, y + 0.42 * d), (x + 0.1 * l, y + 0.5 * d), (x + 0.75 * l, y + 0.47 * d), (x + l, y + 0.22 * d), (x + l, y - 0.22 * d), (x + 0.75 * l, y - 0.47 * d), (x + 0.1 * l, y - 0.5 * d), (x, y - 0.42 * d)]
        m = poly_mask(cv, body, True)
        lip = poly_mask(cv, [(x - 0.01 * l, y + 0.43 * d), (x + 0.07 * l, y + 0.49 * d), (x + 0.07 * l, y - 0.49 * d), (x - 0.01 * l, y - 0.43 * d)], True)
        cone = poly_mask(cv, [(x + l, y + 0.2 * d), (x + l * 1.18, y + 0.03 * d), (x + l * 1.18, y - 0.03 * d), (x + l, y - 0.2 * d)], False)
        out += [('ENGINES', 'BASE', colour(cone, (150, 154, 160))), ('ENGINES', 'BASE', colour(m, WHITE)),
                ('ENGINES', 'BASE', colour(lip, (205, 208, 212))),
                ('ENGINES', 'EFFECTS', shading(cv, m, y + 0.5 * d, y - 0.5 * d, 0.9, 0.7)), ('ENGINES', 'DETAILS', merge(outline(m, 1, 90), outline(lip, 1, 120)))]
        if e.get('pylon', True) and not e.get('rear'):
            py = poly_mask(cv, [(x + 0.35 * l, y + 0.45 * d), (x + 0.55 * l, y + 0.45 * d + 0.35 * D), (x + 1.25 * l, y + 0.45 * d + 0.35 * D), (x + 0.95 * l, y + 0.4 * d)], False)
            out = [('ENGINES', 'BASE', colour(py, (238, 240, 243))), ('ENGINES', 'DETAILS', outline(py, 1, 70))] + out
    elif kind in ('prop', 'piston'):   # turboprop or piston nacelle with a propeller
        body = [(x, y + 0.25 * d), (x + 0.12 * l, y + 0.48 * d), (x + 0.7 * l, y + 0.5 * d), (x + l, y + 0.18 * d), (x + l, y - 0.12 * d), (x + 0.6 * l, y - 0.5 * d), (x + 0.12 * l, y - 0.46 * d), (x, y - 0.2 * d)]
        m = poly_mask(cv, body, True)
        sp = poly_mask(cv, [(x - 0.14 * l, y), (x - 0.02 * l, y + 0.24 * d), (x + 0.02 * l, y + 0.24 * d), (x + 0.02 * l, y - 0.24 * d), (x - 0.02 * l, y - 0.24 * d)], True)
        R = e.get('prop_r', 1.4 * d)
        bl = cv.new(); dr = ImageDraw.Draw(bl)
        px = x - 0.06 * l
        rw = max(0.09, 0.07 * R)
        for sgn in (1, -1):
            dr.polygon([cv.p(px - rw, y), cv.p(px - rw * 0.55, y + sgn * R), cv.p(px + rw * 0.25, y + sgn * R * 0.97), cv.p(px + rw * 0.7, y)], fill=255)
        disc = cv.new(); ImageDraw.Draw(disc).ellipse([cv.p(x - 0.07 * l, y + R)[0] - 0.08 * cv.ppm * SS, cv.p(0, y + R)[1], cv.p(x - 0.03 * l, y - R)[0] + 0.08 * cv.ppm * SS, cv.p(0, y - R)[1]], fill=255)
        out += [('ENGINES', 'BASE', colour(m, WHITE)), ('ENGINES', 'EFFECTS', shading(cv, m, y + 0.5 * d, y - 0.5 * d, 0.85, 0.7)),
                ('ENGINES', 'DETAILS', merge(outline(m, 1, 90), lines(cv, [[(x + 0.75 * l, y - 0.1 * d), (x + 0.9 * l, y - 0.1 * d)]], 120, 1.5, (60, 60, 64)))),
                ('ENGINES', 'EFFECTS', colour(disc, (120, 126, 134), 0.10)),
                ('ENGINES', 'BASE', colour(bl, (44, 46, 50), 0.82)), ('ENGINES', 'BASE', colour(sp, (236, 238, 240))), ('ENGINES', 'DETAILS', outline(sp, 1, 110))]
    return out


def gear(cv, s):
    D = s['D']
    out = []
    m = cv.new(); d = ImageDraw.Draw(m)
    w = cv.new(); dw = ImageDraw.Draw(w)
    for gx, r, leg in s['gear']:
        top = 0.1 * D
        d.line([cv.p(gx, top), cv.p(gx + 0.1, -leg)], fill=255, width=int(0.12 * cv.ppm * SS))
        c = cv.p(gx + 0.1, -leg)
        rr = r * cv.ppm * SS
        dw.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], fill=255)
    hub = cv.new(); dh = ImageDraw.Draw(hub)
    for gx, r, leg in s['gear']:
        c = cv.p(gx + 0.1, -leg); rr = r * 0.45 * cv.ppm * SS
        dh.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], fill=255)
    out += [('DETAILS', 'BASE', colour(m, (150, 154, 160))), ('DETAILS', 'BASE', colour(w, (38, 40, 44))), ('DETAILS', 'BASE', colour(hub, (190, 194, 198)))]
    return out

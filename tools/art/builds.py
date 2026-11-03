# Variants made from existing templates: stretched, shortened, or converted to
# freighters. Each returns (W, H, layers). Coordinates are template pixels
# (the loader's padding is added with P()).
import sys
sys.path.insert(0, '.')
import numpy as np
from scipy import ndimage
from kit import *

P = lambda v: v + PAD


def win_gap(ls, rx, near):
    """x of the middle of the gap between windows nearest `near` (template px)."""
    l = find(ls, rx)[0]
    a = np.asarray(l.img.getchannel('A'))
    cols = (a > 40).any(axis=0)
    x = P(near)
    lo = x
    while lo > 0 and cols[lo]: lo -= 1
    hi = x
    while hi < len(cols) - 1 and cols[hi]: hi += 1
    if not cols[x]:
        lo, hi = x, x
        while lo > 0 and not cols[lo - 1]: lo -= 1
        while hi < len(cols) - 1 and not cols[hi + 1]: hi += 1
        return (lo + hi) // 2
    return lo if (x - lo) <= (hi - x) else hi


def window_blobs(img, max_h):
    """Split a doors-and-windows layer into (windows, everything else) by blob height."""
    a = np.asarray(img.getchannel('A'))
    lab, n = ndimage.label(a > 30)
    objs = ndimage.find_objects(lab)
    win = np.zeros(a.shape, bool)
    for i, sl in enumerate(objs):
        if sl is None: continue
        h = sl[0].stop - sl[0].start
        w = sl[1].stop - sl[1].start
        if h <= max_h and w <= max_h * 1.6:
            win |= lab == (i + 1)
    # grow a little to take the windows' soft edges
    win = ndimage.binary_dilation(win, iterations=2) & (a > 0)
    arr = np.asarray(img).copy()
    wins = arr.copy(); wins[~win] = 0
    rest = arr.copy(); rest[win] = 0
    return Image.fromarray(wins, 'RGBA'), Image.fromarray(rest, 'RGBA')


def freighter(ls, rx, max_h, keep_box=None):
    """Plug the windows of the matching layer(s); keep doors. keep_box: template-px
    x-range whose windows stay (e.g. crew windows)."""
    out = []
    for l in ls:
        if re.search(rx, l.path, re.I):
            wins, rest = window_blobs(l.img, max_h)
            if keep_box:
                keepw = only(wins, (P(keep_box[0]), 0, P(keep_box[1]), wins.height))
                rest.alpha_composite(keepw)
                wins = erase(wins, (P(keep_box[0]), 0, P(keep_box[1]), wins.height))
            rest.alpha_composite(plugged(wins))
            out.append(l.copy(rest))
        else:
            out.append(l)
    return out


def clear_box(ls, rx, box):
    """Erase a template-px box from matching layers (e.g. windows under a new door)."""
    b = (P(box[0]), P(box[1]), P(box[2]), P(box[3]))
    return [l.copy(erase(l.img, b)) if re.search(rx, l.path, re.I) else l for l in ls]


def insert_after(ls, rx, new):
    """Insert new layers after the first layer matching rx."""
    for i, l in enumerate(ls):
        if re.search(rx, l.path, re.I):
            return ls[:i + 1] + new + ls[i + 1:]
    return ls + new


def patch(src_layers, rx, box, factor, at, name, boost=1.0):
    """A new layer: box (template px) cut from the matching source layers, scaled, placed at `at` (template px)."""
    sel = find(src_layers, rx)
    W, H = CANVAS
    im = render(W, H, sel)
    b = (P(box[0]), P(box[1]), P(box[2]), P(box[3]))
    part = im.crop(b)
    part = part.resize((max(1, round(part.width * factor)), max(1, round(part.height * factor))), Image.LANCZOS)
    if boost != 1.0:
        a = np.asarray(part.getchannel('A'), dtype=np.float32) * boost
        part.putalpha(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)))
    o = Image.new('RGBA', (W, H))
    o.paste(part, (P(at[0]), P(at[1])), part)
    return L(name, name, None).copy(o)


# ---------------------------------------------------------------------------
def max9():
    W, H, A = load('Boeing 737-900ER.psd')
    _, _, M = load('Boeing 737 MAX 8.psd')
    CUT, DX = P(1440), 38

    def left(img, x=CUT):
        return erase(img, (x, 0, img.width, img.height))

    def right(img, x=CUT - DX, dx=DX):
        o = Image.new('RGBA', img.size); o.paste(img.crop((x, 0, img.width, img.height)), (x + dx, 0)); return o

    def both(a, b):
        o = left(a); o.alpha_composite(right(b)); return o

    g = lambda ls, rx, i=0: find(ls, rx)[i].img
    mk = lambda name, img: L(name, name, None).copy(img)
    wing = g(M, r'^WING$')
    w2 = left(wing, CUT - DX); w2.alpha_composite(right(wing))
    out = [
        mk('STROBE', g(A, r'^STROBE$')),
        mk('ANTENNA', both(g(A, r'^ANTENNA$', 0), g(M, r'^ANTENNA$', 0))),
        mk('TAIL', right(g(M, r'^TAIL$'), 0)),
        mk('TAIL_DETAILS', right(g(M, r'^TAIL_DETAILS$'), 0)),
        mk('Cockpit Window', g(A, r'^Cockpit Window$')),
        mk('FUSELAGE', both(g(A, r'^FUSELAGE$'), g(M, r'^FUSELAGE$'))),
        mk('FUSELAGE_DETAILS', both(g(A, r'^FUSELAGE_DETAILS$'), g(M, r'^FUSELAGE_DETAILS$'))),
        mk('DOORS & WINDOWS', g(A, r'^DOORS & WINDOWS \(A\)$')),
        mk('FUSELAGE_EFFECTS', both(g(A, r'^FUSELAGE EFFECTS$'), g(M, r'^FUSELAGE_EFFECTS$'))),
        mk('ANTENNA', both(g(A, r'^ANTENNA$', 1), g(M, r'^ANTENNA$', 1))),
        mk('TAILSKID', right(g(M, r'TAILSKID/TAILSKID$'), 0)),
        mk('TAILSKID DETAILS', right(g(M, r'TAILSKID/TAILSKID DETAILS$'), 0)),
        mk('WING', w2),
        mk('WINGLET', g(M, r'WINGLET/WINGLET$')),
        mk('WINGLET DETAILS', g(M, r'WINGLET/WINGLET DETAILS$')),
        mk('details (tail)', right(g(M, r'^details$', 0), 0)),
        mk('ENGINE', g(M, r'^ENGINE/ENGINE$')),
        mk('ENGINE_DETAILS', g(M, r'^ENGINE/ENGINE_DETAILS$')),
        mk('ENGINE_EFFECTS', g(M, r'^ENGINE/ENGINE_EFFECTS$')),
        mk('details (engine)', g(M, r'^ENGINE/details$')),
    ]
    return W, H, out


NOT_WING = lambda l: not re.search(r'wing|winglet|engine', l.path, re.I)


def stretch(ls, fwd_at, fwd_w, aft_at, aft_w, rx_win):
    """Fuselage plugs (w > 0) or cuts (w < 0) ahead of and behind the wing, at window gaps."""
    if fwd_w:
        x = win_gap(ls, rx_win, fwd_at)
        if fwd_w > 0:
            ls = apply(ls, lambda im: plug(im, x, fwd_w, keep='right'))
        else:
            ls = apply(ls, lambda im: cut(im, x + fwd_w, x, keep='right'))
    if aft_w:
        x = win_gap(ls, rx_win, aft_at)
        if aft_w > 0:
            ls = apply(ls, lambda im: plug(im, x, aft_w, keep='left'))
        else:
            ls = apply(ls, lambda im: cut(im, x, x - aft_w, keep='left'))
    return ls


def max10():
    W, H, ls = max9()
    return W, H, stretch(ls, 700, 20, 1360, 41, r'DOORS & WINDOWS')


def max7():
    W, H, ls = load('Boeing 737 MAX 8.psd')
    return W, H, stretch(ls, 700, -81, 1360, -61, r'^WINDOWS$')


def max8200():
    W, H, ls = load('Boeing 737 MAX 8.psd')
    _, _, E = load('Boeing 737-900ER.psd')
    # the -900ER's exit aft of the wing, at the same place (the wing is in the same spot)
    d = find(E, r'DOORS & WINDOWS \(A\)')[0].img
    wins, rest = window_blobs(d, 30)
    door = only(rest, (P(1270), 0, P(1320), d.height))
    ls = clear_box(ls, r'^WINDOWS$', (1268, 0, 1322, 788))
    ls = insert_after(ls, r'^WINDOWS$', [L('EXIT DOOR', 'EXIT DOOR', None).copy(door)])
    return W, H, ls


def b737sf(base):
    W, H, ls = load(base)
    _, _, B = load('e0d57353-Boeing_737-800BCF_V2.0.psd')
    dw = find(ls, r'^DOORS & WINDOWS$')[0]
    d1 = dw.x - PAD                          # door 1
    dx = d1 - 492                            # the BCF's door 1 is at 492
    ls = freighter(ls, r'^DOORS & WINDOWS$', 30)
    door = find(B, r'FUSELAGE/BCF Door$')[0].img
    sill = find(B, r'FUSELAGE/Cargo Door detail option$')[0].img
    ls = clear_box(ls, r'^DOORS & WINDOWS$', (613 + dx, 0, 772 + dx, 788))
    ls = insert_after(ls, r'^DOORS & WINDOWS$', [L('CARGO DOOR', 'CARGO DOOR', None).copy(shift(door, dx)),
                                                  L('CARGO DOOR DETAILS', 'CARGO DOOR DETAILS', None).copy(shift(sill, dx))])
    return W, H, ls


def a320p2f():
    W, H, A = load('Airbus A320.psd')
    _, _, B = load('Airbus A321P2F.psd')
    ls = freighter(A, r'^DOORS & WINDOWS$', 30)
    CD = 545 - 517
    door = shift(find(B, r'^P2F door$')[0].img, CD)
    sill = shift(find(B, r'^Cargo Door detail option$')[0].img, CD)
    ls = clear_box(ls, r'^DOORS & WINDOWS$', (545, 0, 545 + 153, 750))
    ls = insert_after(ls, r'^DOORS & WINDOWS$', [L('CARGO DOOR', 'CARGO DOOR', None).copy(door), L('CARGO DOOR DETAILS', 'CARGO DOOR DETAILS', None).copy(sill)])
    return W, H, ls


def e190f():
    W, H, ls = load('Embraer E190.psd')
    _, _, B = load('e0d57353-Boeing_737-800BCF_V2.0.psd')
    ls = freighter(ls, r'^DOORS & WINDOWS$', 28)
    f = 145 / 162                       # fuselage heights: E190 / 737
    at = (330, 296 + round((426 - 418) * f))
    door = patch(B, r'FUSELAGE/BCF Door$', (613, 426, 772, 531), f, at, 'CARGO DOOR')
    sill = patch(B, r'FUSELAGE/Cargo Door detail option$', (618, 515, 767, 531), f, (at[0] + round(5 * f), at[1] + round(89 * f)), 'CARGO DOOR DETAILS')
    ls = clear_box(ls, r'^DOORS & WINDOWS$', (at[0] - 2, 0, at[0] + round(159 * f) + 2, 600))
    return W, H, insert_after(ls, r'^DOORS & WINDOWS$', [door, sill])


def atr42f():
    W, H, ls = load('ATR 42.psd')
    return W, H, freighter(ls, r'^DOORS & WINDOWS$', 26)


def saab340f():
    W, H, ls = load('SAAB 340B.psd')
    return W, H, freighter(ls, r'^WINDOWS$', 40)


def tu214():
    W, H, ls = load('Tupolev Tu-204.psd')
    d = find(ls, r'^CONFIG_A$')[0].img
    wins, rest = window_blobs(d, 30)
    door1 = only(rest, (P(280), 0, P(335), d.height))
    x = 560
    ls = clear_box(ls, r'^CONFIG_A$', (x + 280 - 284 - 4, 0, x + 335 - 284 + 4, 750))
    return W, H, insert_after(ls, r'^CONFIG_A$', [L('DOOR 2', 'DOOR 2', None).copy(shift(door1, x - 284))])


def il96t():
    W, H, ls = load('Ilyushin Il-96-400M.psd')
    _, _, B = load('Boeing 767-300BCF.psd')
    ls = freighter(ls, r'^Doors and Windows', 34)
    f = 234 / 210
    at = (700, 519 + round((500 - 498) * f))
    door = patch(B, r'FUSELAGE_DETAILS$', (648, 500, 780, 628), f, at, 'CARGO DOOR', boost=1.8)
    sill = patch(B, r'details_OPTION$', (641, 607, 777, 627), f, (at[0] - round(7 * f), at[1] + round(107 * f)), 'CARGO DOOR SILL')
    ls = clear_box(ls, r'^Doors and Windows', (at[0], 0, at[0] + round(132 * f), 1162))
    return W, H, insert_after(ls, r'^Doors and Windows', [door, sill])


def a350f():
    W, H, ls = load('Airbus A350-1000.psd')
    _, _, F = load('Boeing 777F.psd')
    ls = stretch(ls, 800, -56, 2150, -57, r'^WINDOWS$')
    ls = [l for l in ls if not re.fullmatch(r'WINDOWS', l.path)]   # the A350F has no cabin windows
    f = 262 / 247
    at = (2010, 568 + round((582 - 574) * f))
    door = patch(F, r'^FUSELAGE_DETAILS$', (1876, 580, 2012, 722), f, at, 'CARGO DOOR', boost=2.2)
    return W, H, insert_after(ls, r'^DOORS$', [door])


def b7778f():
    W, H, ls = load('Boeing 777-8X.psd')
    _, _, F = load('Boeing 777F.psd')
    ls = freighter(ls, r'^DOORS & WINDOWS$', 34, keep_box=(430, 560))
    dx = 1118 - 1173
    door = patch(F, r'^FUSELAGE_DETAILS$', (1876, 580, 2012, 722), 1.0, (1876 + dx, 580 - 3), 'CARGO DOOR', boost=2.2)
    ls = clear_box(ls, r'^DOORS & WINDOWS$', (1876 + dx, 0, 2012 + dx, 1162))
    return W, H, insert_after(ls, r'^DOORS & WINDOWS$', [door])


def b777sf():
    W, H, ls = load('Boeing 777-300.psd', show=[r'^ER$'], hide=[r'^GE$'])
    _, _, B = load('Boeing 767-300BCF.psd')
    dw = [l for l in ls if re.search(r'^DOOR', l.path, re.I)][0]
    ls = freighter(ls, re.escape(dw.path) + '$', 34)
    f = 247 / 210
    x0 = dw.x - PAD + 150
    fus = find(ls, r'^FUSELAGE$')[0]
    at = (x0, fus.y - PAD + round(2 * f))
    door = patch(B, r'FUSELAGE_DETAILS$', (648, 500, 780, 628), f, at, 'CARGO DOOR', boost=1.8)
    sill = patch(B, r'details_OPTION$', (641, 607, 777, 627), f, (at[0] - round(7 * f), at[1] + round(107 * f)), 'CARGO DOOR SILL')
    ls = clear_box(ls, re.escape(dw.path) + '$', (at[0], 0, at[0] + round(132 * f), 1162))
    return W, H, insert_after(ls, re.escape(dw.path) + '$', [door, sill])


def b717():
    W, H, ls = load('McDonnell Douglas MD-87.psd')
    _, _, N = load('McDonnell Douglas MD-90.psd')
    ls = stretch(ls, 700, -68, 0, 0, r'^WINDOW$')
    ls = [l for l in ls if not l.path.startswith('ENGINE/')]
    eng = find(N, r'^ENGINE/')
    f = 0.86
    ax, ay = P(1613), P(439)       # MD-90 pylon root
    bx, by = P(1494), P(440)       # MD-87 pylon root
    new = []
    for l in eng:
        im = l.img
        sc = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
        o = Image.new('RGBA', im.size)
        o.paste(sc, (round(bx - ax * f), round(by - ay * f)), sc)
        new.append(l.copy(o))
    return W, H, ls + new


BUILDS = dict(max9=max9, max10=max10, max7=max7, max8200=max8200, a320p2f=a320p2f, e190f=e190f, atr42f=atr42f,
              saab340f=saab340f, tu214=tu214, il96t=il96t, a350f=a350f, b7778f=b7778f, b777sf=b777sf, b717=b717,
              b737sf=b737sf)

# Toolkit for the aircraft templates: load a template as a flat list of layers
# (full-canvas RGBA, bottom to top), switch options, cut and stretch fuselages,
# plug windows, and save standard layered Photoshop files.
import os
import re
import numpy as np
from PIL import Image, ImageChops, ImageFilter
from psd_tools import PSDImage

SRC = os.environ.get('ART_SRC', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')) + '/'
PAD = 300  # room around the canvas for stretched noses and tails

GEAR = re.compile(r'gear|strut|wheel|tire|tyre', re.I)
GEAR_UP = re.compile(r'gear[ _-]?up', re.I)
from config import JUNK as _J, METAL as _M, KEEP_METAL as _K
JUNK = re.compile(_J, re.I)
METAL = re.compile(_M, re.I)
KEEP_METAL = re.compile(_K, re.I)


CANVAS = [0, 0]


class L:
    """A layer: a cropped RGBA image at (x, y) on the canvas. .img gives the
    full-canvas image (made on demand); setting it crops it again."""

    def __init__(self, name, path, img, blend='NORMAL', visible=True, x=0, y=0):
        self.name, self.path, self.blend, self.visible = name, path, blend, visible
        self.part, self.x, self.y = img, x, y

    @property
    def img(self):
        o = Image.new('RGBA', tuple(CANVAS))
        if self.part is not None:
            o.paste(self.part, (self.x, self.y))
        return o

    @img.setter
    def img(self, full):
        bb = full.getbbox()
        if bb:
            self.part, self.x, self.y = full.crop(bb), bb[0], bb[1]
        else:
            self.part, self.x, self.y = None, 0, 0

    def copy(self, img=None):
        n = L(self.name, self.path, self.part.copy() if self.part is not None else None, self.blend, self.visible, self.x, self.y)
        if img is not None:
            n.img = img
        return n


def load(fname, show=(), hide=(), keep_gear=False):
    """Layers of a template. show/hide: regexes matched against the layer path
    ('GROUP/SUB/LAYER'); a group's choice applies to everything inside it."""
    psd = PSDImage.open(SRC + fname)
    W, H = psd.width + 2 * PAD, psd.height + 2 * PAD
    CANVAS[0], CANVAS[1] = W, H
    out = []

    def want(path, default):
        v = default
        for r in show:
            if re.search(r, path, re.I):
                v = True
        for r in hide:
            if re.search(r, path, re.I):
                v = False
        return v

    top_hide = {int(h[4:]) for h in hide if h.startswith('TOP:')}

    def walk(group, path, parent_visible, forced=False):
        base = None  # clipping base alpha
        for i, l in enumerate(group):
            nm = l.name.replace('\x00', '').strip()
            p = (path + '/' if path else '') + nm
            shown = any(re.search(r, p, re.I) for r in show)
            vis = want(p, True if (forced and not re.search(r'option', l.name, re.I)) else l.visible) and parent_visible
            if not path and i in top_hide:
                vis = False
            if l.kind == 'type':
                vis = False
            low = l.name.lower()
            if JUNK.fullmatch(l.name.strip()):
                vis = False
            if METAL.search(low) and not KEEP_METAL.search(low):
                vis = False
            if not keep_gear and GEAR.search(low) and not GEAR_UP.search(low):
                vis = False
            if l.is_group():
                walk(l, p, vis, forced or shown)
                base = None
                continue
            pil, raw = None, False
            if l.has_mask() or l.has_effects():
                try:
                    pil = l.composite(force=True)
                except Exception:
                    pil = None
            if pil is None:
                pil, raw = l.topil(), True
            if pil is None or not l.width or not l.height:
                continue
            pil = pil.convert('RGBA')
            # layer opacity, and Photoshop's separate Fill opacity (the same thing for a layer without effects)
            fill = getattr(l, 'fill_opacity', 255) if not l.has_effects() else 255
            k = (l.opacity if raw else 255) * fill
            if k != 255 * 255:
                a = np.asarray(pil.getchannel('A'), dtype=np.uint32) * k // (255 * 255)
                pil.putalpha(Image.fromarray(a.astype(np.uint8)))
            al = np.asarray(pil.getchannel('A'))
            if (al < 4).any() and (al > 0).any():
                pil.putalpha(Image.fromarray(np.where(al < 4, 0, al).astype(np.uint8)))  # stray near-invisible pixels
            x, y = l.left + PAD, l.top + PAD
            cb = pil.getbbox()
            if cb and (cb[2] - cb[0] < pil.width or cb[3] - cb[1] < pil.height):
                pil = pil.crop(cb)
                x, y = x + cb[0], y + cb[1]
            if l.clipping and base is not None:
                bx, by, ba = base
                m = Image.new('L', pil.size, 0)
                m.paste(ba, (bx - x, by - y))
                pil.putalpha(ImageChops.multiply(pil.getchannel('A'), m))
            elif not l.clipping:
                base = (x, y, pil.getchannel('A'))
            bb = pil.getbbox()
            if bb and (bb[2] - bb[0]) * (bb[3] - bb[1]) > 0.5 * psd.width * psd.height:
                a = np.asarray(pil.getchannel('A').crop(bb))
                if (a > 200).mean() > 0.95:
                    vis = False  # a solid background panel, not part of the plane
            if vis and bb:
                out.append(L(nm, p, pil, l.blend_mode.name, True, x, y))

    walk(psd, '', True)
    return W, H, out


# ---- blending ---------------------------------------------------------------
def _blend(dst, src, mode):
    """Photoshop-style separable blend of src over dst (both RGBA, same size)."""
    if mode == 'NORMAL':
        dst.alpha_composite(src)
        return
    d = np.asarray(dst, dtype=np.float32) / 255
    s = np.asarray(src, dtype=np.float32) / 255
    cb, ab = d[..., :3], d[..., 3:4]
    cs, as_ = s[..., :3], s[..., 3:4]
    if mode == 'MULTIPLY':
        B = cb * cs
    elif mode == 'LINEAR_LIGHT':
        B = np.clip(cb + 2 * cs - 1, 0, 1)
    elif mode == 'SOFT_LIGHT':
        B = np.where(cs <= 0.5, cb - (1 - 2 * cs) * cb * (1 - cb), cb + (2 * cs - 1) * (np.sqrt(cb) - cb))
    elif mode == 'SCREEN':
        B = 1 - (1 - cb) * (1 - cs)
    else:
        dst.alpha_composite(src)
        return
    as_ = as_ * ab   # blended layers only act on what is below them
    mix = (1 - ab) * cs + ab * B
    ao = as_ + ab * (1 - as_)
    co = np.where(ao > 0, (as_ * mix + (1 - as_) * ab * cb) / np.maximum(ao, 1e-6), 0)
    out = np.concatenate([co, ao], axis=-1)
    dst.paste(Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA'))


def render(W, H, layers, bg=None):
    c = Image.new('RGBA', (W, H), bg or (0, 0, 0, 0))
    for l in layers:
        if not l.visible or l.part is None:
            continue
        if l.blend == 'NORMAL':
            c.alpha_composite(l.part, (l.x, l.y))
        else:
            box = (l.x, l.y, l.x + l.part.width, l.y + l.part.height)
            sub = c.crop(box)
            _blend(sub, l.part, l.blend)
            c.paste(sub, box[:2])
    return c


# ---- column surgery (x in canvas pixels, PAD included) ----------------------
def _cols(img, x0, x1):
    return img.crop((x0, 0, x1, img.height))


def cut(img, x0, x1, keep='right'):
    """Remove columns x0..x1. keep='right': the part right of x1 stays put
    (nose moves back); keep='left': the part left of x0 stays (tail moves forward)."""
    W, H = img.size
    o = Image.new('RGBA', (W, H))
    w = x1 - x0
    if keep == 'right':
        o.paste(_cols(img, x1, W), (x1, 0))
        o.paste(_cols(img, 0, x0), (w, 0))
    else:
        o.paste(_cols(img, 0, x0), (0, 0))
        o.paste(_cols(img, x1, W), (x0, 0))
    return o


def plug(img, x, w, keep='right', src=None):
    """Insert a w-pixel plug at x, copied from columns src..src+w (default x..x+w).
    keep='right': right part stays, nose moves forward; keep='left': tail moves aft."""
    W, H = img.size
    s = x if src is None else src
    strip = _cols(img, s, s + w)
    o = Image.new('RGBA', (W, H))
    if keep == 'right':
        o.paste(_cols(img, x, W), (x, 0))
        o.paste(_cols(img, 0, x), (-w, 0))
        o.paste(strip, (x - w, 0))
    else:
        o.paste(_cols(img, 0, x), (0, 0))
        o.paste(_cols(img, x, W), (x + w, 0))
        o.paste(strip, (x, 0))
    return o


def shift(img, dx, dy=0):
    o = Image.new('RGBA', img.size)
    o.paste(img, (dx, dy))
    return o


def erase(img, box):
    o = img.copy()
    o.paste((0, 0, 0, 0), box)
    return o


def only(img, box):
    o = Image.new('RGBA', img.size)
    o.paste(img.crop(box), box[:2])
    return o


def plugged(img, alpha=10):
    """Windows turned into faint plugged outlines (as on converted freighters)."""
    m = img.getchannel('A').point(lambda v: 255 if v > 40 else 0)
    ring = ImageChops.subtract(m.filter(ImageFilter.MaxFilter(3)), m.filter(ImageFilter.MinFilter(3)))
    o = Image.new('RGBA', img.size, (20, 20, 20, 0))
    o.putalpha(ring.point(lambda v: alpha if v else 0))
    return o


def scaled_part(img, box, factor, at):
    """Cut box out of img, scale it, and place its top-left at `at` on a new canvas."""
    part = img.crop(box)
    part = part.resize((max(1, round(part.width * factor)), max(1, round(part.height * factor))), Image.LANCZOS)
    o = Image.new('RGBA', img.size)
    o.paste(part, at, part)
    return o


def apply(layers, fn, pred=lambda l: True):
    return [l.copy(fn(l.img)) if pred(l) else l for l in layers]


def find(layers, rx):
    return [l for l in layers if re.search(rx, l.path, re.I)]


def bbox(layers):
    b = None
    for l in layers:
        if l.part is None:
            continue
        bb = (l.x, l.y, l.x + l.part.width, l.y + l.part.height)
        if bb:
            b = bb if b is None else (min(b[0], bb[0]), min(b[1], bb[1]), max(b[2], bb[2]), max(b[3], bb[3]))
    return b

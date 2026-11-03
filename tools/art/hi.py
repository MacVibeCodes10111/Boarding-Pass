# Game pictures and paint masks at 1280 px wide (sharp on high-density screens).
import sys, os, json, re
sys.path.insert(0, '.')
import numpy as np
from PIL import Image
import masks as M
from standard import get, tight
from kit import render
W2 = 1280
os.makedirs('out/hi', exist_ok=True)


def one(i):
    r = get(i)
    W, H, ls = r
    im = render(W, H, ls)
    tb = tight(im)
    pic = im.crop(tb)
    h = round(pic.height * W2 / pic.width)
    pic.resize((W2, h), Image.LANCZOS).save(f'out/hi/{i}.webp', 'WEBP', quality=86, method=6)
    M.masks(i, W2, 'out/hi', r)
    return h


if __name__ == '__main__':
    from config import C
    from builds2 import BUILDS2
    ids = sys.argv[1:] or list(C) + list(BUILDS2)
    for i in ids:
        try:
            h = one(i)
            print(json.dumps(dict(id=i, h=h)), flush=True)
        except Exception as e:
            import traceback; traceback.print_exc()
            print(json.dumps(dict(id=i, error=str(e)[:200])), flush=True)

import sys, os, json
sys.path.insert(0, '.')
import numpy as np
from standard import get
from kit import render
from PIL import Image
from config import C
ids = sys.argv[1:] or [k for k in C]
out = {}
for i in ids:
    W, H, ls = get(i)
    im = render(W, H, ls)
    a = np.asarray(im.getchannel('A'))
    ys, xs = np.where(a > 24)
    pic = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    h = round(pic.height * 640 / pic.width)
    pic = pic.resize((640, h), Image.LANCZOS)
    pic.save(f'out/img/{i}.webp', 'WEBP', quality=82, method=6)
    print(i, h, flush=True)

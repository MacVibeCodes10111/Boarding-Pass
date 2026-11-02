# Downloads the aircraft side-view templates (Airline Empires community
# templates, Photoshop files) and writes, for each one, its layer tree and a
# small preview, so the game can use them. The Photoshop files are not kept.
import json, os, sys, urllib.request, time
from psd_tools import PSDImage

root = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(root, 'out')
os.makedirs(os.path.join(out, 'previews'), exist_ok=True)
dl = os.environ.get('PSD_DIR', '/tmp/psd')
os.makedirs(dl, exist_ok=True)
items = json.load(open(os.path.join(root, 'templates.json')))
report = []

def tree(layer, depth=0):
    lines = []
    for l in layer:
        b = l.bbox
        lines.append(f"{'  ' * depth}- [{l.kind}{'' if l.visible else ', hidden'}] {l.name!r} {b[2]-b[0]}x{b[3]-b[1]} at {b[0]},{b[1]}" + (f" blend={l.blend_mode.name}" if hasattr(l, 'blend_mode') else '') + (f" opacity={l.opacity}" if l.opacity != 255 else ''))
        if l.is_group():
            lines += tree(l, depth + 1)
    return lines

for it in items:
    slug = it['url'].split('/')[-1].split('?')[0]
    path = os.path.join(dl, urllib.request.unquote(slug))
    if not os.path.exists(path):
        for attempt in range(3):
            try:
                req = urllib.request.Request(it['url'], headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
                    f.write(r.read())
                break
            except Exception as e:
                print('download failed', it['name'], e, file=sys.stderr)
                time.sleep(5)
    if not os.path.exists(path):
        report.append(f"## {it['name']}: DOWNLOAD FAILED\n")
        continue
    try:
        psd = PSDImage.open(path)
        report.append(f"## {it['name']} ({os.path.basename(path)}, {os.path.getsize(path)//1024} kB, {psd.width}x{psd.height}, {psd.color_mode.name})")
        report += tree(psd)
        img = psd.composite()
        img.thumbnail((900, 900))
        img.save(os.path.join(out, 'previews', it['name'].replace('/', '-') + '.png'))
    except Exception as e:
        report.append(f"## {it['name']}: COULD NOT READ ({e})")
    report.append('')
    print('done', it['name'], flush=True)

open(os.path.join(out, 'report.md'), 'w').write('\n'.join(report))

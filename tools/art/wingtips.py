# Wingtip versions (2026-11): the same aircraft with other wingtips, from the
# options the templates already have (737 blended winglets and split scimitars,
# A320-family wingtip fences and sharklets, 757 and 767 winglets). Each version
# is its own picture and paint mask, public/aircraft/<id>~<wingtip>.webp and
# .mask.png; the picture in config.py (the type's usual wingtips) is unchanged.
# The game lists them in src/game/wingtips.ts and their sizes in aircraftPhotos.ts.
#   ART_SRC=<templates folder> python3 wingtips.py [<id>~<wingtip> ...]
import sys, json
sys.path.insert(0, '.')
from config import C

# id -> wingtip -> the template options for it (show/hide replace the type's own)
VERSIONS = {
    # the winglet goes with its own wing (WING_W), drawn to meet it
    'b737-300': {'winglet': dict(show=[r'^WINGLET$', r'^WING_W$'], hide=[r'^WING$'])},
    'b737-500': {'winglet': dict(show=[r'^WINGLET$', r'^WING_W$'], hide=[r'^WING$'])},
    'b737-700': {'none': dict(show=[]), 'scimitar': dict(show=[r'^SCIMITAR'])},
    'b737-800': {'none': dict(show=[]), 'scimitar': dict(show=[r'^SCIMITAR'])},
    'b737-900': {'none': dict(show=[])},
    # its template has no wing without winglets
    'b737-900er': {'scimitar': dict(show=[r'^SCIMITAR'], hide=[r'^WINGLET'])},
    'a319-100': {'sharklet': dict(show=[r'^CFM/SHARKLET'], hide=[r'^CFM/WING FENCE'])},
    'a320-200': {'sharklet': dict(show=[r'^CFM/SHARKLET'], hide=[r'^CFM/WING FENCE'])},
    'a321-100': {'sharklet': dict(show=[r'^IAE/SHARKLET'], hide=[r'^IAE/WING FENCE'])},
    'a321-200': {'sharklet': dict(show=[r'^IAE/SHARKLET'], hide=[r'^IAE/WING FENCE'])},
    'b757-200': {'none': dict(show=[r'^RR$'], hide=[r'^RR_WINGLET'])},
    'b757-300': {'none': dict(show=[r'^RR$'], hide=[r'^RR_WINGLET'])},
    'b767-300er': {'none': dict(show=[])},
    'b767-300f': {'winglet': dict(show=[r'^GE/WINGLET'])},
    'b727-200f': {'winglet': dict(show=[r'^WINGLET'])},
    'b737-800bcf': {'winglet': dict(show=[r'^WINGS/WINGLET'], hide=[r'^WINGS/SCIMITAR']), 'none': dict(show=[r'^WINGS/WING_STD'], hide=[r'^WINGS/SCIMITAR'])},
    'a321-p2f': {'sharklet': dict(show=[r'^CEO CFM/SHARKLET'], hide=[r'^CEO CFM/WING FENCE'])},
    'e175': {'enhanced': dict(show=[r'^ENHANCED WINGLET'], hide=[r'^STANDARD WINGLET'])},
    'e175lr': {'enhanced': dict(show=[r'^ENHANCED WINGLET'], hide=[r'^STANDARD WINGLET'])},
    # made from parts of templates (builds.py): the options go on the template they start from
    'a320-p2f': {'sharklet': dict(file='Airbus A320.psd', show=[r'^CFM/SHARKLET'], hide=[r'^CFM/WING FENCE'])},
    'b737-300sf': {'winglet': dict(file='Boeing 737-300.psd', show=[r'^WINGLET$', r'^WING_W$'], hide=[r'^WING$'])},
}

for i, vs in VERSIONS.items():
    for v, opt in vs.items():
        if 'file' not in opt:
            C[f'{i}~{v}'] = {**C[i], **opt}
        else:
            C[f'{i}~{v}'] = dict(C[i], options=opt)


def build(i):
    """Builds one version, with any template options switched on while it's made."""
    import hi, kit
    opt = C[i].get('options')
    if opt:
        kit.OPTIONS[opt['file']] = dict(show=opt.get('show', ()), hide=opt.get('hide', ()))
    try:
        return hi.one(i)
    finally:
        kit.OPTIONS.clear()

if __name__ == '__main__':
    ids = sys.argv[1:] or [f'{i}~{v}' for i, vs in VERSIONS.items() for v in vs]
    for i in ids:
        try:
            print(json.dumps(dict(id=i, h=build(i))), flush=True)
        except Exception as e:
            import traceback; traceback.print_exc()
            print(json.dumps(dict(id=i, error=str(e)[:200])), flush=True)

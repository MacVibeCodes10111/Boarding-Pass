# Part masks (v2.66) at 1280 wide for every aircraft, into out/m2/.
import sys, os, json
sys.path.insert(0, '.')
import masks as M
from standard import get
os.makedirs('out/m2', exist_ok=True)
if __name__ == '__main__':
    from config import C
    from builds2 import BUILDS2
    ids = sys.argv[1:] or list(C) + list(BUILDS2)
    for i in ids:
        try:
            print(json.dumps(M.masks(i, 1280, 'out/m2', get(i))), flush=True)
        except Exception as e:
            import traceback; traceback.print_exc()
            print(json.dumps(dict(id=i, error=str(e)[:200])), flush=True)

# Aircraft pictures

How `public/aircraft/*.webp` are made (Python 3 with `psd-tools`, `numpy`, `scipy`, `Pillow`).

1. Put the Airline Empires community templates (Photoshop files, see `templates.json` for the list and their makers) in `tools/art/templates/`.
2. `python3 standard.py` makes, for every aircraft in `config.py`, a standard layered Photoshop file in `out/psd/` and the game picture in `out/img/`:
   - 8:3 canvas, plane centred, gear up, plain white, no background or ground shadow;
   - layers grouped as ANTENNAS, TAIL, FUSELAGE, WINGS, ENGINES, DETAILS, each with BASE (the paintable surface), DETAILS, DOORS & WINDOWS and EFFECTS (shading). Layers keep their order wherever they overlap, so the picture looks exactly like the template.
3. Copy `out/img/*.webp` to `public/aircraft/` and list them in `src/game/aircraftPhotos.ts`.

`builds.py` makes the variants with no template of their own from their nearest relatives (737 MAX 7/9/8-200, A350F, 777-8F, converted freighters, Tu-214, Il-96-400T, ERJ-145XR). `builds2.py` puts together the types with no template from parts of several (An-26, Hercules and the small types from the CN-235, Jetstream, Twin Otter, Islander and PC-24), and the C909 freighter and Caravan cargo from their real templates. A config entry with `clip=True` trims soft shading that spills past the aircraft (made to sit on the artist's white background); `hi.py` makes the 1280-wide game pictures and paint masks.

`draw.py` and `specs.py` are an older from-scratch drawing that is no longer used.

Two template fixes run on every build: masks on layer groups are respected (`load` in `kit.py`; without them a group's shading spills out as dark patches), and `SOFT_TAIL` in `config.py` lists the types whose heavy dark shape at the tailplane root gets faded (`soften_tail`). To rebuild only some types: `ART_SRC=<templates folder> python3 hi.py <id> <id>`, copy `out/hi/<id>.webp` and `out/hi/<id>.png` (as `<id>.mask.png`) to `public/aircraft/`, run `winglets.py`'s `fix`/`clear` on any mask in its lists, and check the size still matches `aircraftPhotos.ts`.

The templates are the work of their artists (credited in the game's Credits screen and in THIRD_PARTY_NOTICES.md); they are not kept in this repository.

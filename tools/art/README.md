# Aircraft pictures

How `public/aircraft/*.webp` are made (Python 3 with `psd-tools`, `numpy`, `scipy`, `Pillow`).

1. Put the Airline Empires community templates (Photoshop files, see `templates.json` for the list and their makers) in `tools/art/templates/`.
2. `python3 standard.py` makes, for every aircraft in `config.py`, a standard layered Photoshop file in `out/psd/` and the game picture in `out/img/`:
   - 8:3 canvas, plane centred, gear up, plain white, no background or ground shadow;
   - layers grouped as ANTENNAS, TAIL, FUSELAGE, WINGS, ENGINES, DETAILS, each with BASE (the paintable surface), DETAILS, DOORS & WINDOWS and EFFECTS (shading). Layers keep their order wherever they overlap, so the picture looks exactly like the template.
3. Copy `out/img/*.webp` to `public/aircraft/` and list them in `src/game/aircraftPhotos.ts`.

`builds.py` makes the variants with no template of their own from their nearest relatives (737 MAX 7/9/10/8-200, 717, A350F, 777-8F, converted freighters, Tu-214, Il-96-400T, ERJ-145XR). `draw.py` and `specs.py` draw the remaining types from scratch; those drawings are not used in the game yet.

The templates are the work of their artists (credited in the game's Credits screen and in THIRD_PARTY_NOTICES.md); they are not kept in this repository.

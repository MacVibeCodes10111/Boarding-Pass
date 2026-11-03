# Aircraft pictures

How `public/aircraft/*.webp` are made (Python 3 with `psd-tools`, `numpy`, `scipy`, `Pillow`).

1. Put the Airline Empires community templates (Photoshop files, see `templates.json` for the list and their makers) in `tools/art/templates/`.
2. `python3 standard.py` makes, for every aircraft in `config.py`, a standard layered Photoshop file in `out/psd/` and the game picture in `out/img/`:
   - 8:3 canvas, plane centred, gear up, plain white, no background or ground shadow;
   - layers grouped as ANTENNAS, TAIL, FUSELAGE, WINGS, ENGINES, DETAILS, each with BASE (the paintable surface), DETAILS, DOORS & WINDOWS and EFFECTS (shading). Layers keep their order wherever they overlap, so the picture looks exactly like the template.
3. Copy `out/img/*.webp` to `public/aircraft/` and list them in `src/game/aircraftPhotos.ts`.

`builds.py` makes the variants with no template of their own from their nearest relatives (737 MAX 7/9/10/8-200, 717, A350F, 777-8F, converted freighters, Tu-214, Il-96-400T, ERJ-145XR). `builds2.py` puts together the types with no close template from parts of several (A220 from the E195-E2, C919 and MC-21 from the A320neo and A321neo, C909 from the MD-87 with CRJ engines, An-24 and MA60 from the F27, An-26, An-12, Hercules, Il-76 and An-124 from the CN-235, the small types from the Jetstream, Twin Otter, Islander, Skyhawk and PC-24). `draw.py` and `specs.py` are an older from-scratch drawing that is no longer used.

The templates are the work of their artists (credited in the game's Credits screen and in THIRD_PARTY_NOTICES.md); they are not kept in this repository.

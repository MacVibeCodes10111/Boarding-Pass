# Boarding Pass: notes for Claude

A free airline manager game: web (play.boardingpass.my), Mac and Windows apps. React + TypeScript + Vite, Tauri 2 for the apps (`src-tauri/`), the website in `website/`.

## How Mac likes to work
- Plain words, short summaries, results not process. Keep replies lean.
- Show screenshots of visible changes before pushing, so they can be tweaked.
- Push only when asked. "Push to dev" = test builds; "push to main" = a release.
- Never write the owner's full name anywhere (credits say "Mac").

## Commands
- `npm install`, `npm run dev` (Vite), `npm run build`
- Typecheck: `npx tsc --noEmit -p .`
- Apps: `cd src-tauri && cargo check`; `npm run tauri dev` to run the Mac app
- Test liveries and pictures in real Safari (Mac and iPhone): most livery bugs have been Safari-only.

## Branches and releases
- `dev`: test builds (`.github/workflows/dev-build.yml`, `play-build.yml`). `main`: releases; `release.yml` runs when `src-tauri/tauri.conf.json` changes.
- Always `git fetch` first and fast-forward (or rebase). Never force-push; keep Mac's own GitHub edits.
- A release bumps the version in: `package.json`, `package-lock.json` (top), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the boarding-pass entry), `src/version.ts`, and README (version line + "What's new", written for players).
- Before every push: typecheck, `npm test`, build, `cargo check`, and search the diff for `PRIVATE KEY`, `rsign encrypted` and `TAURI_SIGNING_PRIVATE_KEY=`.

## Never
- Commit or package keys or secrets (Tauri signing key, Supabase secret/service-role key, OAuth secrets: those live only in the dashboards).
- Change the updater public key in `tauri.conf.json`.
- Break old saves: everything loaded from a save goes through a `normalise...` function.

## Liveries and aircraft pictures
- Pictures: `public/aircraft/<id>.webp` (1280 wide) and `<id>.mask.png` (twice the height: top half tail/fuselage/engines in R/G/B, bottom half wings/wingtips/tailplane). Sizes in `src/game/aircraftPhotos.ts`; load them with `aircraftArt()` (versioned URLs, so browsers don't keep old files).
- Made from the Airline Empires community templates with `tools/art/` (see its README; templates aren't in the repo, point `ART_SRC` at them). New artists go in `config.py` BY, Credits.tsx and THIRD_PARTY_NOTICES.md.
- Painting: `src/game/liveryPaint.ts` blends in code (no canvas-to-canvas copies: Safari drew those blank). Editor: `src/components/livery/LiveryEditor.tsx`.
- The editor paints tail, fuselage, engines and wingtips only. Layers can have per-aircraft-type changes (`only`, `adj`, see `layerFor` in `src/game/livery.ts`).

## Cloud
- Cloud saves and accounts (Supabase, `src/game/cloud.ts`) are LIVE with real players. Treat changes to them, and to the server functions (which live only in the Supabase project, not this repo), as affecting real data.
- Logo uploads (Cloudflare Worker in `cloud/`) exist but aren't deployed.
- The test site is `test.boardingpass.my`.

## Tests
- `npm test` covers saves, cloud conflicts and the economy clock. Run it before every push.

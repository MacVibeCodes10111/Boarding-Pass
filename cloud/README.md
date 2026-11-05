# How the online parts fit together

**Supabase** (project `boarding-pass`) holds accounts and data: cloud saves, and for the online updates profiles, friends, alliances, reports and the marketplace. **Cloudflare** holds files: logos in R2, through the Worker in `logos-worker/`, and the schedules behind other airlines on the map.

Cloud saves are live with real players. The database they use is the one everything below is added to.

## Rules

- **Nothing shared without asking.** Every sharing choice is off until the player turns it on (`src/game/features.ts`). A player who never signs in sends nothing anywhere, which the privacy policy promises, so flags are only read after sign-in.
- **The server decides.** The game is on the player's device and can be changed, so every limit and check is repeated on the server, and everything read from another player is checked again before it's used or drawn.
- **Players can't touch tables directly.** Row Level Security is on everywhere. Anything that changes data goes through `security definer` functions with `search_path = ''`, which check the signed-in player (`auth.uid()`) and that the feature is on (`private.feature_on`).
- **Dev stays separate.** Dev builds and the test site use channel `dev` and never exchange data with the real game.
- **Keys.** The publishable key in the game is public by design. The service-role key stays in the dashboards. A Worker that has to remove files for an account that no longer exists keeps its key as a Cloudflare secret.
- **Keep the legal promises.** `website/terms.html` and `privacy.html` say what players are promised. If something would go beyond them, stop and update them first.

## Feature flags

`public.features` has one row per channel and feature, and a missing row means off. To switch one, edit its row in the Supabase dashboard (Table Editor → features). Features: `online`, `profiles`, `logos`, `friends`, `friends_map`, `alliances`, `reports`, `marketplace`.

The server functions live only in the Supabase project. Scripts for changes made since A0 are kept in `supabase/`, one file per change, in date order.

## Decided for the updates ahead

- Other airlines' schedules go in R2 and are read through Cloudflare, not from Supabase: 20 friends at 200 KB each would use up Supabase's 5 GB a month in about 1,250 refreshes across all players. Republish only when a schedule changes.
- A player shares one career, which they choose, because an account can have up to 10.
- Friends are found by friend code. A username is half of a password sign-in, and the terms promise other players never see sign-in details.
- Script-blocking rules (Content-Security-Policy) are in `vite.config.ts` for the web game and `src-tauri/tauri.conf.json` for the apps. A new outside address has to be added to both.

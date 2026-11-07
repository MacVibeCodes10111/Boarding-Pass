# How the online parts fit together

**Supabase** (project `boarding-pass`) holds accounts and data: cloud saves, and for the online updates profiles, friends, alliances, reports and the marketplace. **Cloudflare** holds files: logos in R2, through the Worker in `logos-worker/`, and the schedules behind other airlines on the map.

Cloud saves are live with real players. The database they use is the one everything below is added to.

## Rules

- **The Online window** (`src/components/OnlinePanel.tsx`) is separate from Cloud saves, and asks a player to open the legal documents and agree before signing in or going further. Change `LEGAL_VERSION` in `src/game/features.ts` when they change in a way players should see again.
- **Nothing shared without asking.** Every sharing choice is off until the player turns it on, and kept on the server so every device agrees. A player who never signs in sends nothing anywhere, which the privacy policy promises, so flags are only read after sign-in.
- **The server decides.** The game is on the player's device and can be changed, so every limit and check is repeated on the server, and everything read from another player is checked again before it's used or drawn.
- **Players can't touch tables directly.** Row Level Security is on everywhere. Anything that changes data goes through `security definer` functions with `search_path = ''`, which check the signed-in player (`auth.uid()`) and that the feature is on (`private.feature_on`).
- **Dev stays separate.** Dev builds and the test site use channel `dev` and never exchange data with the real game.
- **Keys.** The publishable key in the game is public by design. The service-role key stays in the dashboards. A Worker that has to remove files for an account that no longer exists keeps its key as a Cloudflare secret.
- **Keep the legal promises.** `website/terms.html` and `privacy.html` say what players are promised. If something would go beyond them, stop and update them first. They promise that reports and the admin log are deleted after 12 months at most, and that those records and marketplace trades (with a placeholder) outlast account deletion, so A5 to A6 and B must do exactly that. There's no chat of any kind. If a breach happens, follow `INCIDENT-PLAN.md`.

## Feature flags

`public.features` has one row per channel and feature, and a missing row means off. To switch one, edit its row in the Supabase dashboard (Table Editor → features). Features: `online`, `profiles`, `logos`, `friends`, `friends_map`, `alliances`, `reports`, `marketplace`.

The server functions live only in the Supabase project. Scripts for changes made since A0 are kept in `supabase/`, one file per change, in date order.

## Building and testing

New server code goes in the build project (`boarding-pass-build`) first; the live project only gets it at a checkpoint, once tested. To point `npm run dev` at the build project, put its address and publishable key in `.env.development.local` as `VITE_BP_SUPABASE_URL` and `VITE_BP_SUPABASE_KEY` (dev mode only, so it can't end up in a build). The build project has only what online features rely on, with stand-ins for the cloud save functions.

The word filter on the server is made from `src/game/moderation.ts`. After changing its lists, run `npx vitest -u`, then run `supabase/moderation.sql` in both projects and check with `supabase/moderation-check.sql` (no rows means they agree). It treats letters spaced with two or more spaces (`a  s  s`) as separate words, on the server and in the game.

## Airlines (since 2026-11-07)

`supabase/2026-11-07-airlines.sql` and `logos-worker/migrate-2026-11-07.sql`. Everything online belongs to a shared airline, not to an account: each row of `profiles` (up to 10 per player) has its own `public_id`, friend code, friends, map setting and logos. Sharing happens inside a career (the Online window there uploads it); on the main menu the player picks which shared airline to look at. Every call is made as one of the player's airlines (`p_me`), and the server checks it's theirs. Blocks are between players, so blocking reaches all of their airlines. Each airline is Career or Sandbox (`mode`; an edited or imported save is Sandbox), and the two never meet: friends and alliances now, the marketplace later. Changing an airline's mode removes its friends. Save files: the game no longer exports them, and an old one always opens as a new Sandbox career.

A friend's aircraft has an Airline button that opens their airline: liveries, stats, route map and fleet, all worked out from what they already share (`src/components/FriendAirline.tsx`, `src/game/friendAirline.ts`). Nothing new is sent for it.

To go live, in this order: run `2026-11-07-airlines.sql` on the live project (the dev builds out there stop working online until step 4), run `migrate-2026-11-07.sql` on the remote D1 and set `airline` on the old `logo_owners` rows to the owner's airline's `public_id`, deploy the Worker, push `dev`, then republish the legal pages.

## Logos

Logos are square PNG or WebP, kept at their own size up to 1024×1024 and 48 KB (`MAX_LOGO_BYTES` in `src/game/livery.ts` and the Worker; bigger pictures are saved smaller until they fit). They're in the save too, so 48 KB keeps a career with every logo slot filled to about 0.7 MB, well under what a browser keeps. The R2 cap (9.5 GB) holds about 200,000 of them.

The pictures live in R2, through the Worker in `logos-worker/` (its README covers deploying and reviewing). A profile names each logo by the hash of its picture, so no picture data goes in the database, and a player's own copy stays in their save, so playing never depends on the Worker. New logos are hidden until approved. Stopping sharing removes logos straight away; if the Worker can't be reached, and for deleted accounts, Supabase keeps a removal list that the Worker's nightly job clears.

To try it locally, run the Worker with `npx wrangler dev` and add `VITE_BP_LOGOS_URL=http://localhost:8787` to `.env.development.local`.

## Friends

`supabase/2026-11-06-friends.sql`, made per airline by `2026-11-07-airlines.sql`. Airlines are known by their `public_id` in `profiles`, never the account number, and find each other by friend code only. One row per pair in `friendships`, and everything goes through functions. Limits, all on the server: 100 friends, 50 requests waiting either way, 20 tries a day including failed ones, 5 new codes a day, and a week's wait after a refusal. A blocked player gets the same answer as a code that doesn't exist. `private.friends_cleanup` clears old requests each night (`pg_cron`).

## Friends' aircraft

`supabase/2026-11-06-friends-map.sql` and `logos-worker/src/schedules.ts`. Off until the player turns it on (`profiles.map_on`, per airline), and it goes off when they stop sharing their airline. The weekly schedule is one small file in R2, and the viewer's game flies it on the viewer's own clock (`src/game/friendsMap.ts`, `scheduleSnapshot.ts`). On every read, `friends_on_map` says who that viewer may see, so a block, a removal or turning it off works on the next refresh, every 10 minutes at most while a map is open. Nothing of a friend's is saved on the viewer's device.

To go live: run both scripts, run `schema.sql` on D1, deploy the Worker, then turn on `friends` and `friends_map`, in that order. The Worker has to be deployed before `friends_map` goes on, because an older one reads a schedule removal as "remove the logos too".

## Alliances

`supabase/2026-11-07-alliances.sql` (needs `2026-11-07-airlines.sql` first). Tables `alliances`, `alliance_members` (one alliance per airline) and `alliance_invites`, and a history in `private.alliance_events`, all reached only through the `alliance_*` functions. Up to 20 airlines, counting invites; all Career or all Sandbox (changing an airline's mode takes it out). Only the leader's airline's friends can be invited, 30 changes a day per player. When the last airline leaves, the alliance goes; when the leader goes, the longest-standing airline leads. Blocks hide airlines from each other inside an alliance but they still count. `friends_on_map` adds up to 19 airlines from the viewer's alliance to the 20 friends (each marked `ally`), and `friend_liveries` lets allies see each other's liveries; the Worker passes the new fields through unchanged, so it needs no change. A friend's card carries their alliance's name, tag, colours, logo and size. `private.alliances_cleanup` drops invites after 30 days and history after 12 months (`pg_cron`, 04:41). There are no messages. The game side is `src/game/alliances.ts` and `src/components/AlliancesTab.tsx`.

To go live: run `2026-11-07-alliances.sql` on the live project, republish the legal pages (they mention alliances), then turn on `alliances` for `dev`, later `main`. With the flag off the tab says they're on the way, and every function answers `off`.

## Decided for the updates ahead

- Other airlines' schedules go in R2 and are read through Cloudflare, not from Supabase: 20 friends at 200 KB each would use up Supabase's 5 GB a month in about 1,250 refreshes across all players. Republish only when a schedule changes.
- A player shares the careers they choose, up to 10, each as its own airline (changed 2026-11-07; it was one per player).
- Friends are found by friend code. A username is half of a password sign-in, and the terms promise other players never see sign-in details.
- Script-blocking rules (Content-Security-Policy) are in `vite.config.ts` for the web game and `src-tauri/tauri.conf.json` for the apps. A new outside address has to be added to both.

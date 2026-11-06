# Logos Worker

Keeps players' livery logos (still PNG or WebP, 128×128, at most 16 KB) in the R2 bucket `bplogos`, so other players can see them once they're approved.

- **Names:** a logo is stored under the SHA-256 of its bytes, worked out by the Worker. The same picture is stored once, and is removed when its last player stops using it.
- **Review:** new pictures are `pending` and can't be fetched. A `rejected` picture's file is removed overnight and its record stays, so it can't be uploaded again. Browsers keep an approved logo for up to a day, so a later refusal takes up to a day to reach everyone.
- **Hard cap:** the whole bucket stops at 9.5 GB, under R2's 10 GB free storage. The total lives in the D1 database `bp-uploads` and goes up in one conditional update, so no upload, or many at once, can pass it.
- **Limits per player:** 10 logos per channel, 40 uploads a day.
- **Flag:** uploading asks Supabase whether `logos` is on. Removing always works.
- **Nightly job:** takes the removal list from Supabase (players who stopped sharing or deleted their account). Its key, `CLEANUP_KEY`, can only read and clear that list, so the Worker doesn't need the service-role key.

## Deploying

Needs `../supabase/2026-11-05-logos.sql` in Supabase first. From this folder:

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 execute bp-uploads --remote --file schema.sql`
4. `npx wrangler deploy`. Its address, `https://bp-logos.boardingpass-game.workers.dev`, is in `LOGOS_URL` in `src/game/cloud.ts`, and in `connect-src` in `vite.config.ts` and `src-tauri/tauri.conf.json`.
5. `sh setup-cleanup-key.sh`, then run the line it prints in the Supabase SQL editor.

## Reviewing logos

The review screen comes with the admin site (A6). Until then, in the D1 console:

```sql
SELECT hash, bytes, created_at FROM logo_files WHERE status = 'pending' ORDER BY created_at;
UPDATE logo_files SET status = 'approved', reviewed_at = unixepoch() * 1000 WHERE hash = '...';
UPDATE logo_files SET status = 'rejected', reviewed_at = unixepoch() * 1000 WHERE hash = '...';
```

To see a pending picture, open its hash in the R2 bucket `bplogos` in the Cloudflare dashboard.

## Trying it locally

`npx wrangler dev` uses local copies of R2 and D1, never the real ones. Create the tables with `npx wrangler d1 execute bp-uploads --local --file schema.sql`, and use `--var SUPABASE_URL:... --var SUPABASE_KEY:...` to point it at the build project.

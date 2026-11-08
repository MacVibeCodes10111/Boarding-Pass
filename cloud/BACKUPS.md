# Backups

The free Supabase plan has no backups you can download, so take one by hand: once a week, and before any SQL change on the live project. Each takes about two minutes.

Backups hold player data. Keep them on your own Mac, outside this repo (for example `~/Boarding Pass backups/`), never in git or a shared folder. Keep only the last 4 weekly ones and delete older ones, so nothing outlives what the privacy policy promises (reports and the admin log go after 12 months at most, and a closed account's data goes with it).

## 1. Everything online (Supabase)

Shared airlines, friends, blocks, alliances, the marketplace, reports, notices and the admin log.

1. Supabase dashboard → the live project → SQL Editor.
2. Paste `cloud/backup-export.sql` and run it. It only reads.
3. Copy the one cell it returns into `online-YYYY-MM-DD.json`.

## 2. Cloud saves (optional, bigger)

Players keep their own copies on their devices, so these matter less. Dashboard → Table Editor → `cloud_saves` → Export → CSV, saved as `cloud-saves-YYYY-MM-DD.csv`.

## 3. Schedules and logo records (Cloudflare D1)

From `cloud/logos-worker` (never the repo root):

```sh
cd cloud/logos-worker
npx wrangler d1 export bp-uploads --remote --output ~/"Boarding Pass backups"/d1-YYYY-MM-DD.sql
```

## 4. Logo pictures (Cloudflare R2)

Each player's logos are also in their own save, so these can be uploaded again if lost. To copy them anyway: Cloudflare dashboard → R2 → `bplogos`, or any S3 tool (such as rclone) with an R2 API token made for read-only access.

## Restoring

Ask Claude to restore from a backup file into the build project first, check it there, then into live. Never paste a whole backup into the live SQL Editor by hand.

# Logo uploads Worker

Stage 2 of liveries: keeps players' livery logos (128×128, at most 16 KB) in
the R2 bucket `bplogos`, so other players can see them.

- **Hard cap:** the whole bucket stops at 9.5 GB, under R2's 10 GB free
  storage. The total lives in the D1 database `bp-uploads` and goes up in one
  conditional update, so no upload, or many at once, can pass it.
- **Limits per player:** 2 liveries × 5 logos per career, 10 careers,
  40 uploads a day.
- **Only PNG or WebP**, checked from the file itself, exactly 128×128. No SVG.
- **No secrets:** sign-ins are checked with Supabase's public keys.

Deploy from this folder: `npm install`, then `npx wrangler deploy`
(or paste `src/index.ts` into a new Worker in the dashboard and add the R2
binding `LOGOS` → `bplogos` and the D1 binding `DB` → `bp-uploads`).

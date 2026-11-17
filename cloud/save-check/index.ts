// ============================================================================
// SAVE CHECK (Supabase server function, 2026-11-17)
//   Called every minute by the database's schedule (cloud/supabase/
//   2026-11-17-save-check.sql), with a key that lives only in the database.
//   Reads the Careers that changed, works out their figures from the save
//   itself (src/game/saveStats.ts) and judges them against the copy before
//   (src/game/saveCheck.ts). Flags only: it never changes a save.
//
//   Built into one file with `npm run save-check:build` (esbuild) and deployed
//   to Supabase with JWT checks off: the key above is the check. The service
//   role key comes from Supabase's own settings, never from this repo.
// ============================================================================
import { judgeSave } from '../../src/game/saveCheck';
import { saveStats, type SaveStats } from '../../src/game/saveStats';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Response | Promise<Response>): void };

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
/** The service role: the legacy key, or the newer secret key. */
function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    return keys.default ?? Object.values(keys)[0] ?? '';
  } catch {
    return '';
  }
}

async function rpc<T>(name: string, args: unknown): Promise<T> {
  const key = serviceKey();
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  if (!key.startsWith('sb_')) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return (await res.json()) as T;
}

type Row = { user: string; channel: string; saveId: string; rev: number; data: string; pushedAt: number; prev: SaveStats | null; grants: number };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('', { status: 405 });
  const key = req.headers.get('x-check-key') ?? '';
  try {
    if (key.length < 32 || !(await rpc<boolean>('save_check_key_ok', { p_key: key }))) return new Response('', { status: 401 });
    const rows = await rpc<Row[]>('save_check_take', {});
    const out = rows.map((r) => {
      const st = saveStats(r.data, r.saveId);
      const elapsed = r.prev?.pushedAt ? Number(r.pushedAt) - Number(r.prev.pushedAt) : null;
      // Test builds have a fast testing speed, so game time running ahead is only a flag on the live game
      const flags = judgeSave(r.prev, st, elapsed, Number(r.grants) || 0).filter((f) => r.channel === 'main' || f !== 'time');
      return { user: r.user, channel: r.channel, saveId: r.saveId, rev: r.rev, stats: { ...st, ...(flags.length ? { flags } : {}) } };
    });
    const checked = out.length ? await rpc<number>('save_check_put', { p_rows: out }) : 0;
    return Response.json({ checked });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return new Response('', { status: 500 });
  }
});

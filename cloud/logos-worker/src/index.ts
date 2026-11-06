// ============================================================================
// BOARDING PASS LOGOS (Update A, phase A2)
//   PUT    /logo?channel=main|dev        a 128×128 still WebP or PNG, ≤ 16 KB
//   POST   /logo/sync?channel=…          { keep: [hash…] } drops the player's others
//   GET    /logo/mine?channel=…          the player's logos and their review status
//   DELETE /logo?channel=…                drops all the player's logos
//   GET    /logo/<hash>                  anyone: the picture, once approved
//
//   A logo's name is the SHA-256 of its bytes, worked out here, so a file never
//   changes and the same picture is stored once however many players use it.
//   New pictures wait for review and can't be fetched until they're approved. A
//   refused picture's file is removed, and its hash stays so it can't come back.
//
//   Signed-in players only (their Supabase token, checked with Supabase's public
//   keys). Uploading also asks Supabase whether the `logos` flag is on; removing
//   always works. The bucket has a hard cap: the running total is kept in D1 and
//   raised in one conditional update, so no upload can take it past CAP_BYTES.
//
//   Each night it takes the removal list from Supabase (stopped sharing, deleted
//   accounts) and clears out refused files. CLEANUP_KEY opens only that list.
// ============================================================================
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Env {
  LOGOS: R2Bucket;
  DB: D1Database;
  SUPABASE_URL: string;
  /** Supabase's publishable key: public by design. */
  SUPABASE_KEY: string;
  ALLOWED_ORIGINS: string;
  /** A Cloudflare secret (setup-cleanup-key.sh). Without it the nightly job does nothing. */
  CLEANUP_KEY?: string;
}

/** Hard cap on everything in the bucket: under R2's 10 GB free storage, with room for R2's own overhead. */
const CAP_BYTES = 9_500_000_000;
const MAX_LOGO_BYTES = 16 * 1024;
const LOGO_PX = 128;
/** Two liveries of five logos, for the one career a player shares. */
const MAX_LOGOS_PER_PLAYER = 10;
const MAX_UPLOADS_PER_DAY = 40;
const DAY_MS = 86_400_000;
/** Not "immutable": a logo refused after approval has to drop out of browsers' caches. */
const SERVE_CACHE = 'public, max-age=86400';
const HASH = /^[0-9a-f]{64}$/;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

type Cors = Record<string, string>;
const json = (status: number, body: unknown, cors: Cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });

function corsFor(req: Request, env: Env): Cors {
  const origin = req.headers.get('origin') ?? '';
  const ok = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin);
  return ok
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '86400', vary: 'origin' }
    : { vary: 'origin' };
}

const tokenOf = (req: Request) => {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
};

async function userOf(req: Request, env: Env): Promise<string | null> {
  const token = tokenOf(req);
  if (!token) return null;
  jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${env.SUPABASE_URL}/auth/v1`, audience: 'authenticated' });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** A Supabase function, as the anonymous visitor unless a player's token is given. Null if it failed. */
async function rpc(env: Env, name: string, args: unknown, token?: string): Promise<{ data: unknown } | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    return { data: await res.json() };
  } catch {
    return null;
  }
}

/** The picture's type and size from its bytes (a still PNG or WebP), or null. Animation could hide what a reviewer saw. */
export function sniff(b: Uint8Array): { type: 'image/png' | 'image/webp'; w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length > 24 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x) && tag(12) === 'IHDR') {
    for (let o = 8; o + 8 <= b.length; o += 12 + dv.getUint32(o)) {
      if (tag(o + 4) === 'acTL') return null;
      if (tag(o + 4) === 'IDAT') break;
    }
    return { type: 'image/png', w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  if (b.length > 30 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const chunk = tag(12);
    if (chunk === 'VP8X') return b[20] & 0x02 ? null : { type: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8L') {
      const v = dv.getUint32(21, true);
      return { type: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { type: 'image/webp', w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
  }
  return null;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** Removes a file nobody uses any more, and lowers the total. A refused one's record stays, so it can't be uploaded again. */
async function release(env: Env, hash: string) {
  const gone = await env.DB.prepare("DELETE FROM logo_files WHERE hash = ?1 AND status <> 'rejected' AND NOT EXISTS (SELECT 1 FROM logo_owners WHERE hash = ?1) RETURNING bytes")
    .bind(hash)
    .first<{ bytes: number }>();
  if (!gone) return;
  await env.LOGOS.delete(hash);
  await env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - 1) WHERE id = 1').bind(gone.bytes).run();
}

async function upload(req: Request, env: Env, user: string, channel: string, cors: Cors): Promise<Response> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_LOGO_BYTES) return json(413, { error: 'a logo can be 16 KB at most' }, cors);
  const buf = await req.arrayBuffer();
  const body = new Uint8Array(buf);
  if (!body.length || body.length > MAX_LOGO_BYTES) return json(413, { error: 'a logo can be 16 KB at most' }, cors);
  const pic = sniff(body);
  if (!pic) return json(415, { error: 'logos must be still PNG or WebP pictures' }, cors);
  if (pic.w !== LOGO_PX || pic.h !== LOGO_PX) return json(422, { error: `logos must be ${LOGO_PX}×${LOGO_PX}` }, cors);

  // The server's own switch: the game can be changed, so its flags can't be relied on
  const gate = await rpc(env, 'logo_gate', { p_channel: channel }, tokenOf(req));
  if (!gate) return json(503, { error: 'logos can’t be uploaded right now; try again later' }, cors);
  if (gate.data !== true) return json(403, { error: 'logos aren’t available right now' }, cors);

  const hash = hex(await crypto.subtle.digest('SHA-256', buf));
  const now = Date.now();
  const file = await env.DB.prepare('SELECT status FROM logo_files WHERE hash = ?1').bind(hash).first<{ status: string }>();
  const own = await env.DB.prepare('SELECT 1 AS y FROM logo_owners WHERE user_id = ?1 AND channel = ?2 AND hash = ?3').bind(user, channel, hash).first();
  const link = env.DB.prepare('INSERT INTO logo_owners (user_id, channel, hash, seen_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO UPDATE SET seen_at = ?4').bind(user, channel, hash, now);
  // Already here: no new file, so it doesn't count against anything but the player's own list
  if (file && own) {
    await link.run();
    return json(200, { hash, status: file.status }, cors);
  }
  if (!own) {
    const mine = await env.DB.prepare('SELECT COUNT(*) AS n FROM logo_owners WHERE user_id = ?1 AND channel = ?2').bind(user, channel).first<{ n: number }>();
    if ((mine?.n ?? 0) >= MAX_LOGOS_PER_PLAYER) return json(403, { error: `you can share ${MAX_LOGOS_PER_PLAYER} logos at most` }, cors);
  }
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM uploads_log WHERE user_id = ?1 AND at > ?2').bind(user, now - DAY_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_UPLOADS_PER_DAY) return json(429, { error: 'that’s enough uploads for today; try again tomorrow' }, cors);
  const logged = env.DB.prepare('INSERT INTO uploads_log (user_id, at) VALUES (?1, ?2)').bind(user, now);
  const pruned = env.DB.prepare('DELETE FROM uploads_log WHERE at < ?1').bind(now - 2 * DAY_MS);

  if (file) {
    await env.DB.batch([link, logged, pruned]);
    return json(200, { hash, status: file.status }, cors);
  }

  // A new file. The hard cap: one conditional update, so it can't be raised past CAP_BYTES
  const took = await env.DB.prepare('UPDATE usage SET bytes = bytes + ?1, objects = objects + 1 WHERE id = 1 AND bytes + ?1 <= ?2').bind(body.length, CAP_BYTES).run();
  if (!took.meta.changes) return json(507, { error: 'logo storage is full right now' }, cors);
  const giveBack = () => env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - 1) WHERE id = 1').bind(body.length).run();
  try {
    await env.LOGOS.put(hash, body, { httpMetadata: { contentType: pic.type } });
  } catch {
    await giveBack();
    return json(500, { error: 'the upload didn’t go through; try again' }, cors);
  }
  const [added] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO logo_files (hash, bytes, status, created_at) VALUES (?1, ?2, 'pending', ?3)").bind(hash, body.length, now),
    link,
    logged,
    pruned,
  ]);
  // Someone uploaded the same picture at the same moment: only one of us counts it
  if (!added.meta.changes) await giveBack();
  const row = await env.DB.prepare('SELECT status FROM logo_files WHERE hash = ?1').bind(hash).first<{ status: string }>();
  return json(200, { hash, status: row?.status ?? 'pending' }, cors);
}

async function statuses(env: Env, user: string, channel: string): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare('SELECT f.hash, f.status FROM logo_owners o JOIN logo_files f ON f.hash = o.hash WHERE o.user_id = ?1 AND o.channel = ?2')
    .bind(user, channel)
    .all<{ hash: string; status: string }>();
  return Object.fromEntries(results.map((r) => [r.hash, r.status]));
}

async function keepOnly(env: Env, user: string, channel: string, keep: string[]) {
  const list = JSON.stringify(keep);
  const { results } = await env.DB.prepare('DELETE FROM logo_owners WHERE user_id = ?1 AND channel = ?2 AND hash NOT IN (SELECT value FROM json_each(?3)) RETURNING hash')
    .bind(user, channel, list)
    .all<{ hash: string }>();
  for (const r of results) await release(env, r.hash);
  // Still in use: a removal queued before now mustn't take these (see nightly)
  await env.DB.prepare('UPDATE logo_owners SET seen_at = ?1 WHERE user_id = ?2 AND channel = ?3').bind(Date.now(), user, channel).run();
}

/** Clears logos of players who stopped sharing or deleted their account, and files refused in review. */
async function nightly(env: Env) {
  const { results: refused } = await env.DB.prepare("SELECT hash, bytes FROM logo_files WHERE status = 'rejected' AND bytes > 0 LIMIT 200").all<{ hash: string; bytes: number }>();
  for (const f of refused) {
    await env.LOGOS.delete(f.hash);
    await env.DB.batch([
      env.DB.prepare('UPDATE logo_files SET bytes = 0 WHERE hash = ?1').bind(f.hash),
      env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - 1) WHERE id = 1').bind(f.bytes),
    ]);
  }
  if (!env.CLEANUP_KEY) return;
  const taken = await rpc(env, 'logo_removals_take', { p_key: env.CLEANUP_KEY });
  const rows = (Array.isArray(taken?.data) ? taken.data : []) as { id: number; user_id: string; channel: string | null; at: number }[];
  if (!rows.length) return;
  for (const r of rows) {
    // Only what was there when they asked: a player who shares again keeps their new logos
    const { results } = await env.DB.prepare('DELETE FROM logo_owners WHERE user_id = ?1 AND (?2 IS NULL OR channel = ?2) AND seen_at < ?3 RETURNING hash')
      .bind(r.user_id, r.channel, r.at)
      .all<{ hash: string }>();
    for (const o of results) await release(env, o.hash);
  }
  await rpc(env, 'logo_removals_done', { p_key: env.CLEANUP_KEY, p_ids: rows.map((r) => r.id) });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsFor(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'logo' || parts.length > 2) return json(404, { error: 'not found' }, cors);
    const sub = parts[1];

    // ---- showing a logo: public, and only once approved
    if (req.method === 'GET' && sub !== 'mine') {
      if (!sub || !HASH.test(sub)) return json(404, { error: 'not found' }, cors);
      const row = await env.DB.prepare('SELECT status FROM logo_files WHERE hash = ?1').bind(sub).first<{ status: string }>();
      const obj = row?.status === 'approved' ? await env.LOGOS.get(sub) : null;
      if (!obj) return json(404, { error: 'not found' }, cors);
      const h = new Headers(cors);
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('cache-control', SERVE_CACHE);
      h.set('x-content-type-options', 'nosniff');
      h.set('content-security-policy', "default-src 'none'; sandbox");
      return new Response(obj.body, { headers: h });
    }

    const channel = url.searchParams.get('channel');
    if (channel !== 'main' && channel !== 'dev') return json(400, { error: 'which channel?' }, cors);
    const user = await userOf(req, env);
    if (!user) return json(401, { error: 'sign in first' }, cors);

    if (req.method === 'GET') return json(200, { logos: await statuses(env, user, channel) }, cors);
    if (req.method === 'PUT' && !sub) return upload(req, env, user, channel, cors);
    if (req.method === 'DELETE' && !sub) {
      await keepOnly(env, user, channel, []);
      return json(200, { ok: true }, cors);
    }
    if (req.method === 'POST' && sub === 'sync') {
      const raw = await req.text();
      if (raw.length > 2000) return json(413, { error: 'too long' }, cors);
      let keep: unknown;
      try {
        keep = (JSON.parse(raw) as { keep?: unknown }).keep;
      } catch {
        return json(400, { error: 'send { keep: [...] }' }, cors);
      }
      if (!Array.isArray(keep) || keep.length > MAX_LOGOS_PER_PLAYER || !keep.every((k) => typeof k === 'string' && HASH.test(k))) return json(400, { error: 'send { keep: [...] }' }, cors);
      await keepOnly(env, user, channel, keep as string[]);
      return json(200, { logos: await statuses(env, user, channel) }, cors);
    }
    return json(405, { error: 'method not allowed' }, cors);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(nightly(env));
  },
};

// ============================================================================
// BOARDING PASS LOGO UPLOADS
//   PUT    /logo/<save>/<livery 0-1>/<slot 0-4>   a 128×128 WebP or PNG, ≤ 16 KB
//   DELETE /logo/<save>/<livery>/<slot>
//   GET    /logo/<user>/<save>/<livery>/<slot>    anyone (to show a livery)
//
//   Signed-in players only (their Supabase access token, checked against
//   Supabase's public keys). Every player gets two liveries of five logos
//   per career, and a few uploads a day. The whole bucket has a hard cap:
//   the running total is kept in D1 and raised in one conditional update, so
//   no upload can take it past CAP_BYTES, even with many at once.
// ============================================================================
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Env {
  LOGOS: R2Bucket;
  DB: D1Database;
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;
}

/** Hard cap on everything in the bucket: under R2's 10 GB free storage, with room for R2's own overhead. */
const CAP_BYTES = 9_500_000_000;
const MAX_LOGO_BYTES = 16 * 1024;
const LOGO_PX = 128;
const MAX_LIVERIES = 2;
const MAX_SLOTS = 5;
const MAX_UPLOADS_PER_DAY = 40;
const MAX_SAVES_PER_PLAYER = 10;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const json = (status: number, body: unknown, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

function corsFor(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const ok = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes(origin);
  return ok
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '86400', vary: 'origin' }
    : { vary: 'origin' };
}

async function userOf(req: Request, env: Env): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  jwks ??= createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: `${env.SUPABASE_URL}/auth/v1`, audience: 'authenticated' });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** The picture's type and size from its first bytes (a PNG or a WebP), or null. */
function sniff(b: Uint8Array): { type: 'image/png' | 'image/webp'; w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', w: dv.getUint32(16), h: dv.getUint32(20) };
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length > 30 && tag(0) === 'RIFF' && tag(8) === 'WEBP') {
    const chunk = tag(12);
    if (chunk === 'VP8X') return { type: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === 'VP8L') {
      const v = dv.getUint32(21, true);
      return { type: 'image/webp', w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8 ') return { type: 'image/webp', w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
  }
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsFor(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const parts = new URL(req.url).pathname.split('/').filter(Boolean);
    if (parts[0] !== 'logo') return json(404, { error: 'not found' }, cors);

    // ---- reading a logo: public, cached
    if (req.method === 'GET') {
      if (parts.length !== 5) return json(404, { error: 'not found' }, cors);
      const obj = await env.LOGOS.get(parts.slice(1).join('/'));
      if (!obj) return json(404, { error: 'not found' }, cors);
      const h = new Headers(cors);
      obj.writeHttpMetadata(h);
      h.set('etag', obj.httpEtag);
      h.set('cache-control', 'public, max-age=3600');
      h.set('x-content-type-options', 'nosniff');
      return new Response(obj.body, { headers: h });
    }

    if (req.method !== 'PUT' && req.method !== 'DELETE') return json(405, { error: 'method not allowed' }, cors);
    const user = await userOf(req, env);
    if (!user) return json(401, { error: 'sign in to upload logos' }, cors);
    if (parts.length !== 4) return json(400, { error: 'use /logo/<save>/<livery>/<slot>' }, cors);
    const [, save, liv, slot] = parts;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(save) || !/^\d$/.test(liv) || +liv >= MAX_LIVERIES || !/^\d$/.test(slot) || +slot >= MAX_SLOTS)
      return json(400, { error: 'that livery or logo slot doesn’t exist' }, cors);
    const key = `${user}/${save}/${liv}/${slot}`;
    const old = await env.DB.prepare('SELECT bytes FROM logos WHERE key = ?1').bind(key).first<{ bytes: number }>();

    if (req.method === 'DELETE') {
      if (!old) return json(200, { ok: true }, cors);
      await env.LOGOS.delete(key);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM logos WHERE key = ?1').bind(key),
        env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - 1) WHERE id = 1').bind(old.bytes),
      ]);
      return json(200, { ok: true }, cors);
    }

    // ---- uploading
    const len = Number(req.headers.get('content-length') ?? 0);
    if (len > MAX_LOGO_BYTES) return json(413, { error: 'a logo can be 16 KB at most' }, cors);
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length || body.length > MAX_LOGO_BYTES) return json(413, { error: 'a logo can be 16 KB at most' }, cors);
    const pic = sniff(body);
    if (!pic) return json(415, { error: 'logos must be PNG or WebP' }, cors);
    if (pic.w !== LOGO_PX || pic.h !== LOGO_PX) return json(422, { error: `logos must be ${LOGO_PX}×${LOGO_PX}` }, cors);

    const now = Date.now();
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM uploads_log WHERE user_id = ?1 AND at > ?2').bind(user, now - 86_400_000).first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_UPLOADS_PER_DAY) return json(429, { error: 'that’s enough uploads for today; try again tomorrow' }, cors);
    if (!old) {
      const known = await env.DB.prepare('SELECT 1 AS y FROM logos WHERE user_id = ?1 AND save_id = ?2 LIMIT 1').bind(user, save).first();
      const saves = await env.DB.prepare('SELECT COUNT(DISTINCT save_id) AS n FROM logos WHERE user_id = ?1').bind(user).first<{ n: number }>();
      if (!known && (saves?.n ?? 0) >= MAX_SAVES_PER_PLAYER) return json(403, { error: `logos can be kept for ${MAX_SAVES_PER_PLAYER} careers` }, cors);
    }

    // The hard cap: one conditional update, so it can't be raised past CAP_BYTES
    const delta = body.length - (old?.bytes ?? 0);
    const took = await env.DB.prepare('UPDATE usage SET bytes = bytes + ?1, objects = objects + ?2 WHERE id = 1 AND bytes + ?1 <= ?3')
      .bind(delta, old ? 0 : 1, CAP_BYTES)
      .run();
    if (!took.meta.changes) return json(507, { error: 'logo storage is full right now' }, cors);
    try {
      await env.LOGOS.put(key, body, { httpMetadata: { contentType: pic.type, cacheControl: 'public, max-age=3600' } });
    } catch {
      await env.DB.prepare('UPDATE usage SET bytes = bytes - ?1, objects = objects - ?2 WHERE id = 1').bind(delta, old ? 0 : 1).run();
      return json(500, { error: 'the upload didn’t go through; try again' }, cors);
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO logos (key, user_id, save_id, bytes, created_at) VALUES (?1, ?2, ?5, ?3, ?4) ON CONFLICT(key) DO UPDATE SET bytes = ?3, created_at = ?4').bind(key, user, body.length, now, save),
      env.DB.prepare('INSERT INTO uploads_log (user_id, at) VALUES (?1, ?2)').bind(user, now),
      env.DB.prepare('DELETE FROM uploads_log WHERE at < ?1').bind(now - 2 * 86_400_000),
    ]);
    return json(200, { ok: true, url: `/logo/${key}` }, cors);
  },
};

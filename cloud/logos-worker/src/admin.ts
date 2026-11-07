// ============================================================================
// LOGO REVIEW FOR THE ADMIN SITE (Update A, phase A6)
//   GET  /admin/logos?status=pending|approved|rejected|all&before=<ms>   newest first, 60 at a time
//   GET  /admin/logo/<hash>                                               the picture, even while it waits
//   POST /admin/logo/<hash>  { action: 'approve' | 'remove', reason }      approve it, or remove it for good
//   GET  /admin/usage                                                     storage against the cap
//
//   The Worker holds no admin powers of its own. Every request carries the admin's
//   own Supabase token, and Supabase decides: admin_whoami (or admin_logo_act, which
//   also writes the admin log and tells the airlines) must answer, which only
//   happens for someone in private.admins who signed in with two-factor. Only then
//   does the Worker touch D1 or R2.
// ============================================================================
import type { Env } from './index';

type Rpc = (env: Env, name: string, args: unknown, token?: string) => Promise<{ data: unknown } | null>;
type Json = (status: number, body: unknown, cors: Record<string, string>) => Response;

const HASH = /^[0-9a-f]{64}$/;
const PAGE = 60;

async function isAdmin(env: Env, token: string, rpc: Rpc): Promise<boolean> {
  if (!token) return false;
  const who = await rpc(env, 'admin_whoami', {}, token);
  return !!who && typeof who.data === 'object' && who.data !== null && typeof (who.data as { role?: unknown }).role === 'string';
}

export async function adminRoute(req: Request, env: Env, parts: string[], url: URL, token: string, rpc: Rpc, json: Json, cors: Record<string, string>, capBytes: number): Promise<Response> {
  const what = parts[1];
  const hash = parts[2] ?? '';

  if (what === 'logo' && req.method === 'POST') {
    if (!HASH.test(hash)) return json(404, { error: 'not found' }, cors);
    const raw = await req.text();
    if (raw.length > 1000) return json(413, { error: 'too long' }, cors);
    let body: { action?: unknown; reason?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: 'send { action, reason }' }, cors);
    }
    const action = body.action;
    if (action !== 'approve' && action !== 'remove') return json(400, { error: 'send { action, reason }' }, cors);
    const file = await env.DB.prepare('SELECT bytes, status FROM logo_files WHERE hash = ?1').bind(hash).first<{ bytes: number; status: string }>();
    if (!file) return json(404, { error: 'not found' }, cors);
    const { results: owners } = await env.DB.prepare('SELECT DISTINCT channel, airline FROM logo_owners WHERE hash = ?1 AND airline <> \'\' LIMIT 500').bind(hash).all<{ channel: string; airline: string }>();
    // Supabase checks the admin, logs it and tells the airlines. Nothing happens here unless it says ok.
    const said = await rpc(env, 'admin_logo_act', { p_hash: hash, p_action: action, p_reason: typeof body.reason === 'string' ? body.reason.slice(0, 300) : '', p_owners: owners }, token);
    if (!said) return json(403, { error: 'not allowed' }, cors);
    if (said.data !== 'ok') return json(400, { error: String(said.data) }, cors);
    const now = Date.now();
    if (action === 'approve') {
      await env.DB.prepare("UPDATE logo_files SET status = 'approved', reviewed_at = ?2 WHERE hash = ?1 AND status <> 'rejected'").bind(hash, now).run();
      return json(200, { status: 'approved' }, cors);
    }
    // Removed for good: the file goes now, the total drops, and the hash stays so it can't be uploaded again
    await env.LOGOS.delete(hash);
    const steps = [env.DB.prepare("UPDATE logo_files SET status = 'rejected', bytes = 0, reviewed_at = ?2 WHERE hash = ?1").bind(hash, now)];
    if (file.bytes > 0) steps.push(env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - 1) WHERE id = 1').bind(file.bytes));
    await env.DB.batch(steps);
    return json(200, { status: 'rejected' }, cors);
  }

  if (req.method !== 'GET') return json(405, { error: 'method not allowed' }, cors);
  if (!(await isAdmin(env, token, rpc))) return json(403, { error: 'not allowed' }, cors);

  if (what === 'logos') {
    const status = url.searchParams.get('status') ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) return json(400, { error: 'which status?' }, cors);
    const before = Number(url.searchParams.get('before') ?? '') || Number.MAX_SAFE_INTEGER;
    const { results } = await env.DB.prepare('SELECT hash, bytes, status, created_at, reviewed_at FROM logo_files WHERE (?1 = \'all\' OR status = ?1) AND created_at < ?2 ORDER BY created_at DESC LIMIT ?3')
      .bind(status, before, PAGE)
      .all<{ hash: string; bytes: number; status: string; created_at: number; reviewed_at: number | null }>();
    const hashes = JSON.stringify(results.map((r) => r.hash));
    const { results: owners } = results.length
      ? await env.DB.prepare('SELECT hash, channel, airline, MAX(seen_at) AS seen FROM logo_owners WHERE hash IN (SELECT value FROM json_each(?1)) GROUP BY hash, channel, airline').bind(hashes).all<{ hash: string; channel: string; airline: string; seen: number }>()
      : { results: [] as { hash: string; channel: string; airline: string; seen: number }[] };
    const { results: uploads } = results.length
      ? await env.DB.prepare('SELECT hash, COUNT(DISTINCT user_id) AS players FROM logo_owners WHERE hash IN (SELECT value FROM json_each(?1)) GROUP BY hash').bind(hashes).all<{ hash: string; players: number }>()
      : { results: [] as { hash: string; players: number }[] };
    return json(
      200,
      {
        logos: results.map((r) => ({
          hash: r.hash,
          bytes: r.bytes,
          status: r.status,
          createdAt: r.created_at,
          reviewedAt: r.reviewed_at,
          players: uploads.find((u) => u.hash === r.hash)?.players ?? 0,
          owners: owners.filter((o) => o.hash === r.hash).map((o) => ({ channel: o.channel, airline: o.airline, seen: o.seen })),
        })),
        more: results.length === PAGE,
      },
      cors
    );
  }

  if (what === 'logo') {
    if (!HASH.test(hash)) return json(404, { error: 'not found' }, cors);
    const obj = await env.LOGOS.get(hash);
    if (!obj) return json(404, { error: 'not found' }, cors);
    const h = new Headers(cors);
    obj.writeHttpMetadata(h);
    h.set('cache-control', 'private, no-store');
    h.set('x-content-type-options', 'nosniff');
    h.set('content-security-policy', "default-src 'none'; sandbox");
    return new Response(obj.body, { headers: h });
  }

  if (what === 'usage') {
    const usage = await env.DB.prepare('SELECT bytes, objects FROM usage WHERE id = 1').first<{ bytes: number; objects: number }>();
    const { results: byStatus } = await env.DB.prepare('SELECT status, COUNT(*) AS n, SUM(bytes) AS bytes FROM logo_files GROUP BY status').all<{ status: string; n: number; bytes: number }>();
    const sched = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM schedules').first<{ n: number; bytes: number }>();
    return json(200, { bytes: usage?.bytes ?? 0, objects: usage?.objects ?? 0, cap: capBytes, logos: Object.fromEntries(byStatus.map((s) => [s.status, { count: s.n, bytes: s.bytes }])), schedules: sched ?? { n: 0, bytes: 0 } }, cors);
  }

  return json(404, { error: 'not found' }, cors);
}

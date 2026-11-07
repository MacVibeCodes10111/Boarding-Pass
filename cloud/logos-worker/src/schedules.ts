// ============================================================================
// FRIENDS' SCHEDULES (Update A, phase A4)
//   PUT    /schedule?channel=…     the player's own schedule (src/game/scheduleSnapshot.ts)
//   DELETE /schedule?channel=…     removes it: always works
//   POST   /schedules?channel=…    { known: { id: version } } the viewer's friends, with
//                                  the schedules that changed since those versions
//
//   Kept in the same bucket as logos, under sched/<channel>/<public id>, and counted
//   against the same hard cap. No address here serves a schedule without a signed-in
//   viewer: Supabase says who that viewer may see each time, so turning sharing off,
//   removing a friend or blocking takes effect on the very next request.
// ============================================================================
import { MAX_SNAPSHOT_BYTES, checkSnapshot } from '../../../src/game/scheduleSnapshot';
import type { Env } from './index';

type Cors = Record<string, string>;
type Rpc = (env: Env, name: string, args: unknown, token?: string) => Promise<{ data: unknown } | null>;
const json = (status: number, body: unknown, cors: Cors) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });

/** The game sends every 5 minutes at most. */
const MIN_GAP_MS = 60_000;
const MAX_KNOWN_CHARS = 4000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const keyFor = (channel: string, publicId: string) => `sched/${channel}/${publicId}`;

interface Row {
  public_id: string;
  bytes: number;
  version: number;
  updated_at: number;
}

export async function putSchedule(req: Request, env: Env, user: string, channel: string, token: string, capBytes: number, rpc: Rpc, cors: Cors): Promise<Response> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_SNAPSHOT_BYTES) return json(413, { error: 'that schedule is too big' }, cors);
  const raw = await req.text();
  if (raw.length > MAX_SNAPSHOT_BYTES) return json(413, { error: 'that schedule is too big' }, cors);
  const now = Date.now();
  const had = await env.DB.prepare('SELECT public_id, bytes, version, updated_at FROM schedules WHERE user_id = ?1 AND channel = ?2').bind(user, channel).first<Row>();
  if (had && now - had.updated_at < MIN_GAP_MS) return json(429, { error: 'wait a minute' }, cors);

  // The server's own switch, and the player's own choice
  const gate = await rpc(env, 'schedule_gate', { p_channel: channel }, token);
  if (!gate) return json(503, { error: 'try again later' }, cors);
  const publicId = gate.data;
  if (typeof publicId !== 'string' || !ID.test(publicId)) return json(403, { error: 'sharing flights isn’t on' }, cors);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { error: 'that isn’t a schedule' }, cors);
  }
  const snap = checkSnapshot(parsed);
  if (!snap) return json(422, { error: 'that isn’t a schedule' }, cors);
  // Only the known fields are stored, whatever else was sent
  const body = new TextEncoder().encode(JSON.stringify(snap));

  // The hard cap: one conditional update, so it can't be raised past it
  const delta = body.length - (had?.bytes ?? 0);
  const fresh = had ? 0 : 1;
  const took = await env.DB.prepare('UPDATE usage SET bytes = bytes + ?1, objects = objects + ?2 WHERE id = 1 AND bytes + ?1 <= ?3').bind(delta, fresh, capBytes).run();
  if (!took.meta.changes) return json(507, { error: 'storage is full right now' }, cors);
  try {
    await env.LOGOS.put(keyFor(channel, publicId), body, { httpMetadata: { contentType: 'application/json' } });
  } catch {
    await env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - ?2) WHERE id = 1').bind(delta, fresh).run();
    return json(500, { error: 'it didn’t go through; try again' }, cors);
  }
  const row = await env.DB.prepare(
    'INSERT INTO schedules (user_id, channel, public_id, bytes, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5) ON CONFLICT (user_id, channel) DO UPDATE SET public_id = ?3, bytes = ?4, version = version + 1, updated_at = ?5 RETURNING version',
  )
    .bind(user, channel, publicId, body.length, now)
    .first<{ version: number }>();
  return json(200, { version: row?.version ?? 1, flights: snap.flights.length }, cors);
}

/** Removes a player's schedule, if it was there before `before`, and lowers the total. */
export async function dropSchedule(env: Env, user: string, channel: string | null, before = Infinity): Promise<void> {
  const { results } = await env.DB.prepare('SELECT channel, public_id, bytes, updated_at FROM schedules WHERE user_id = ?1 AND (?2 IS NULL OR channel = ?2)')
    .bind(user, channel)
    .all<Row & { channel: string }>();
  for (const r of results) {
    // Shared again since they asked: the new one stays
    if (r.updated_at >= before) continue;
    await env.LOGOS.delete(keyFor(r.channel, r.public_id));
    await env.DB.batch([
      env.DB.prepare('DELETE FROM schedules WHERE user_id = ?1 AND channel = ?2').bind(user, r.channel),
      env.DB.prepare('UPDATE usage SET bytes = MAX(0, bytes - ?1), objects = MAX(0, objects - 1) WHERE id = 1').bind(r.bytes),
    ]);
  }
}

/**
 * The viewer's friends on the map, with any schedule they don't have yet. The stored files are
 * joined into the reply as they are, without being read, to stay inside a Worker's small CPU allowance.
 */
export async function readSchedules(req: Request, env: Env, channel: string, token: string, rpc: Rpc, cors: Cors): Promise<Response> {
  const raw = await req.text();
  if (raw.length > MAX_KNOWN_CHARS) return json(413, { error: 'too long' }, cors);
  let known: Record<string, unknown> = {};
  try {
    const k = (JSON.parse(raw || '{}') as { known?: unknown }).known;
    if (k && typeof k === 'object') known = k as Record<string, unknown>;
  } catch {
    return json(400, { error: 'send { known: {...} }' }, cors);
  }
  const answer = await rpc(env, 'friends_on_map', { p_channel: channel }, token);
  if (!answer) return json(503, { error: 'try again later' }, cors);
  const friends = (Array.isArray(answer.data) ? answer.data : []) as { id: string }[];
  if (!friends.length) return json(200, { airlines: [] }, cors);
  const { results } = await env.DB.prepare('SELECT public_id, version FROM schedules WHERE channel = ?1 AND public_id IN (SELECT value FROM json_each(?2))')
    .bind(channel, JSON.stringify(friends.map((f) => f.id)))
    .all<{ public_id: string; version: number }>();
  const versions = new Map(results.map((r) => [r.public_id, r.version]));
  const withFile = friends.filter((f) => versions.has(f.id));
  const files = await Promise.all(
    withFile.map(async (f) => {
      if (known[f.id] === versions.get(f.id)) return null;
      const obj = await env.LOGOS.get(keyFor(channel, f.id));
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    }),
  );
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [enc.encode('{"airlines":[')];
  withFile.forEach((f, i) => {
    const head = JSON.stringify({ ...f, version: versions.get(f.id) });
    parts.push(enc.encode((i ? ',' : '') + head.slice(0, -1)));
    const file = files[i];
    if (file) {
      parts.push(enc.encode(',"snapshot":'), file);
    }
    parts.push(enc.encode('}'));
  });
  parts.push(enc.encode(']}'));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return new Response(out, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
}

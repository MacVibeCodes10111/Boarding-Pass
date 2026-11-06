import { describe, expect, it } from 'vitest';
import { moderate, rot13 } from './moderation';
import { moderationSql } from './moderationSql';

/** Sample names; ones that should be caught are written ROT13 so this file reads cleanly. */
const FINE_NAMES = ['Jetstream Airlines', 'Scunthorpe Air', 'Cockpit Couriers', 'Sussex Connect', 'Essex Regional', 'Hitchcock Air', 'Dickens Aviation', 'Cumbria Wings', 'Grape Airways', 'Peacock Pacific', 'Bass Strait Air', 'Assam Air', 'Über Air', 'São Paulo Linhas', 'Air 2000', 'Ñandú Air', 'Middlesex', 'XXL Cargo', '', '   ', 'Nord-Ost', 'A.B.C. Air', 'Therapist Air', 'Pistol River', 'Sky 7', 'K2 Air', '航空', 'Blue Horizon', 'Analysis Air', 'Wessex'];
const BAD_NAMES = ['shpx nve', 'shhhpx', 's.h.p.x', 'fuvg nvejnlf', 'ovgpu nve', 'nff', 'n f f', 'n.f.f', 'nff nve', 'q1px', 'qvpx nve', 'p0px', 'ohyy fuvg', 'cbea nve', 'c0ea', 'uvgyre nve', 'u1gyre', 'anm1', 'kkk nve', 'wvunq', 'frk', 'f3k', '$rk'].map(rot13).concat(rot13('shpx').toUpperCase());
const CORPUS = [...FINE_NAMES, ...BAD_NAMES, rot13('shpx').replace('u', 'ü'), `  ${rot13('fuvg')}  `, rot13('n  f  f')];
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

describe('the word filter', () => {
  it('lets real names through', () => {
    for (const n of FINE_NAMES) expect(moderate(n), n).toBeNull();
  });

  it('catches blocked words, however they are dressed up', () => {
    expect(BAD_NAMES.filter((n) => moderate(n) === null)).toEqual([]);
  });
});

describe('the server copy', () => {
  it('matches the lists in moderation.ts (npx vitest -u remakes the file)', async () => {
    await expect(moderationSql()).toMatchFileSnapshot('../../cloud/supabase/moderation.sql');
  });

  it('has a check of the same answers as the game (run it in Supabase: no rows means they agree)', async () => {
    const rows = CORPUS.map((t) => `(${quote(t)}, ${moderate(t) !== null})`).join(',\n  ');
    const sql = `-- MADE BY src/game/moderationSql.test.ts. Run in Supabase: no rows means the server and the game agree.\nselect t, game_says_bad, private.moderate_bad(t) as server_says_bad\nfrom (values\n  ${rows}\n) as v(t, game_says_bad)\nwhere private.moderate_bad(t) <> game_says_bad;\n`;
    await expect(sql).toMatchFileSnapshot('../../cloud/supabase/moderation-check.sql');
  });
});

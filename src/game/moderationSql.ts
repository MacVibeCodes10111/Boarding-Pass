// ============================================================================
// THE WORD FILTER FOR THE SERVER
//   Makes private.moderate_bad (Postgres) from the lists in moderation.ts, so
//   there is one source of truth. Not part of the game: moderationSql.test.ts
//   checks the files in cloud/supabase/ still match (`npx vitest -u` remakes
//   them; then run the changed file in Supabase).
// ============================================================================
import { ALONE, ANYWHERE, FINE, rot13 } from './moderation';

/** The server's lists stay ROT13 too, so the database's function text reads cleanly. */
const arr = (list: string[]) => `array[${list.map((w) => `'${w}'`).join(', ')}]`;

export const moderationSql = () => `-- MADE BY src/game/moderationSql.ts: don't edit by hand.
-- True when text has a word we don't allow. Behaves the same as moderate() in src/game/moderation.ts.
create or replace function private.rot13(s text) returns text
  language sql immutable set search_path = ''
as $$ select translate(s, 'abcdefghijklmnopqrstuvwxyz', 'nopqrstuvwxyzabcdefghijklm') $$;

create or replace function private.moderate_bad(p text) returns boolean
  language plpgsql immutable set search_path = ''
as $f$
declare
  anywhere text[] := ${arr(ANYWHERE.map(rot13))};
  alone text[] := ${arr([...ALONE].map(rot13))};
  fine text[] := ${arr(FINE)};
  n text; letters text; squeezed text; w text; x text; sw text;
begin
  if p is null or regexp_replace(p, '\\s', '', 'g') = '' then return false; end if;
  n := lower(regexp_replace(normalize(p, NFKD), '[\\u0300-\\u036f]', '', 'g'));
  n := translate(n, '0123456789!|@$+', 'oi2easgtbgiiast');
  foreach w in array fine loop n := replace(n, w, ' '); end loop;
  letters := regexp_replace(n, '[^a-z]', '', 'g');
  squeezed := regexp_replace(letters, '(.)\\1+', '\\1', 'g');
  foreach w in array anywhere loop
    w := private.rot13(w);
    sw := regexp_replace(w, '(.)\\1+', '\\1', 'g');
    if position(w in letters) > 0 or position(w in squeezed) > 0 then return true; end if;
    if length(sw) >= 4 and (position(sw in letters) > 0 or position(sw in squeezed) > 0) then return true; end if;
  end loop;
  for x in select regexp_split_to_table(n, '[^a-z]+') loop
    if x <> '' and (private.rot13(x) = any(alone) or private.rot13(regexp_replace(x, '(.)\\1+', '\\1', 'g')) = any(alone)) then return true; end if;
  end loop;
  -- letters spaced or dotted out ("a s s", "a.s.s") count as one word
  for x in select regexp_split_to_table(n, '\\s{2,}|[^a-z\\s.\\-_*]+') loop
    x := regexp_replace(x, '^\\s+|\\s+$', '', 'g');
    if x ~ '^[a-z]([\\s.\\-_*]+[a-z])+$' and private.rot13(regexp_replace(x, '[^a-z]', '', 'g')) = any(alone) then return true; end if;
  end loop;
  return false;
end $f$;
revoke all on function private.rot13(text) from public, anon, authenticated;
revoke all on function private.moderate_bad(text) from public, anon, authenticated;
`;

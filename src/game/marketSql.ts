// ============================================================================
// AIRCRAFT PRICES FOR THE SERVER (Update B)
//   Makes cloud/supabase/market-prices.sql from the game's catalog, so the
//   marketplace's price check on the server uses the same list prices as the
//   game. market.test.ts checks the file still matches (`npx vitest -u`
//   remakes it; then run it in Supabase).
// ============================================================================
import { BUILTIN_AIRCRAFT } from './aircraftCatalog';

export const marketPricesSql = () => {
  const rows = BUILTIN_AIRCRAFT.map((m) => `  ('${m.id.replace(/'/g, "''")}', ${m.base_price_usd})`).join(',\n');
  return `-- MADE BY src/game/marketSql.ts: don't edit by hand. Run after 2026-11-07-market.sql, and again when the catalog changes.
insert into private.market_models (id, price) values
${rows}
on conflict (id) do update set price = excluded.price;
delete from private.market_models where id not in (${BUILTIN_AIRCRAFT.map((m) => `'${m.id.replace(/'/g, "''")}'`).join(', ')});
`;
};

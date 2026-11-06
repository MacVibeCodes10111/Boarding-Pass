# If player data may have been exposed

For Mac. This is a working plan, not legal advice; get a lawyer's help as soon as anything real happens.

## In the first hour
1. **Stop it.** Turn off the feature in Supabase (Table Editor → `features`). If a key leaked, rotate it in the dashboard it belongs to: Supabase, Cloudflare (`CLEANUP_KEY`; rerun `cloud/logos-worker/setup-cleanup-key.sh`) or the Tauri signing key.
2. **Note the time you found out.** The EU and UK deadline below counts from this moment.
3. **Keep the evidence.** Save the Supabase and Cloudflare logs before they expire. Don't delete anything yet.

## In the first day
4. **Work out what happened:** what data, how many accounts, which countries if known, and whether it's still going on.
5. **Write it all down,** even if it turns out to be minor. EU and UK law requires a record of every breach.

## Within 72 hours
6. **Tell the authorities if it's likely to put people at risk.** EU and UK law gives 72 hours from when you found out, and you can send what you know and add to it later. Some US states have their own rules. Ask the lawyer which apply.

## As soon as you can
7. **Tell affected players, in plain words,** if they're at serious risk: what happened, what data, what you've done, and what they should do (for example, change a password they reuse elsewhere). Most accounts have no email address, so post on boardingpass.my, in What's new and on the Discord. Sign-in with Google or Discord gives an email address, which you may use for this only, from boardingpass.support@gmail.com.
8. **Fix the cause,** check the fix, and turn the feature back on.

## Afterwards
9. Write up what went wrong and what changed. Keep it with the breach record.

#!/bin/sh
# Makes the nightly job's key and stores it as a Cloudflare secret. The key itself
# is never shown or saved anywhere else; Supabase only gets its fingerprint.
# Run from this folder, after `npx wrangler deploy`.
set -eu
key=$(openssl rand -hex 32)
printf %s "$key" | npx wrangler secret put CLEANUP_KEY
hash=$(printf %s "$key" | shasum -a 256 | cut -d' ' -f1)
echo
echo "Done. Run this in the Supabase SQL editor (it isn't secret):"
echo
echo "insert into private.logo_cleanup (id, key_hash) values (1, '$hash') on conflict (id) do update set key_hash = excluded.key_hash;"

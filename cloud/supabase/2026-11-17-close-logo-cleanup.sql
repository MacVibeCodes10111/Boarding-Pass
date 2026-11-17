-- Closes the logo Worker's nightly cleanup functions to visitors (2026-11-17).
-- They need CLEANUP_KEY anyway, but the Worker isn't deployed, so nothing needs
-- them open. When the logos Worker is deployed, open them again with:
--   grant execute on function public.logo_removals_take(text), public.logo_removals_done(text, bigint[]) to anon;
revoke execute on function public.logo_removals_take(text), public.logo_removals_done(text, bigint[]) from public, anon, authenticated;

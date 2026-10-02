-- Execute only as part of an approved rollback, after reconciling target-era
-- changes if target writes have already started. These were the source's exact
-- direct write grants audited on October 2, 2026; policies remain unchanged.
BEGIN;
DROP TRIGGER IF EXISTS neon_cutover_block_writes ON public.media;
DROP TRIGGER IF EXISTS neon_cutover_block_writes ON storage.objects;
DROP FUNCTION IF EXISTS public.neon_cutover_block_writes();
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.media, storage.objects TO anon, authenticated, service_role;
COMMIT;

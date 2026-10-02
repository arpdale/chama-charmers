-- Do not execute until the user approves the final production cutover.
-- Capture current grants first; keep their exact restoration SQL privately.
BEGIN;
SET LOCAL lock_timeout = '30s';
LOCK TABLE public.media, storage.objects IN EXCLUSIVE MODE;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media, storage.objects FROM PUBLIC, anon, authenticated, service_role;
-- Supabase can restore Storage grants. Triggers also block bypass-RLS service
-- roles and owners, preventing stale clients from writing during/after cutover.
CREATE FUNCTION public.neon_cutover_block_writes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Writes paused: application migrated to Neon' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER neon_cutover_block_writes BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.media
FOR EACH STATEMENT EXECUTE FUNCTION public.neon_cutover_block_writes();
CREATE TRIGGER neon_cutover_block_writes BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON storage.objects
FOR EACH STATEMENT EXECUTE FUNCTION public.neon_cutover_block_writes();
COMMIT;
-- Stop maintenance scripts, and test that database and Storage writes really
-- fail with the old app credentials. If any writer succeeds, do not cut over.
-- Reads remain available. Remove these triggers only during an approved rollback.

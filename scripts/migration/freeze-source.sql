-- Do not execute until the user approves the final production cutover.
-- Capture current grants first; keep their exact restoration SQL privately.
BEGIN;
SET LOCAL lock_timeout = '30s';
LOCK TABLE public.media, storage.objects IN EXCLUSIVE MODE;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.media, storage.objects FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
-- Stop maintenance scripts, and test that database and Storage writes really
-- fail with the old app credentials. If any writer succeeds, do not cut over.
-- Owners/admins retain privileges: prohibit manual writes during this window.

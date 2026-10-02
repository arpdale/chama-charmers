-- Execute only as part of an approved rollback, after reconciling target-era
-- changes if target writes have already started. These were the source's exact
-- direct write grants audited on October 2, 2026; policies remain unchanged.
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.media, storage.objects TO anon, authenticated, service_role;

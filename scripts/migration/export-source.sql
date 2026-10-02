-- Read-only portable snapshot. Save the `export` value privately, then split
-- it using save-source-export.mjs. Run again after the approved write freeze.
SELECT jsonb_build_object(
  'snapshot', jsonb_build_object(
    'captured_at', now(),
    'database_bytes', pg_database_size(current_database()),
    'auth_users', (SELECT count(*) FROM auth.users),
    'media', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id), '[]') FROM public.media m),
    'objects', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id), '[]') FROM storage.objects o),
    'buckets', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY id), '[]') FROM storage.buckets b),
    'columns', (SELECT jsonb_agg(jsonb_build_object('column_name', column_name, 'data_type', data_type, 'is_nullable', is_nullable, 'column_default', column_default, 'ordinal_position', ordinal_position) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='media')
  ),
  'row_checksums', (SELECT jsonb_agg(jsonb_build_object('id', id, 'checksum', md5(to_jsonb(m)::text)) ORDER BY id) FROM public.media m),
  'audit', jsonb_build_object(
    'media', (SELECT count(*) FROM public.media),
    'auth_users', (SELECT count(*) FROM auth.users),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'storage_bytes', (SELECT sum((metadata->>'size')::bigint) FROM storage.objects),
    'database_bytes', pg_database_size(current_database()),
    'row_checksums', (SELECT jsonb_agg(jsonb_build_object('id', id, 'md5', md5(to_jsonb(m)::text)) ORDER BY id) FROM public.media m)
  )
) AS export;

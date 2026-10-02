CREATE TABLE public.media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint NOT NULL,
  mime_type text NOT NULL,
  width integer,
  height integer,
  uploaded_by text NOT NULL DEFAULT 'Anonymous',
  taken_at timestamptz,
  created_at timestamptz DEFAULT now(),
  camera_model text,
  latitude double precision,
  longitude double precision,
  poster_path text,
  duration real,
  stream_uid text,
  deleted_at timestamptz
);
CREATE INDEX idx_media_timeline ON public.media (COALESCE(taken_at, created_at), id);
CREATE INDEX idx_media_uploaded_by ON public.media (uploaded_by);
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX idx_media_file_path ON public.media(file_path);
CREATE POLICY gallery_read ON public.media FOR SELECT TO chama_app USING (deleted_at IS NULL OR current_setting('app.uploader', true) <> '');
CREATE POLICY gallery_insert ON public.media FOR INSERT TO chama_app
  WITH CHECK (uploaded_by = current_setting('app.uploader', true) AND deleted_at IS NULL);
CREATE POLICY gallery_update ON public.media FOR UPDATE TO chama_app
  USING (deleted_at IS NULL AND current_setting('app.uploader', true) <> '')
  WITH CHECK (current_setting('app.uploader', true) <> '');
REVOKE ALL ON public.media FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO chama_app;
GRANT SELECT, INSERT, UPDATE ON public.media TO chama_app;

CREATE TABLE IF NOT EXISTS media_objects (
  bucket_id text NOT NULL,
  name text NOT NULL,
  is_public boolean NOT NULL,
  source_record jsonb NOT NULL,
  PRIMARY KEY(bucket_id,name)
);
ALTER TABLE media_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY object_read ON media_objects FOR SELECT TO chama_app USING(is_public OR current_setting('app.uploader', true) <> '');
CREATE POLICY object_update ON media_objects FOR UPDATE TO chama_app
  USING(current_setting('app.uploader', true) <> '') WITH CHECK(current_setting('app.uploader', true) <> '');
REVOKE ALL ON media_objects FROM PUBLIC;
GRANT SELECT,UPDATE(is_public) ON media_objects TO chama_app;

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
const root = process.env.MIGRATION_BACKUP_DIR || '.local-backups/2026-10-02';
const snapshot = JSON.parse(await fs.readFile(`${root}/source-snapshot.json`, 'utf8'));
const source = JSON.parse(await fs.readFile(`${root}/latest-source-audit.json`, 'utf8'));
const files = JSON.parse(await fs.readFile(`${root}/target-checksums.json`, 'utf8'));
const backup = JSON.parse(await fs.readFile(`${root}/storage-checksums.json`, 'utf8'));
const downloads = JSON.parse(await fs.readFile(`${root}/download-header-verification.json`, 'utf8'));
assert.equal(downloads.length, files.length);
assert.equal(files.length, snapshot.objects.length);
assert.equal(source.storage_objects, files.length);
assert.equal(source.storage_bytes, files.reduce((n,f)=>n+f.size,0));
for (const f of files) {
  const original = backup.find(b=>b.id===f.id);
  assert(original);
  assert.equal(f.target_sha256,original.sha256);
  assert.equal(f.size,original.size);
  assert(f.metadata_preserved);
  const download = downloads.find(d => d.path === f.path);
  assert(download?.etagUnchanged && download?.metadataUnchanged);
  assert.equal(download.bytes, f.size);
}
const url=new URL(process.env.DATABASE_URL); url.searchParams.set('sslmode','verify-full');
const db=new pg.Client({connectionString:url.toString()}); await db.connect();
try {
  const rows=(await db.query("SELECT id,md5((to_jsonb(m)-'deleted_at')::text) AS md5 FROM media m ORDER BY id")).rows;
  assert.deepEqual(rows,source.row_checksums);
  const inventory=(await db.query('SELECT count(*)::int AS count FROM media_objects')).rows[0].count;
  assert.equal(inventory,files.length);
  console.log(`Verified target snapshot: ${rows.length} identical rows and ${files.length} checksum-verified original objects`);
  console.log('Cutover still requires source write freeze and a fresh source audit; this check does not authorize promotion.');
} finally {await db.end();}

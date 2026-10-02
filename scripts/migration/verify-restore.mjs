import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
assert.equal(process.env.NEON_BRANCH, 'migration-verification');
const root = process.env.MIGRATION_BACKUP_DIR || '.local-backups/2026-10-02';
const backup = JSON.parse(await fs.readFile(`${root}/source-snapshot.json`, 'utf8'));
const expected = JSON.parse(await fs.readFile(`${root}/source-row-checksums.json`, 'utf8'));
const url = new URL(process.env.DATABASE_URL_UNPOOLED); url.searchParams.set('sslmode', 'verify-full');
const db = new pg.Client({ connectionString: url.toString() }); await db.connect();
try {
  await db.query('BEGIN');
  await db.query('CREATE SCHEMA restore_check');
  const schema = (await fs.readFile('scripts/migration/schema.sql', 'utf8')).replaceAll('public.media', 'restore_check.media').replace('SCHEMA public', 'SCHEMA restore_check');
  await db.query(schema);
  const columns = backup.columns.sort((a,b) => a.ordinal_position - b.ordinal_position).map(c => `"${c.column_name}"`).join(',');
  await db.query(`INSERT INTO restore_check.media(${columns}) SELECT ${columns} FROM json_populate_recordset(NULL::restore_check.media,$1::json)`, [JSON.stringify(backup.media)]);
  const restored = (await db.query("SELECT id,md5((to_jsonb(m)-'deleted_at')::text) AS checksum FROM restore_check.media m ORDER BY id")).rows;
  assert.deepEqual(restored, expected);
  await db.query((await fs.readFile('scripts/migration/object-inventory.sql', 'utf8')).replaceAll('media_objects','restore_check.media_objects'));
  for (const object of backup.objects) await db.query('INSERT INTO restore_check.media_objects VALUES($1,$2,$3,$4)', [object.bucket_id,object.name,backup.buckets.find(b=>b.id===object.bucket_id).public,object]);
  const count = Number((await db.query('SELECT count(*) FROM restore_check.media_objects')).rows[0].count);
  assert.equal(count, 80);
  await db.query('COMMIT');
  await fs.writeFile(`${root}/restore-verification.json`, JSON.stringify({ branch: process.env.NEON_BRANCH, schema: 'restore_check', rows: restored.length, inventoryObjects: count, allRowChecksumsMatch: true, completedAt:new Date().toISOString() }, null, 2), { mode:0o600 });
  console.log('Restored private backup into isolated schema: all 69 row checksums and 80 inventory records verified');
} catch (error) { await db.query('ROLLBACK'); throw error; }
finally { await db.end(); }

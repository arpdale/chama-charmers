import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
pg.types.setTypeParser(20, Number);
const root = process.env.MIGRATION_BACKUP_DIR || '.local-backups/2026-10-02';
const backup = JSON.parse(await readFile(`${root}/source-snapshot.json`, 'utf8'));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();
try {
  await client.query('BEGIN');
  const role = await client.query("SELECT rolname FROM pg_roles WHERE rolname='chama_app'");
  let appUrl = process.env.APP_DATABASE_URL;
  if (!role.rowCount) {
    const password = randomBytes(32).toString('hex');
    await client.query(`CREATE ROLE chama_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    const url = new URL(process.env.DATABASE_URL);
    url.username = 'chama_app'; url.password = password;
    appUrl = url.toString();
  }
  if (!appUrl) throw new Error('Existing app role requires APP_DATABASE_URL; refusing to rotate it');
  const table = await client.query("SELECT to_regclass('public.media') AS table_name");
  if (!table.rows[0].table_name) await client.query(await readFile('scripts/migration/schema.sql','utf8'));
  const count = Number((await client.query('SELECT count(*) FROM media')).rows[0].count);
  if (count && count !== backup.media.length) throw new Error('Target is not empty or the expected imported snapshot; refusing to overwrite');
  if (!count) {
    const columns = backup.columns.sort((a,b)=>a.ordinal_position-b.ordinal_position).map(x=>x.column_name);
    const identifiers = columns.map(c=>`"${c}"`).join(',');
    await client.query(`INSERT INTO media(${identifiers}) SELECT ${identifiers} FROM json_populate_recordset(NULL::media,$1::json)`, [JSON.stringify(backup.media)]);
  }
  const target = (await client.query('SELECT * FROM media ORDER BY id')).rows;
  const canonical = rows => JSON.stringify(rows.map(row => Object.fromEntries(Object.entries(row).filter(([key])=>key!=='deleted_at').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key, ['taken_at','created_at'].includes(key) && value ? new Date(value).toISOString() : value]))).sort((a,b)=>a.id.localeCompare(b.id)));
  const sourceHash = createHash('sha256').update(canonical(backup.media)).digest('hex');
  const targetHash = createHash('sha256').update(canonical(target)).digest('hex');
  if (sourceHash !== targetHash) throw new Error('Imported row checksum differs');
  const sourceChecksums = JSON.parse(await readFile(`${root}/source-row-checksums.json`, 'utf8'));
  const targetChecksums = (await client.query("SELECT id,md5((to_jsonb(m)-'deleted_at')::text) AS checksum FROM media m ORDER BY id")).rows;
  if (JSON.stringify(sourceChecksums) !== JSON.stringify(targetChecksums)) throw new Error('Exact PostgreSQL row checksum differs');
  const inventory = await client.query("SELECT to_regclass('public.media_objects') AS table_name");
  if (!inventory.rows[0].table_name) await client.query(await readFile('scripts/migration/object-inventory.sql', 'utf8'));
  for (const object of backup.objects) {
    const bucket = backup.buckets.find(b => b.id === object.bucket_id);
    await client.query('INSERT INTO media_objects(bucket_id,name,is_public,source_record) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [object.bucket_id,object.name,bucket.public,object]);
  }
  await client.query('COMMIT');
  let env = await readFile('.env.local','utf8');
  if (!env.includes('APP_DATABASE_URL=')) env += `\nAPP_DATABASE_URL=${appUrl}\n`;
  if (!env.includes('SESSION_SECRET=')) env += `SESSION_SECRET=${randomBytes(32).toString('hex')}\n`;
  if (!env.includes('UPLOAD_ACCESS_TOKEN=')) {
    if (!process.env.UPLOAD_ACCESS_TOKEN) throw new Error('UPLOAD_ACCESS_TOKEN must be configured privately');
    env += `UPLOAD_ACCESS_TOKEN=${JSON.stringify(process.env.UPLOAD_ACCESS_TOKEN)}\n`;
  }
  if (!env.includes('MIGRATION_READ_ONLY=')) env += 'MIGRATION_READ_ONLY=true\n';
  await writeFile('.env.local',env,{mode:0o600});
  await writeFile(`${root}/database-verification.json`,JSON.stringify({ rows: target.length, source_sha256:sourceHash,target_sha256:targetHash,all_columns_equal:true },null,2),{mode:0o600});
  console.log(JSON.stringify({ imported:target.length,all_columns_equal:true,sha256:targetHash }));
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally { await client.end(); }

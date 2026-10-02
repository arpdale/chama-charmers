import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.env.MIGRATION_BACKUP_DIR || '.local-backups/2026-10-02');
assert(root.startsWith(`${resolve('.local-backups')}/`), 'Snapshot must remain inside ignored private backup directory');
assert(process.argv[2], 'Pass a private JSON file containing export-source.sql export value');
const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.equal(data.snapshot.media.length, data.audit.media);
assert.equal(data.snapshot.objects.length, data.audit.storage_objects);
assert.equal(data.row_checksums.length, data.audit.media);
await mkdir(root, { recursive: true, mode: 0o700 });
for (const [name, value] of Object.entries({ 'source-snapshot': data.snapshot, 'source-row-checksums': data.row_checksums, 'latest-source-audit': data.audit })) {
  const path = `${root}/${name}.json`;
  if (await access(path).then(() => true, () => false)) throw new Error(`Refusing to overwrite existing snapshot ${name}; use a new MIGRATION_BACKUP_DIR`);
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
}
console.log(`Saved private snapshot: ${data.audit.media} records, ${data.audit.storage_objects} objects`);

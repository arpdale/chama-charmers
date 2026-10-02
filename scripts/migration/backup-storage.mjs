import { readFile, mkdir, writeFile, chmod, stat } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { resolve, dirname } from 'node:path';

const root = resolve(process.argv[2] || '.local-backups/2026-10-02');
const snapshot = JSON.parse(await readFile(`${root}/source-snapshot.json`, 'utf8'));
const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!base) throw new Error('Source URL missing');
await mkdir(`${root}/objects`, { recursive: true, mode: 0o700 });
const results = [];
let cursor = 0;
async function hashFile(path) {
  const sha = createHash('sha256');
  const md5 = createHash('md5');
  for await (const chunk of createReadStream(path)) { sha.update(chunk); md5.update(chunk); }
  return { sha256: sha.digest('hex'), md5: md5.digest('hex') };
}
async function worker() {
  while (cursor < snapshot.objects.length) {
    const object = snapshot.objects[cursor++];
    const path = resolve(root, 'objects', object.bucket_id, object.name);
    if (!path.startsWith(`${root}/objects/`)) throw new Error('Unsafe object path');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const expected = Number(object.metadata.size);
    const existing = await stat(path).catch(() => null);
    let headers = {};
    if (!existing || existing.size !== expected) {
      const bucket = snapshot.buckets.find(b => b.id === object.bucket_id);
      if (!bucket?.public) throw new Error('Private source bucket needs authenticated download');
      const url = `${base}/storage/v1/object/public/${encodeURIComponent(object.bucket_id)}/${object.name.split('/').map(encodeURIComponent).join('/')}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
      if (!response.ok) throw new Error(`Download failed: ${response.status} for object ${object.id}`);
      headers = { etag: response.headers.get('etag'), content_type: response.headers.get('content-type'), cache_control: response.headers.get('cache-control') };
      await pipeline(response.body, createWriteStream(path, { mode: 0o600 }));
    }
    await chmod(path, 0o600);
    const actual = (await stat(path)).size;
    if (actual !== expected) throw new Error(`Size mismatch for object ${object.id}: ${actual}/${expected}`);
    const hashes = await hashFile(path);
    const etag = (headers.etag || object.metadata.eTag || '').replaceAll('"', '');
    if (/^[0-9a-f]{32}$/i.test(etag) && etag.toLowerCase() !== hashes.md5) throw new Error(`Source ETag mismatch for ${object.id}`);
    results.push({ id: object.id, bucket: object.bucket_id, path: object.name, size: actual, ...hashes, ...headers, source_metadata: object.metadata, source_etag_verified: /^[0-9a-f]{32}$/i.test(etag) });
    await writeFile(`${root}/storage-checksums.partial.json`, JSON.stringify(results, null, 2), { mode: 0o600 });
    console.log(`Verified ${results.length}/${snapshot.objects.length} objects (${actual} bytes)`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
results.sort((a,b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
await writeFile(`${root}/storage-checksums.json`, JSON.stringify(results, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ objects: results.length, bytes: results.reduce((n,x)=>n+x.size,0), sha256: 'all', source_etag_verified: results.filter(x=>x.source_etag_verified).length }));

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import sharp from 'sharp';
import pg from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// Mutating tests may only run on this disposable branch, never production.
assert.equal(process.env.NEON_BRANCH, 'migration-verification');
const base = process.env.TEST_APP_URL || 'http://localhost:3001';
const results = [];
const browserState = process.env.TEST_APP_COOKIE_FILE ? JSON.parse(await fs.readFile(process.env.TEST_APP_COOKIE_FILE,'utf8')) : null;
const host = new URL(base).hostname;
const accessCookies = browserState?.data.cookies.filter(c => c.name !== 'chama-session' && (host === c.domain || host.endsWith(c.domain.replace(/^\./,'')))).map(c=>`${c.name}=${c.value}`).join('; ');
const headers = { Origin: new URL(base).origin, 'Content-Type': 'application/json' };
async function request(path, method, body, cookie, status = 200, extra = {}) {
  const cookieHeader=[accessCookies,cookie].filter(Boolean).join('; ');
  const response = await fetch(base + path, { method, headers: { ...headers, ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
  results.push({ method, path, status });
  return response;
}
async function session(name) {
  const r = await request('/api/session', 'POST', { key: process.env.UPLOAD_ACCESS_TOKEN, name });
  return r.headers.get('set-cookie').split(';')[0];
}
const rows = await (await request('/api/media', 'GET')).json();
const source=JSON.parse(await fs.readFile('.local-backups/2026-10-02/source-snapshot.json','utf8'));
assert(source.media.every(m=>rows.some(r=>r.id===m.id)), 'All original media records present');
const baselineCount=rows.filter(r=>r.file_name!=='migration-verification.png').length;
await request('/api/media', 'POST', {}, undefined, 401);
await request('/api/media', 'POST', {}, 'chama-session=invalid', 401);
await request('/api/session', 'POST', { key: 'invalid', name: 'David' }, undefined, 403);
await request('/api/session', 'POST', { key: process.env.UPLOAD_ACCESS_TOKEN, name: 'David' }, undefined, 403, { Origin: 'https://untrusted.example' });
const david = await session('David');
const nirav = await session('Nirav');
for (const row of rows.filter(r => r.file_name === 'migration-verification.png')) {
  await request('/api/media', 'DELETE', { ids: [row.id] }, row.uploaded_by === 'David' ? david : nirav);
}
await request('/api/media', 'DELETE', { ids: [rows.find(r => r.uploaded_by !== 'David').id] }, david, 403);
await request('/api/uploads', 'POST', { operation: 'initiate', name: 'bad.html', type: 'text/html', size: 20 }, david, 400);
await request('/api/uploads', 'POST', { operation: 'initiate', name: 'large.mp4', type: 'video/mp4', size: 6 * 1024 ** 3 }, david, 400);
const aborted = await (await request('/api/uploads', 'POST', { operation: 'initiate', name: 'cancel.jpg', type: 'image/jpeg', size: 100 }, david)).json();
await request('/api/uploads', 'POST', { operation: 'part', token: aborted.token, part: 1 }, nirav, 403);
await request('/api/uploads', 'POST', { operation: 'abort', token: aborted.token }, david);

// A genuine image larger than one multipart chunk exercises assembly, checksums,
// image processing, receipt ownership, database writes and reversible deletion.
const body = await sharp(randomBytes(2000 * 2000 * 3), { raw: { width: 2000, height: 2000, channels: 3 } }).png().toBuffer();
assert(body.length > 8 * 1024 ** 2);
await fs.writeFile('.migration-private/browser-upload.png', body, { mode: 0o600 });
const upload = await (await request('/api/uploads', 'POST', { operation: 'initiate', name: 'migration-verification.png', type: 'image/png', size: body.length }, david)).json();
const parts = [];
for (let start = 0, part = 1; start < body.length; start += upload.chunkSize, part++) {
  const signed = await (await request('/api/uploads', 'POST', { operation: 'part', token: upload.token, part }, david)).json();
  const r = await fetch(signed.url, { method: 'PUT', body: body.subarray(start, start + upload.chunkSize) });
  assert.equal(r.status, 200, 'Signed multipart PUT');
  assert(r.headers.get('etag'));
  parts.push({ PartNumber: part, ETag: r.headers.get('etag') });
}
const complete = await (await request('/api/uploads', 'POST', { operation: 'complete', token: upload.token, parts }, david)).json();
const input = { receipt: complete.receipt, posterReceipt: null, taken_at: null, width: 2000, height: 2000, camera_model: null, latitude: null, longitude: null, duration: null };
await request('/api/media', 'POST', input, nirav, 403);
const created = await (await request('/api/media', 'POST', input, david, 201)).json();
const downloaded = Buffer.from(await (await request('/api/files/' + created.file_path, 'GET')).arrayBuffer());
assert.equal(createHash('sha256').update(downloaded).digest('hex'), createHash('sha256').update(body).digest('hex'));
const thumb = await request('/api/files/' + created.file_path + '?variant=thumb', 'GET');
assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
assert((await thumb.arrayBuffer()).byteLength < body.length / 10);
const s3 = new S3Client({ forcePathStyle: true });
const privateUrl = new URL(process.env.AWS_ENDPOINT_URL_S3); privateUrl.pathname += '/media/' + created.file_path;
assert(!(await fetch(privateUrl)).ok, 'Unsigned storage cannot return file bytes');
await request('/api/media', 'PATCH', { ids: [created.id], uploaded_by: 'Nirav' }, david);
await request('/api/media', 'DELETE', { ids: [created.id] }, david, 403);
await request('/api/media', 'DELETE', { ids: [created.id] }, nirav);
await request('/api/files/' + created.file_path, 'GET', undefined, undefined, 404);
const retained = await s3.send(new GetObjectCommand({ Bucket: 'media', Key: created.file_path }));
assert.equal(retained.ContentLength, body.length, 'Soft deletion retains rollback file');

const url = new URL(process.env.APP_DATABASE_URL); url.searchParams.set('sslmode', 'verify-full');
const db = new pg.Client({ connectionString: url.toString() }); await db.connect();
assert.equal(Number((await db.query('SELECT count(*) FROM media')).rows[0].count), baselineCount);
await assert.rejects(db.query("INSERT INTO media(file_name,file_path,file_size,mime_type,uploaded_by) VALUES('x','x',1,'image/png','David')"), /row-level security/);
await assert.rejects(db.query('DELETE FROM media'), /permission denied/);
await assert.rejects(db.query('CREATE TABLE public.unauthorized(id int)'), /permission denied/);
await db.end();
await fs.writeFile(base.includes('localhost') ? '.migration-private/app-verification.json' : '.migration-private/hosted-app-verification.json', JSON.stringify({ branch: process.env.NEON_BRANCH, applicationUrl:base, results, multipartBytes: body.length, checksum: 'matched', privateStorage: true, rls: 'verified', completedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
console.log(`Verified ${results.length} HTTP checks, multipart image upload/download checksum, derivatives, soft deletion and database permissions`);

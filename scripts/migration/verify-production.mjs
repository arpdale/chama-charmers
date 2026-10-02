// One explicitly approved cutover smoke test. Never changes original records.
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import pg from 'pg';
assert.equal(process.env.NEON_BRANCH,'production');
assert(process.argv.includes('--approved-cutover'), 'Production test requires approved cutover');
const base='https://chama-charmers.vercel.app';
const results=[];
async function req(path,method='GET',body,cookie,status=200) {
  const r=await fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(r.status,status,`${method} ${path}: unexpected response status`);
  results.push({method,path,status}); return r;
}
async function session(name) {
  const r=await req('/api/session','POST',{name,key:process.env.UPLOAD_ACCESS_TOKEN});
  return r.headers.get('set-cookie').split(';')[0];
}
const originals=JSON.parse(await readFile('.local-backups/2026-10-02/source-snapshot.json','utf8'));
const before=await (await req('/api/media?limit=100')).json();
assert(originals.media.every(m=>before.some(r=>r.id===m.id)));
await req('/api/media','POST',{},undefined,401);
await req('/api/session','POST',{name:'David',key:'invalid'},undefined,403);
const david=await session('David'),nirav=await session('Nirav');
const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#648666'}}).png().toBuffer();
const upload=await (await req('/api/uploads','POST',{operation:'initiate',name:'production-cutover-verification.png',type:'image/png',size:bytes.length},david)).json();
const part=await (await req('/api/uploads','POST',{operation:'part',token:upload.token,part:1},david)).json();
const put=await fetch(part.url,{method:'PUT',body:bytes}); assert.equal(put.status,200);
const completed=await (await req('/api/uploads','POST',{operation:'complete',token:upload.token,parts:[{PartNumber:1,ETag:put.headers.get('etag')}]},david)).json();
let created;
try {
  created=await (await req('/api/media','POST',{receipt:completed.receipt,posterReceipt:null,taken_at:null,width:64,height:64,camera_model:null,latitude:null,longitude:null,duration:null},david,201)).json();
  await writeFile('.migration-private/production-test-record.json',JSON.stringify({id:created.id,path:created.file_path}),{mode:0o600});
  const file=await req('/api/files/'+created.file_path);
  assert.match(file.headers.get('content-disposition'),/attachment/);
  assert.equal(createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
  const thumb=await req('/api/files/'+created.file_path+'?variant=thumb');assert.match(thumb.headers.get('content-type'),/image\/jpeg/);
  await req('/api/media','DELETE',{ids:[created.id]},nirav,403);
} finally {
  if(created) await req('/api/media','DELETE',{ids:[created.id]},david);
}
await req('/api/files/'+created.file_path,'GET',undefined,undefined,404);
const after=await (await req('/api/media?limit=100')).json();assert.equal(after.length,before.length);
const url=new URL(process.env.DATABASE_URL);url.searchParams.set('sslmode','verify-full');
const db=new pg.Client({connectionString:url.toString()});await db.connect();
try {
  const expected=JSON.parse(await readFile('.local-backups/2026-10-02/source-row-checksums.json','utf8'));
  const actual=(await db.query("SELECT id,md5((to_jsonb(m)-'deleted_at')::text) AS checksum FROM media m WHERE id=ANY($1::uuid[]) ORDER BY id",[originals.media.map(m=>m.id)])).rows;
  assert.deepEqual(actual,expected);
  assert((await db.query('SELECT deleted_at IS NOT NULL AS deleted FROM media WHERE id=$1',[created.id])).rows[0].deleted);
} finally {await db.end();}
await writeFile('.migration-private/production-verification.json',JSON.stringify({publicUrl:base,results,activeRecords:after.length,originalRecordsUnchanged:true,uploadDownloadSha256:true,attachmentHeader:true,softDeletedTestId:created.id,completedAt:new Date().toISOString()},null,2),{mode:0o600});
console.log(`Production verified: ${results.length} HTTP checks, upload/download SHA-256, ownership denial, soft deletion; all ${originals.media.length} original rows unchanged`);

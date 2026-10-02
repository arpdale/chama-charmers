import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
const source = parseEnv(await readFile('.migration-private/source.env','utf8'));
const base = source.NEXT_PUBLIC_SUPABASE_URL;
const key = source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const headers = { apikey:key, Authorization:`Bearer ${key}` };
const db = await fetch(`${base}/rest/v1/media`, {
  method:'POST', headers:{ ...headers, 'Content-Type':'application/json' },
  body:JSON.stringify({ id:randomUUID(),file_name:'migration-freeze-probe',file_path:`migration-probe/${randomUUID()}`,file_size:4,mime_type:'image/jpeg',uploaded_by:'David' }),
});
const storage = await fetch(`${base}/storage/v1/object/media/migration-probe/${randomUUID()}.jpg`, {
  method:'POST',headers:{...headers,'Content-Type':'image/jpeg'},body:Buffer.from([255,216,255,217]),
});
const dbBody = await db.text(); const storageBody = await storage.text();
const result = { databaseWriteStatus:db.status,storageWriteStatus:storage.status,databaseDenied:!db.ok,storageDenied:!storage.ok,databasePermissionError:/permission denied|Writes paused/i.test(dbBody),storageFreezeError:/Writes paused/i.test(storageBody),storageResponse:storageBody };
await writeFile('.migration-private/source-write-freeze-check.json',JSON.stringify(result,null,2),{mode:0o600});
console.log({ databaseWriteStatus:db.status,storageWriteStatus:storage.status,databaseDenied:!db.ok,storageDenied:!storage.ok });
// Storage masks trigger exceptions as HTTP 500. Also verify both statement
// triggers directly with owner-role no-op writes before accepting this result.
if(db.ok || storage.ok || !result.databasePermissionError || storage.status !== 500) throw new Error('Source write freeze not proven; stop cutover');

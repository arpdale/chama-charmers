// Run: node --env-file=.env.local scripts/backfill-posters.mjs
// Requires ffmpeg on PATH. Never downloads originals during gallery browsing.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import { db, storage } from './media-services.mjs';
await db.connect();
try {
  const rows=(await db.query("SELECT * FROM media WHERE mime_type LIKE 'video/%' AND poster_path IS NULL AND deleted_at IS NULL")).rows;
  const dir=await mkdtemp(join(tmpdir(),'chama-posters-'));
  for(const row of rows) {
    const url=await getSignedUrl(storage,new GetObjectCommand({Bucket:'media',Key:row.file_path}),{expiresIn:3600});
    const path=join(dir,`${row.id}.jpg`);
    await promisify(execFile)('ffmpeg',['-hide_banner','-loglevel','error','-ss','1','-i',url,'-frames:v','1','-q:v','3',path]);
    const body=await readFile(path);
    const poster=`posters/${row.id}.jpg`;
    await storage.send(new PutObjectCommand({Bucket:'media',Key:poster,Body:body,ContentType:'image/jpeg',CacheControl:'public, max-age=31536000, immutable'}));
    for(const variant of ['thumb','view']) {
      const resized=await sharp(body).resize(variant==='thumb'?{width:800,height:440,fit:'inside',withoutEnlargement:true}:{width:2000,withoutEnlargement:true}).jpeg({quality:variant==='thumb'?75:90}).toBuffer();
      await storage.send(new PutObjectCommand({Bucket:'media',Key:`derived/${variant}/${poster}.jpg`,Body:resized,ContentType:'image/jpeg',CacheControl:'public, max-age=31536000, immutable'}));
    }
    await db.query('UPDATE media SET poster_path=$1 WHERE id=$2',[poster,row.id]);
    console.log(`Created poster for ${row.id}`);
  }
  console.log(`${rows.length} posters created`);
} finally { await db.end(); }

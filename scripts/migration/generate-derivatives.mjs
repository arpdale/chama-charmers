import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import convert from 'heic-convert';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
const root = process.env.MIGRATION_BACKUP_DIR || '.local-backups/2026-10-02';
const backup=JSON.parse(await readFile(`${root}/source-snapshot.json`,'utf8'));
const s3=new S3Client({forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
const photos=backup.media.filter(m=>m.mime_type.startsWith('image/')).map(m=>({path:m.file_path,type:m.mime_type}));
const posters=[...new Set(backup.media.map(m=>m.poster_path).filter(Boolean))].map(path=>({path,type:'image/jpeg'}));
const results=[];
for(const item of [...photos,...posters]) {
  let buffer=await readFile(`${root}/objects/media/${item.path}`);
  if(/hei[cf]/.test(item.type)) buffer=Buffer.from(await convert({buffer,format:'JPEG',quality:0.9}));
  for(const variant of ['thumb','view']) {
    const key=`derived/${variant}/${item.path}.jpg`;
    const image=sharp(buffer).rotate().resize(variant==='thumb'?{width:800,height:440,fit:'inside',withoutEnlargement:true}:{width:2000,withoutEnlargement:true});
    const bytes=await image.jpeg({quality:variant==='thumb'?75:90}).toBuffer();
    await mkdir(`${root}/derived/${variant}`,{recursive:true,mode:0o700});
    const local=`${root}/derived/${variant}/${createHash('sha256').update(item.path).digest('hex')}.jpg`;
    await writeFile(local,bytes,{mode:0o600});
    await s3.send(new PutObjectCommand({Bucket:'media',Key:key,Body:bytes,ContentType:'image/jpeg',CacheControl:'public, max-age=31536000, immutable'}));
    const fetched=await s3.send(new GetObjectCommand({Bucket:'media',Key:key}));
    const actual=await fetched.Body.transformToByteArray();
    const hash=data=>createHash('sha256').update(data).digest('hex');
    if(hash(bytes)!==hash(actual)) throw new Error(`Derivative mismatch ${key}`);
    results.push({path:item.path,key,size:bytes.length,sha256:hash(bytes),local});
  }
  console.log(`Prepared ${results.length/2}/${photos.length+posters.length} image pairs`);
}
await writeFile(`${root}/derivative-checksums.json`,JSON.stringify(results,null,2),{mode:0o600});
console.log(JSON.stringify({derivatives:results.length,bytes:results.reduce((n,x)=>n+x.size,0),verified:'all'}));

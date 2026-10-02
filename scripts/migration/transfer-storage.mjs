import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { S3Client, HeadObjectCommand, GetObjectCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const root = process.env.MIGRATION_BACKUP_DIR || '.local-backups/2026-10-02';
const source = JSON.parse(await readFile(`${root}/source-snapshot.json`, 'utf8'));
const checksums = JSON.parse(await readFile(`${root}/storage-checksums.json`, 'utf8'));
if (checksums.length !== source.objects.length) throw new Error('File backup incomplete');
const s3 = new S3Client({ forcePathStyle:true, requestChecksumCalculation:'WHEN_REQUIRED', responseChecksumValidation:'WHEN_REQUIRED' });
await s3.send(new PutBucketCorsCommand({ Bucket:'media', CORSConfiguration:{ CORSRules:[{ AllowedOrigins:['*'], AllowedMethods:['GET','HEAD','PUT'], AllowedHeaders:['*'], ExposeHeaders:['ETag','Content-Length','Content-Type'], MaxAgeSeconds:3600 }] } }));
const results=[];
let cursor=0;
async function worker() {
  while(cursor<checksums.length) {
    const file=checksums[cursor++];
    const object=source.objects.find(x=>x.id===file.id);
    const target={Bucket:object.bucket_id,Key:object.name};
    let head=await s3.send(new HeadObjectCommand(target)).catch(e=>{ if(e.$metadata?.httpStatusCode===404) return null; throw e; });
    if(head && (head.Metadata?.source_sha256!==file.sha256 || head.ContentLength!==file.size)) throw new Error(`Unexpected target object ${object.id}; refusing overwrite`);
    const type=object.metadata.mimetype;
    const cacheControl=object.metadata.cacheControl;
    if(!head) {
      await new Upload({ client:s3, params:{ ...target,Body:createReadStream(`${root}/objects/${object.bucket_id}/${object.name}`),ContentLength:file.size,ContentType:type,CacheControl:cacheControl,Metadata:{source_sha256:file.sha256,source_metadata:Buffer.from(JSON.stringify(object)).toString('base64')} },partSize:8*1024**2,queueSize:2 }).done();
      head=await s3.send(new HeadObjectCommand(target));
    }
    const response=await s3.send(new GetObjectCommand(target));
    const sha=createHash('sha256');let bytes=0;
    for await(const chunk of response.Body) { bytes+=chunk.length;sha.update(chunk); }
    const hash=sha.digest('hex');
    if(hash!==file.sha256 || bytes!==file.size || head.ContentType!==type || head.CacheControl!==cacheControl || head.Metadata?.source_metadata!==Buffer.from(JSON.stringify(object)).toString('base64')) throw new Error(`Target verification failed for ${object.id}`);
    results.push({id:object.id,path:object.name,size:bytes,source_sha256:file.sha256,target_sha256:hash,content_type:head.ContentType,metadata_preserved:true,etag:head.ETag});
    await writeFile(`${root}/target-checksums.partial.json`,JSON.stringify(results,null,2),{mode:0o600});
    console.log(`Transferred and verified ${results.length}/${checksums.length} (${bytes} bytes)`);
  }
}
await Promise.all(Array.from({length:3},worker));
await writeFile(`${root}/target-checksums.json`,JSON.stringify(results.sort((a,b)=>a.path.localeCompare(b.path)),null,2),{mode:0o600});
console.log(JSON.stringify({objects:results.length,bytes:results.reduce((n,x)=>n+x.size,0),sha256:'all match',metadata:'all match'}));

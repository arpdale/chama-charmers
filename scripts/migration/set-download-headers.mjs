import assert from 'node:assert/strict';
import { readFile, writeFile, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { S3Client, HeadObjectCommand, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCopyCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';

// Add native download headers without changing original paths or bytes. Neon
// ignores GetObject response header overrides, so headers must be stored.
const root = '.local-backups/2026-10-02';
const snapshot = JSON.parse(await readFile(`${root}/source-snapshot.json`, 'utf8'));
const verified = JSON.parse(await readFile(`${root}/target-checksums.json`, 'utf8'));
const client = new S3Client({ forcePathStyle:true, requestChecksumCalculation:'WHEN_REQUIRED' });
const partSize = 8 * 1024 ** 2;
const results = [];
let cursor = 0;
function disposition(name) {
  const fallback=name.replace(/[^a-zA-Z0-9 ._()-]/g,'_').slice(0,255) || 'download';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
async function worker() {
  while(cursor < verified.length) {
    const file = verified[cursor++];
    const object = snapshot.objects.find(o=>o.id===file.id);
    const target = { Bucket:object.bucket_id, Key:object.name };
    const before = await client.send(new HeadObjectCommand(target));
    assert.equal(before.ContentLength,file.size);
    assert.equal(before.Metadata.source_sha256,file.source_sha256);
    assert.equal(before.ETag,file.etag,'Object changed since full readback verification');
    const name=snapshot.media.find(m=>m.file_path===object.name)?.file_name || object.name.split('/').pop();
    const header=disposition(name);
    if (before.ContentDisposition !== header) {
      const common = { ...target, ContentType:before.ContentType, CacheControl:before.CacheControl, Metadata:before.Metadata, ContentDisposition:header };
      if (file.size <= partSize) {
        const bytes=await readFile(`${root}/objects/${object.bucket_id}/${object.name}`);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),file.source_sha256);
        await client.send(new PutObjectCommand({ ...common, Body:bytes }));
      } else {
        const upload=await client.send(new CreateMultipartUploadCommand(common));
        const handle=await open(`${root}/objects/${object.bucket_id}/${object.name}`,'r');
        const sha=createHash('sha256');
        try {
          const parts=[];
          for(let start=0,part=1; start<file.size; start+=partSize,part++) {
            const length=Math.min(partSize,file.size-start);
            const bytes=Buffer.alloc(length);
            assert.equal((await handle.read(bytes,0,length,start)).bytesRead,length);
            sha.update(bytes);
            const copy=await client.send(new UploadPartCopyCommand({ ...target, UploadId:upload.UploadId, PartNumber:part, CopySource:`${object.bucket_id}/${object.name.split('/').map(encodeURIComponent).join('/')}`, CopySourceRange:`bytes=${start}-${start+length-1}` }));
            const etag=copy.CopyPartResult.ETag;
            assert.equal(etag.replaceAll('"',''),createHash('md5').update(bytes).digest('hex'),'Copied part differs from private byte backup');
            parts.push({ PartNumber:part, ETag:etag });
          }
          assert.equal(sha.digest('hex'),file.source_sha256);
          await client.send(new CompleteMultipartUploadCommand({ ...target, UploadId:upload.UploadId, MultipartUpload:{ Parts:parts } }));
        } catch(error) {
          await client.send(new AbortMultipartUploadCommand({ ...target, UploadId:upload.UploadId }));
          throw error;
        } finally {await handle.close();}
      }
    }
    const after=await client.send(new HeadObjectCommand(target));
    assert.equal(after.ETag,before.ETag,'Content identity must remain unchanged');
    assert.equal(after.ContentDisposition,header);
    assert.equal(after.ContentType,before.ContentType);
    assert.equal(after.CacheControl,before.CacheControl);
    assert.deepEqual(after.Metadata,before.Metadata);
    results.push({ path:object.name, bytes:file.size, etagUnchanged:true, metadataUnchanged:true, contentDisposition:header });
    if(results.length%10===0)console.log(`Download headers verified ${results.length}/${verified.length}`);
  }
}
await Promise.all([worker(),worker()]);
await writeFile(`${root}/download-header-verification.json`,JSON.stringify(results,null,2),{mode:0o600});
console.log(`Native download headers verified for ${results.length} original objects; content identity unchanged`);

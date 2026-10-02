// Copy originals from private object storage into Cloudflare Stream.
// Run: node --env-file=.env.local scripts/stream-ingest.mjs [--limit 1]
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { db, storage, cfBase, cfHeaders, cloudflareVideos } from "./media-services.mjs";
await db.connect();
try {
  const videos=(await db.query("SELECT * FROM media WHERE mime_type LIKE 'video/%' AND deleted_at IS NULL")).rows;
  const existing=await cloudflareVideos();
  const index=process.argv.indexOf('--limit');
  const limit=index===-1?Infinity:Number(process.argv[index+1]);
  let copied=0;
  for(const video of videos) {
    const found=existing.find(v=>v.meta?.media_id===video.id);
    if(found) {
      if(found.readyToStream) await db.query('UPDATE media SET stream_uid=$1 WHERE id=$2',[found.uid,video.id]);
      continue;
    }
    if(copied>=limit) continue;
    const url=await getSignedUrl(storage,new GetObjectCommand({Bucket:'media',Key:video.file_path}),{expiresIn:3600});
    const response=await fetch(`${cfBase}/copy`,{method:'POST',headers:{...cfHeaders,'Content-Type':'application/json'},body:JSON.stringify({url,meta:{name:video.file_name,media_id:video.id,source_path:video.file_path}})});
    const json=await response.json();
    if(!response.ok || !json.success) throw new Error('Stream copy failed');
    console.log(`Queued video ${video.id}; run stream-status after processing`);
    copied++;
  }
  console.log(`${copied} videos queued`);
} finally { await db.end(); }

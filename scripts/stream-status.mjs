// Run: node --env-file=.env.local scripts/stream-status.mjs
// Add --apply to attach ready Stream videos to their gallery records.
import { db, cloudflareVideos } from './media-services.mjs';
const videos=await cloudflareVideos();
if(process.argv.includes('--apply')) await db.connect();
try {
  for(const video of videos) {
    console.log(`${video.uid}: ${video.status?.state || 'unknown'}`);
    if(process.argv.includes('--apply') && video.readyToStream && video.meta?.media_id) {
      await db.query('UPDATE media SET stream_uid=$1 WHERE id=$2 AND deleted_at IS NULL',[video.uid,video.meta.media_id]);
    }
  }
  console.log(`${videos.filter(v=>v.readyToStream).length}/${videos.length} ready`);
} finally { if(process.argv.includes('--apply')) await db.end(); }

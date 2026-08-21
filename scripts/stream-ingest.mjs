// One-time (idempotent) ingest: copy each Supabase-hosted video into Cloudflare
// Stream via the "copy from URL" API. Cloudflare pulls the original server-side
// and transcodes it to adaptive HLS/DASH — no local download/transcode here.
//
// Usage:
//   node scripts/stream-ingest.mjs            # ingest all videos not yet in Stream
//   node scripts/stream-ingest.mjs --limit 1  # just one (dry test)
//
// Requires NEXT_PUBLIC_SUPABASE_* and CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_STREAM_TOKEN
// in .env.local. Writes a manifest of {media_id -> stream_uid, playback} to tmp.

import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function loadEnv() {
  const path = new URL("../.env.local", import.meta.url);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_STREAM_TOKEN;
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, CF_ACCOUNT, CF_TOKEN })) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1); }
}

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const publicUrl = (p) => `${SUPABASE_URL}/storage/v1/object/public/media/${p}`;
const cfBase = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/stream`;
const cfHeaders = { Authorization: `Bearer ${CF_TOKEN}` };

async function listExistingByMediaId() {
  // Map any already-ingested videos back to their media id via meta, so re-runs
  // don't create duplicates.
  const seen = new Map();
  const res = await fetch(`${cfBase}?limit=1000`, { headers: cfHeaders });
  const json = await res.json();
  for (const v of json.result || []) {
    const id = v.meta?.media_id;
    if (id) seen.set(id, v.uid);
  }
  return seen;
}

async function copyFromUrl(video) {
  const res = await fetch(`${cfBase}/copy`, {
    method: "POST",
    headers: { ...cfHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: publicUrl(video.file_path),
      meta: { name: video.file_name, media_id: video.id, source_path: video.file_path },
    }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result; // { uid, playback:{hls,dash}, thumbnail, preview, status:{state}, ... }
}

async function main() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/media?select=id,file_path,file_name,file_size&mime_type=like.video/*&order=created_at.asc`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  const videos = await res.json();
  const existing = await listExistingByMediaId();

  const todo = videos.filter((v) => !existing.has(v.id)).slice(0, LIMIT);
  console.log(`${videos.length} video(s) in Supabase; ${existing.size} already in Stream; ingesting ${todo.length}.`);

  const manifest = [];
  let ok = 0, failed = 0;
  for (const v of todo) {
    process.stdout.write(`• ${v.file_name} (${(v.file_size / 1e6).toFixed(0)}MB) … `);
    try {
      const r = await copyFromUrl(v);
      manifest.push({
        media_id: v.id,
        file_name: v.file_name,
        stream_uid: r.uid,
        hls: r.playback?.hls || null,
        dash: r.playback?.dash || null,
        thumbnail: r.thumbnail || null,
        state: r.status?.state || null,
      });
      console.log(`queued (uid ${r.uid}, state ${r.status?.state})`);
      ok++;
    } catch (err) {
      console.log(`FAILED: ${err.message || err}`);
      failed++;
    }
  }

  // Include already-existing ones in the manifest too, for a complete mapping.
  for (const v of videos) {
    if (existing.has(v.id) && !manifest.some((m) => m.media_id === v.id)) {
      manifest.push({ media_id: v.id, file_name: v.file_name, stream_uid: existing.get(v.id), preexisting: true });
    }
  }

  const manifestPath = join(tmpdir(), "stream-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDone. ${ok} queued, ${failed} failed. Manifest: ${manifestPath}`);
  console.log(`Transcoding is async — check state with: node scripts/stream-status.mjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });

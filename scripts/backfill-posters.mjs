// One-time (idempotent) backfill: generate poster thumbnails for videos that
// don't have one yet. Extracts a single frame with ffmpeg using HTTP input
// seeking, so it reads only a few MB over range requests instead of
// downloading the whole (often multi-GB) original.
//
// Usage:
//   node scripts/backfill-posters.mjs           # process all posterless videos
//   node scripts/backfill-posters.mjs --limit 1 # process just one (dry test)
//
// Requires ffmpeg + ffprobe on PATH and NEXT_PUBLIC_SUPABASE_* in .env.local.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const execFileP = promisify(execFile);

// Minimal .env.local loader (no dotenv dependency).
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
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const publicUrl = (p) => `${SUPABASE_URL}/storage/v1/object/public/media/${p}`;

async function probeDuration(url) {
  try {
    const { stdout } = await execFileP("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      url,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : null;
  } catch {
    return null;
  }
}

async function runFfmpeg(url, outPath, seekSeconds) {
  // -ss before -i = input seeking (grabs the frame cheaply over HTTP range
  // requests). Returns true only if a frame was actually written.
  await execFileP("ffmpeg", [
    "-y",
    "-ss", String(seekSeconds),
    "-i", url,
    "-frames:v", "1",
    "-q:v", "4",
    "-vf", "scale='min(1280,iw)':-2",
    outPath,
  ]).catch(() => {});
  return existsSync(outPath);
}

async function extractPoster(url, outPath, duration) {
  // Pick a seek point inside the clip; short clips would seek past the end at a
  // fixed offset. Fall back to the very first frame if the seek yields nothing.
  const seek = duration && duration > 0 ? Math.min(1, duration / 2) : 0;
  if (await runFfmpeg(url, outPath, seek)) return;
  if (seek > 0 && (await runFfmpeg(url, outPath, 0))) return;
  throw new Error("ffmpeg produced no frame");
}

async function main() {
  const { data, error } = await supabase
    .from("media")
    .select("id, file_path, file_name, mime_type, duration")
    .like("mime_type", "video/*")
    .is("poster_path", null)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const videos = data.slice(0, LIMIT);
  console.log(`Found ${data.length} posterless video(s); processing ${videos.length}.`);

  // The `media` table has no anon UPDATE policy, so this script only uploads
  // the poster object (anon INSERT into storage is allowed) and records the
  // intended row change. The poster_path/duration are applied to the DB
  // separately with elevated privileges (see the printed manifest).
  const manifest = [];
  let ok = 0;
  let failed = 0;
  for (const v of videos) {
    const uuid = v.file_path.replace(/\.[^.]+$/, "");
    const posterPath = `posters/${uuid}.jpg`;
    const tmp = join(tmpdir(), `poster-${uuid}.jpg`);
    const url = publicUrl(v.file_path);
    process.stdout.write(`• ${v.file_name} … `);
    try {
      const duration = v.duration ?? (await probeDuration(url));
      await extractPoster(url, tmp, duration);
      const bytes = await readFile(tmp);

      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(posterPath, bytes, {
          contentType: "image/jpeg",
          cacheControl: "31536000",
          upsert: true,
        });
      if (upErr) throw upErr;

      await unlink(tmp).catch(() => {});
      manifest.push({ id: v.id, poster_path: posterPath, duration });
      console.log(`ok (poster ${(bytes.length / 1024).toFixed(0)}KB, ${duration ? duration.toFixed(1) + "s" : "no duration"})`);
      ok++;
    } catch (err) {
      await unlink(tmp).catch(() => {});
      console.log(`FAILED: ${err.message || err}`);
      failed++;
    }
  }

  const manifestPath = join(tmpdir(), "poster-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
  console.log(`Manifest (apply poster_path/duration to DB with elevated role): ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { z } from "zod";
import { revalidateTag } from "next/cache";
import { gallery, writeAs } from "@/lib/server/db";
import { FRIENDS, failure, uploader, verify, ApiError } from "@/lib/server/security";
import { objectInfo, generateImages } from "@/lib/server/storage";

export async function GET(request: Request) {
  try {
    const input = new URL(request.url).searchParams;
    const offset = z.coerce.number().int().min(0).max(100000).parse(input.get("offset") || 0);
    const limit = z.coerce.number().int().min(1).max(100).parse(input.get("limit") || 100);
    const all = await gallery();
    return Response.json(all.slice(offset, offset + limit), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
const insertSchema = z.object({ receipt: z.string().max(4096), posterReceipt: z.string().max(4096).nullable(), taken_at: z.string().datetime().nullable(), width: z.number().int().positive().max(100000).nullable(), height: z.number().int().positive().max(100000).nullable(), camera_model: z.string().max(200).nullable(), latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(), duration: z.number().nonnegative().max(86400).nullable() });
export async function POST(request: Request) {
  try {
    const name = await uploader(request);
    const input = insertSchema.parse(await request.json());
    const receipt = verify(input.receipt);
    if (receipt.kind !== "complete" || receipt.owner !== name || typeof receipt.key !== "string" || typeof receipt.type !== "string" || typeof receipt.filename !== "string" || typeof receipt.size !== "number" || receipt.key.startsWith("posters/")) throw new ApiError(403, "Invalid upload receipt");
    const original = await objectInfo(receipt.key);
    if (original.ContentLength !== receipt.size || original.ContentType !== receipt.type) throw new ApiError(400, "Original missing or changed");
    let poster: string | null = null;
    if (input.posterReceipt) {
      const p = verify(input.posterReceipt);
      if (p.kind !== "complete" || p.owner !== name || typeof p.key !== "string" || !p.key.startsWith("posters/") || p.type !== "image/jpeg") throw new ApiError(403, "Invalid poster receipt");
      await objectInfo(p.key);
      poster = p.key;
      await generateImages(poster, "image/jpeg");
    }
    if (receipt.type.startsWith("image/")) await generateImages(receipt.key, receipt.type);
    const row = await writeAs(name, async client => {
      const existing = await client.query("SELECT * FROM media WHERE file_path=$1", [receipt.key]);
      if (existing.rows.length) throw new ApiError(409, "File already registered");
      const result = await client.query("INSERT INTO media(file_name,file_path,file_size,mime_type,uploaded_by,poster_path,duration,taken_at,width,height,camera_model,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *", [receipt.filename,receipt.key,receipt.size,receipt.type,name,poster,input.duration,input.taken_at,input.width,input.height,input.camera_model,input.latitude,input.longitude]);
      return result.rows[0];
    });
    revalidateTag("media", { expire: 0 });
    return Response.json(row, { status: 201 });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const name = await uploader(request);
    const { ids, uploaded_by } = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), uploaded_by: z.string().refine(name => FRIENDS.includes(name)) }).parse(await request.json());
    await writeAs(name, client => client.query("UPDATE media SET uploaded_by=$1 WHERE id=ANY($2::uuid[]) AND deleted_at IS NULL", [uploaded_by,ids]));
    revalidateTag("media", { expire: 0 });
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const name = await uploader(request);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).parse(await request.json());
    await writeAs(name, async client => {
      const { rows } = await client.query("SELECT id,uploaded_by FROM media WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL FOR UPDATE", [ids]);
      if (rows.length !== new Set(ids).size) throw new ApiError(404, "Item missing");
      if (rows.some(row => row.uploaded_by !== name)) throw new ApiError(403, "Only your own items can be deleted");
      await client.query("UPDATE media_objects SET is_public=false WHERE name IN (SELECT file_path FROM media WHERE id=ANY($1::uuid[]) UNION SELECT poster_path FROM media WHERE id=ANY($1::uuid[]))", [ids]);
      await client.query("UPDATE media SET deleted_at=now() WHERE id=ANY($1::uuid[])", [ids]);
    });
    revalidateTag("media", { expire: 0 });
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}

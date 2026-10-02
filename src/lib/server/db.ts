import "server-only";
import { Pool, types, type PoolClient } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { cacheLife, cacheTag } from "next/cache";
import type { MediaItem } from "../media";

types.setTypeParser(20, Number);
let pool: Pool | undefined;
function database() {
  if (!pool) {
    if (!process.env.APP_DATABASE_URL) throw new Error("APP_DATABASE_URL missing");
    const url = new URL(process.env.APP_DATABASE_URL);
    url.searchParams.set("sslmode", "verify-full");
    pool = new Pool({ connectionString: url.toString(), max: 3, idleTimeoutMillis: 5000, connectionTimeoutMillis: 15000 });
    attachDatabasePool(pool);
  }
  return pool;
}
export async function query(text: string, values: unknown[] = []) {
  return database().query(text, values);
}
export async function writeAs<T>(uploader: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.uploader', $1, true)", [uploader]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
export async function gallery(): Promise<MediaItem[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  cacheTag("media");
  const { rows } = await query("SELECT id,file_name,file_path,file_size,mime_type,width,height,uploaded_by,taken_at,created_at,camera_model,latitude,longitude,poster_path,duration,stream_uid FROM media ORDER BY COALESCE(taken_at,created_at),id");
  return rows.map(row => ({ ...row, taken_at: row.taken_at?.toISOString() ?? null, created_at: row.created_at?.toISOString() ?? null }));
}
export async function publicObjects(): Promise<string[]> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  cacheTag("media");
  const { rows } = await query("SELECT name FROM media_objects WHERE bucket_id='media' AND is_public");
  return rows.map(row => row.name);
}

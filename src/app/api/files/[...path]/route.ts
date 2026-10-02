import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { gallery, publicObjects } from "@/lib/server/db";
import { BUCKET, storage, derivativeKey } from "@/lib/server/storage";
import { failure, ApiError } from "@/lib/server/security";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path.join("/");
    if (path.includes("..") || path.includes("\\")) throw new ApiError(400, "Invalid path");
    const item = (await gallery()).find(item => item.file_path === path || item.poster_path === path);
    if (!item && !(await publicObjects()).includes(path)) throw new ApiError(404, "File not found");
    const variant = new URL(request.url).searchParams.get("variant");
    if (variant && variant !== "thumb" && variant !== "view") throw new ApiError(400, "Invalid variant");
    if (variant) {
      if (!item) throw new ApiError(404, "Image variant not found");
      if (path === item.file_path && !item.mime_type.startsWith("image/")) throw new ApiError(400, "Video has no image variant");
      const result = await storage().send(new GetObjectCommand({ Bucket: BUCKET, Key: derivativeKey(path, variant as "thumb" | "view") }));
      const bytes = await result.Body!.transformToByteArray();
      return new Response(bytes as BodyInit, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
    }
    // Large originals go directly from object storage to the browser.
    const url = await getSignedUrl(storage(), new GetObjectCommand({ Bucket: BUCKET, Key: path }), { expiresIn: 900 });
    return Response.redirect(url, 307);
  } catch (error) { return failure(error); }
}

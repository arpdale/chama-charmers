import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storage, BUCKET, objectInfo, downloadDisposition } from "@/lib/server/storage";
import { uploader, sign, verify, failure, ApiError } from "@/lib/server/security";

const types = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "video/mp4", "video/quicktime", "video/x-msvideo", "video/3gpp"];
const schema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("initiate"), name: z.string().min(1).max(255), type: z.enum(types as [string, ...string[]]), size: z.number().int().positive().max(5 * 1024 ** 3), poster: z.boolean().optional() }),
  z.object({ operation: z.literal("part"), token: z.string().max(4096), part: z.number().int().min(1).max(1024) }),
  z.object({ operation: z.literal("complete"), token: z.string().max(4096), parts: z.array(z.object({ PartNumber: z.number().int().positive().max(1024), ETag: z.string().min(1).max(200) })).min(1).max(1024) }),
  z.object({ operation: z.literal("abort"), token: z.string().max(4096) }),
]);
export async function POST(request: Request) {
  try {
    const name = await uploader(request);
    const input = schema.parse(await request.json());
    if (input.operation === "initiate") {
      if (input.type.startsWith("image/") && input.size > 50 * 1024 ** 2) throw new ApiError(400, "Images must be 50 MB or smaller");
      if (input.poster && (input.type !== "image/jpeg" || input.size > 10 * 1024 ** 2)) throw new ApiError(400, "Invalid poster");
      const ext = input.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 12) || "bin";
      const key = `${input.poster ? "posters/" : ""}${randomUUID()}.${ext}`;
      const result = await storage().send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: input.type, ContentDisposition: downloadDisposition(input.name), CacheControl: "public, max-age=31536000, immutable", Metadata: { uploaded_by: name } }));
      return Response.json({ token: sign({ kind: "multipart", key, uploadId: result.UploadId, owner: name, size: input.size, type: input.type, filename: input.name, exp: Date.now() + 86400000 }), key, chunkSize: 8 * 1024 ** 2 });
    }
    const token = verify(input.token);
    if (token.kind !== "multipart" || token.owner !== name || typeof token.key !== "string" || typeof token.uploadId !== "string") throw new ApiError(403, "Invalid upload ownership");
    const target = { Bucket: BUCKET, Key: token.key, UploadId: token.uploadId };
    if (input.operation === "part") {
      const count = Math.ceil(Number(token.size) / (8 * 1024 ** 2));
      if (input.part > count) throw new ApiError(400, "Invalid part");
      const length = input.part === count ? Number(token.size) - (count - 1) * 8 * 1024 ** 2 : 8 * 1024 ** 2;
      const url = await getSignedUrl(storage(), new UploadPartCommand({ ...target, PartNumber: input.part, ContentLength: length }), { expiresIn: 900 });
      return Response.json({ url });
    }
    if (input.operation === "abort") {
      await storage().send(new AbortMultipartUploadCommand(target));
      return Response.json({ ok: true });
    }
    const expectedCount = Math.ceil(Number(token.size) / (8 * 1024 ** 2));
    if (input.parts.length !== expectedCount || input.parts.some((part, i) => part.PartNumber !== i + 1)) throw new ApiError(400, "Invalid parts");
    await storage().send(new CompleteMultipartUploadCommand({ ...target, MultipartUpload: { Parts: input.parts } }));
    const head = await objectInfo(token.key);
    if (head.ContentLength !== token.size || head.ContentType !== token.type) throw new ApiError(400, "Uploaded file differs from declaration");
    return Response.json({ key: token.key, receipt: sign({ ...token, kind: "complete", exp: Date.now() + 86400000 }) });
  } catch (error) { return failure(error); }
}

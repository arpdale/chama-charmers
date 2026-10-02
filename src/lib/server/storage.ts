import "server-only";
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import heicConvert from "heic-convert";

export const BUCKET = "media";
let client: S3Client | undefined;
export function storage() {
  if (!client) client = new S3Client({ forcePathStyle: true, endpoint: process.env.AWS_ENDPOINT_URL_S3, region: process.env.AWS_REGION, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  return client;
}
export const derivativeKey = (key: string, variant: "thumb" | "view") => `derived/${variant}/${key}.jpg`;
export async function generateImages(key: string, mime: string) {
  const original = await storage().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  let bytes: Buffer = Buffer.from(await original.Body!.transformToByteArray());
  if (/hei[cf]/i.test(mime)) bytes = Buffer.from(await heicConvert({ buffer: bytes, format: "JPEG", quality: 0.9 }));
  await Promise.all((["thumb", "view"] as const).map(async variant => {
    const image = sharp(bytes).rotate().resize(variant === "thumb" ? { width: 800, height: 440, fit: "inside", withoutEnlargement: true } : { width: 2000, withoutEnlargement: true });
    const body = await image.jpeg({ quality: variant === "thumb" ? 75 : 90 }).toBuffer();
    await storage().send(new PutObjectCommand({ Bucket: BUCKET, Key: derivativeKey(key, variant), Body: body, ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable" }));
  }));
}
export async function objectInfo(key: string) { return storage().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); }

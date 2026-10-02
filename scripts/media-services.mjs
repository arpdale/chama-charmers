import pg from 'pg';
import { S3Client } from '@aws-sdk/client-s3';
export const db = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
export const storage = new S3Client({ forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
export const cfBase = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`;
export const cfHeaders = { Authorization: `Bearer ${process.env.CLOUDFLARE_STREAM_TOKEN}` };
export async function cloudflareVideos() {
  const response = await fetch(`${cfBase}?limit=1000`, { headers: cfHeaders });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error('Cloudflare Stream request failed');
  return json.result;
}

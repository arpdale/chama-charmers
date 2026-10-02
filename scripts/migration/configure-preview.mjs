import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
assert.equal(process.env.NEON_BRANCH, 'migration-verification');
const keys = ['APP_DATABASE_URL','SESSION_SECRET','UPLOAD_ACCESS_TOKEN','MIGRATION_READ_ONLY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_ENDPOINT_URL_S3','AWS_REGION','NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER'];
for (const key of keys) {
  assert(process.env[key], `${key} missing`);
  const result = spawnSync('vercel', ['env','add',key,'preview','migration/neon-cloudflare','--yes','--force','--scope','arpdale'], { input: process.env[key] + '\n', encoding:'utf8' });
  if (result.status !== 0) {
    let diagnostic = `${result.status}/${result.signal}: ${result.error?.message || ''} ${result.stderr} ${result.stdout}`;
    for (const value of keys.map(k => process.env[k]).filter(Boolean)) diagnostic = diagnostic.split(value).join('[redacted]');
    throw new Error(`Unable to configure ${key}: ${diagnostic}`);
  }
  console.log(`Configured preview ${key}`);
}

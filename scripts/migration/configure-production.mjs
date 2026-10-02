import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
assert.equal(process.env.NEON_BRANCH, 'production');
await access('.migration-private/vercel-before-cutover.env');
const keys = ['APP_DATABASE_URL','SESSION_SECRET','UPLOAD_ACCESS_TOKEN','MIGRATION_READ_ONLY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_ENDPOINT_URL_S3','AWS_REGION','NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER'];
const enableWrites = process.argv.includes('--enable-writes');
for (const key of enableWrites ? ['MIGRATION_READ_ONLY'] : keys) {
  const value = key === 'MIGRATION_READ_ONLY' ? String(!enableWrites) : process.env[key];
  assert(value, `${key} missing`);
  const result = spawnSync('vercel', ['env','add',key,'production','--yes','--force','--scope','arpdale'], { input:value+'\n',encoding:'utf8' });
  if(result.status !== 0) throw new Error(`Unable to configure ${key}; diagnostics withheld to protect credentials`);
  console.log(`Configured production ${key}`);
}
for (const key of enableWrites ? [] : ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  const result = spawnSync('vercel',['env','rm',key,'production','--yes','--scope','arpdale'],{encoding:'utf8'});
  if(result.status !== 0) throw new Error(`Unable to remove obsolete production ${key}`);
  console.log(`Removed obsolete production ${key}; rollback copy retained privately`);
}

# Supabase to Neon migration

Prepared October 2, 2026 on `migration/neon-cloudflare`. Production cutover requires explicit approval. Supabase remains available for rollback; nothing there has been deleted or paused.

## Destinations and costs

Neon project `blue-sky-65732888`, `production`, hosts PostgreSQL and the private S3-compatible `media` bucket. The organization already uses Launch. Compute is capped at 0.25 CU and suspends after five idle minutes. Gallery HTML and database reads are cached so browsing does not require an always-running database. Vercel continues hosting the Next.js app. Existing Cloudflare Stream assets continue providing adaptive video playback.

Current published rates:

| Service | Expected cost / billing basis |
| --- | --- |
| Neon original files + image derivatives | About $0.224/month for 9.74 GB at $0.023/GB-month; no operation fees |
| Neon database | $0.35/GB-month storage; Launch compute $0.106/CU-hour, or $0.0265 per active hour at 0.25 CU, including idle time before suspension |
| Neon delivery | 500 GB/month per Launch project shared across products, then $0.10/GB |
| Cloudflare Stream | Existing account capacity: $5/month per 1,000 stored minutes; $1 per 1,000 delivered minutes. Nine existing videos total about 14.36 minutes. Encoding/bandwidth included. |
| Cloudflare R2 alternative | 10 GB storage, 1M write operations, 10M reads free monthly; then $0.015/GB-month, $4.50/M writes, $0.36/M reads. No egress fees. Allowances are shared within the account. |

The connected Cloudflare credential can access Stream but R2 bucket access returned 403. Neon avoids a new credential blocker for approximately 22 cents/month of storage. R2 is preferable for substantial original-download traffic because Neon charges excess egress. R2 itself does not provide Stream's adaptive encoding/player. Files are kept outside PostgreSQL. Any existing Vercel subscription, shared Cloudflare capacity and temporary test-branch usage are additional/shared costs, not included in the storage estimate.

References: [Neon plans](https://neon.com/docs/introduction/plans), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Stream pricing](https://developers.cloudflare.com/stream/pricing/).

## Source inventory

Supabase `rqxkeuvapfnxbusqaeqa`: 11,660,435 database bytes, 69 `public.media` records, zero `auth.users`, no deployed Edge Functions, no application RPCs/triggers or Realtime publication. All media columns, UUIDs, timestamps, EXIF, paths, uploader labels and Stream IDs are preserved. The database uses `gen_random_uuid`; no application dependency on Supabase Vault or provider extensions was found.

Storage has 80 objects totaling 9,664,060,733 bytes: 60 photos, nine original videos and eleven posters, including two unreferenced posters. The `media` bucket was public, with a 5 GiB per-object limit and a media MIME whitelist. Thirty-three photos use HEIC/HEIF. Original object paths, content types, cache-control settings and source metadata are preserved. Native destination modification timestamps differ; original complete metadata is retained in `media_objects.source_record` and S3 metadata.

Existing policies allowed public reads and unrestricted anonymous database/storage writes. The UI used a shared `?upload=<token>` link and self-selected names, not authenticated identities. Zero auth users did not mean authentication was unnecessary. The replacement enforces the shared upload link server-side, issues signed HttpOnly sessions, checks origins and upload ownership, and permits deletion of one's own uploader-labelled items. Names can still be self-selected by anyone holding the link; this is collaboration by shared link, not verified individual identity. Neon Auth is provisioned as requested but is not silently substituted for those semantics.

The private destination bucket is exposed through `/api/files` only for active gallery files or public source inventory objects. Original downloads use short-lived signed redirects. Thumbnails and lightbox JPEGs are served through Vercel with immutable caching. Soft deletion removes public lookup access while retaining database rows and private bytes for recovery. Previously downloaded/cached public media cannot be recalled.

## Application and configuration

Browser Supabase and TUS dependencies are removed. `/api/media`, `/api/session`, `/api/uploads` and `/api/files/[...path]` provide the backend. Direct multipart uploads keep large video bytes out of Vercel functions. Videos retain the original 5 GiB limit; new images are limited to 50 MiB to bound server image-processing memory. Existing images are smaller and remain intact. New video uploads generate posters and initially use native playback; run Stream ingestion/status maintenance to enable adaptive playback, as with the previous maintenance workflow.

Server-only runtime variables: `APP_DATABASE_URL` (restricted `chama_app` role), `SESSION_SECRET`, `UPLOAD_ACCESS_TOKEN`, `MIGRATION_READ_ONLY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION`. Only `NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER` is public. Migration/maintenance additionally uses admin `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_TOKEN`. Never deploy the admin database URL to the application.

`MIGRATION_READ_ONLY` must explicitly equal `false` to permit mutations. Production migration configuration defaults to read-only. The final read-only preview credentials are scoped to Git branch `migration/neon-cloudflare` and the production Neon data. Write tests used a separate immutable deployment linked to `migration-verification`; those test records are excluded from the final preview. Legacy Vercel production Supabase variables remain for rollback until approved cutover; replacement application code does not consume them. Local source variables were moved into private migration-only configuration.

`neon.ts` uses the current GA top-level auth/buckets/functions configuration; `preview.*` is deprecated. The requested hello function is deployed separately from the Vercel application backend. AI Gateway was not enabled by this migration.

## Private backups and verification

`.local-backups/2026-10-02` contains schema/data SQL dumps, complete source JSON, per-row PostgreSQL checksums, all original bytes, object SHA-256/MD5/size manifests, destination verification manifests and derivative checksums. `.migration-private` contains configuration and test evidence. Both are ignored by Git and Vercel; backup folders have private permissions. Keep a private encrypted off-device copy before retiring Supabase; a local backup alone does not protect against loss of this computer.

All 69 source rows matched the target's exact PostgreSQL JSONB checksums, including a fresh source recheck. Complete storage inventory metadata matched PostgreSQL checksum `3d957d230e50a187b7dc4414f0cee01f`. The portable JSON backup was restored into `restore_check` on the isolated test branch: all 69 row checksums and 80 inventory records matched. Provider-specific full SQL dumps should be restored into a compatible Supabase environment; the portable application schema/JSON restore is used for Neon.

138 generated JPEG derivatives total 77,214,370 bytes and have verified readback checksums. The median thumbnail is about 58 KB. The initial HTML contains 36 images and the accurate total of 69 memories, allowing image loading before hydration; remaining images load on scroll. A read-only hosted check measured about 251 ms HTML response start, with no initial pagination API request. Mobile pagination reached all 69 items without horizontal overflow. Original objects are verified by reading back all bytes, comparing SHA-256, size, MIME, cache-control and preserved metadata. All 80 originals completed verification: 9,664,060,733 bytes, with matching SHA-256, size, MIME and metadata. Native attachment headers were verified for all 80 without changing ETags or original bytes; multipart-copy part checksums matched the private backups. A partial manifest is not completion evidence.

The API integration test verified 26 local and 25 hosted checks, multipart upload/download SHA-256, derivative generation, reassignment, soft deletion, unsigned storage denial and restricted-role RLS/DDL/delete failures. Browser checks cover gallery/filtering, HEIC display and a checksum-matching original download, lightbox, multipart photo upload, hosted HEIC/video/poster upload, Cloudflare Stream playback, uploader reassignment and deletion. No Supabase requests or browser errors were observed. Local lint/build passed; the actual Vercel preview built successfully with Node 24. The existing Vercel account is Pro; its existing subscription and usage charges are shared costs. See private verification files for final evidence and any remaining checks.

## Commands and recovery

Use private environment files; never paste credentials into shell arguments or commit them:

```sh
node --env-file=.migration-private/source.env scripts/migration/backup-storage.mjs
node --env-file=.env.local scripts/migration/import-database.mjs
node --env-file=.env.local scripts/migration/transfer-storage.mjs
node --env-file=.env.local scripts/migration/set-download-headers.mjs
node --env-file=.env.local scripts/migration/generate-derivatives.mjs
node --env-file=.env.local scripts/migration/check-ready.mjs
node --env-file=.migration-private/test.env scripts/migration/verify-app.mjs
node --env-file=.migration-private/test.env scripts/migration/verify-restore.mjs
```

`verify-app` mutates only `migration-verification` and requires the isolated app at port 3001 by default. The restore test creates a separate schema and refuses an existing schema. `import-database` refuses unexpected target contents; it is an initial import/restore tool, not a conflict-merging synchronizer. Storage transfer refuses unexpected existing objects. Restore missing originals from the private byte backup using their manifest and metadata, then regenerate derivatives. Reconnect the restricted application role and verify checksums before serving traffic.

For a fresh frozen snapshot, run `export-source.sql` through the Supabase SQL MCP connection and save its `export` value as private JSON. Set `MIGRATION_BACKUP_DIR` to a new directory inside `.local-backups` and run `save-source-export.mjs <private-json-file>`. All import/transfer/derivative/check scripts accept this variable. The splitter refuses existing snapshots. Take fresh schema/data dumps alongside this portable snapshot. Never overwrite the initial backup or use a stale snapshot for final synchronization.

## Proposed cutover procedure (not yet executed)

1. Capture exact source grants and policy definitions privately. Stop every maintenance writer. Apply `scripts/migration/freeze-source.sql` only after explicit approval. Test old database and Storage write credentials and wait for in-flight operations. If any writer still succeeds, stop.
2. Take fresh source schema/data dumps, media rows/checksums and complete object inventory. Compare with the immutable initial backup. Source remains frozen throughout final sync. If any rows/files changed, import the fresh source-authoritative state into a fresh Neon branch and migrate/verify its complete object set before promotion; do not overwrite conflicting target writes. Keep the initial source and target snapshot intact.
3. Verify all rows/files and build a production-environment deployment with production Neon credentials and writes disabled. Test the immutable deployment directly. Do not promote the test-branch preview as production: it contains test records.
4. Remove obsolete Supabase variables from new production configuration after preserving rollback configuration. Promote the verified production deployment, verify the public domain, then enable target writes and test one controlled write. Old source writes remain disabled so stale clients cannot create split-brain data.
5. Continue retaining Supabase and all private backups until the user explicitly authorizes retirement. Old external Supabase URLs cannot be redirected from that vendor hostname; they continue working while the source is retained.

Before target writes begin, rollback can restore the previous Vercel deployment/configuration and exact source grants. After target writes begin, first disable target writes, export every new/changed/deleted row and original/poster file, reconcile these into Supabase and verify them, then switch traffic back and restore source writes. Repointing alone would lose target-era changes. Soft-deleted rows and private originals allow this reconciliation. No cleanup, cancellation or retirement is authorized by approval of cutover alone.

# Asset Attachment Object Storage Runbook

This runbook covers the current production-facing contract for asset attachment byte storage. It is intentionally scoped to object storage configuration, validation, orphan audit status, known failure modes, and opt-in integration test guidance.

This is not a formal backend-ready sign-off.

## Env contract

Attachment bytes default to local filesystem storage. Object storage is enabled only when the provider is explicitly set to `s3`.

Required and supported settings:

- `ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER=local|s3`
  - Missing or `local` keeps local filesystem storage.
  - `s3` enables the S3-compatible provider and fails closed if the bucket is missing.
- `ASSET_LOCK_ATTACHMENT_S3_BUCKET`
  - Required only when `ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER=s3`.
  - Use the real bucket name only in deployment configuration. Do not commit it to docs, code, tests, or fixtures.
- `ASSET_LOCK_ATTACHMENT_S3_PREFIX`
  - Optional object key prefix.
  - Defaults to `asset-lock-attachments`.
  - Must not contain empty, `.`, or `..` path segments.
- `ASSET_LOCK_ATTACHMENT_S3_REGION`
  - Optional region override.
  - If unset, the AWS SDK config falls back to `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `us-east-1`.
- `ASSET_LOCK_ATTACHMENT_S3_ENDPOINT`
  - Optional S3-compatible endpoint, typically used for MinIO or non-AWS providers.
- `ASSET_LOCK_ATTACHMENT_S3_FORCE_PATH_STYLE`
  - Optional boolean.
  - `true` or `1` enables path-style addressing for S3-compatible stores such as many MinIO deployments.

Placeholder shape only:

```sh
ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER=s3
ASSET_LOCK_ATTACHMENT_S3_BUCKET=<asset-attachment-bucket>
ASSET_LOCK_ATTACHMENT_S3_PREFIX=<environment-prefix>/asset-lock-attachments
ASSET_LOCK_ATTACHMENT_S3_REGION=<region>
ASSET_LOCK_ATTACHMENT_S3_ENDPOINT=<optional-s3-compatible-endpoint>
ASSET_LOCK_ATTACHMENT_S3_FORCE_PATH_STYLE=<true-for-minio-or-path-style>
```

Do not include real bucket secrets, access keys, session tokens, credentials, or database connection strings in this file, in pull requests, or in test logs.

## Security boundary

- The bucket name is provider configuration only. It is not persisted in the database and must not be returned by API responses.
- `storage_key` and `checksum_sha256` are internal repository metadata. They are persisted as sidecar fields for storage reads and integrity checks, but they do not enter the domain `AssetAttachment` shape or attachment API responses.
- Route error handling is allowlist-based. Known attachment errors map to stable API error codes/statuses, while unknown provider, S3, SDK, or raw storage errors fall back to a stable route error instead of echoing the provider error text.
- Object keys are validated before local writes, S3 writes, reads, and deletes to prevent absolute paths, traversal segments, invalid file IDs, and invalid file extensions.
- Orphan audit reports must not expose raw object keys, bucket names, endpoints, credentials, or database connection strings.

## Upload/download integrity

Upload verification:

- Local storage writes the attachment bytes and verifies the resulting file size with `stat`.
- S3-compatible storage sends SHA-256 checksum metadata on `PutObject`, then verifies the stored object with `HeadObject`.
- S3 upload verification checks both `ContentLength` and the stored `checksum-sha256` metadata.
- If S3 put verification fails, the implementation attempts best-effort object cleanup and returns the stable `asset_attachment_storage_verification_failed` error, mapped to HTTP `502`.

Download verification:

- Download reads use persisted `storage_key` when present.
- Legacy rows without a persisted storage key fall back to the derived key from `fileId` and file extension.
- Downloaded bytes must match the attachment metadata size.
- When `checksum_sha256` is present, downloaded bytes must also match that checksum.
- Size or checksum mismatch returns the stable `asset_attachment_file_integrity_failed` error, mapped to HTTP `409`.
- Missing storage objects return `asset_attachment_file_not_found`, mapped to HTTP `404`.

## Storage metadata constraints

The nullable-safe storage metadata constraints are merged on `main`: `d95cbd7` (`d95cbd7ed3750343f86d3fdcfc305bd1d20e4d30`) with merge record `477f8432792726b4c05145cfa07815270195056b`.

Current DB constraints:

- `checksum_sha256` must be lowercase 64-character hex when present.
- `checksum_sha256` still allows NULL.
- `storage_key` must be nonblank after trim when present.
- `storage_key` still allows NULL.
- Raw `storage_key` values are unique when present; the constraint allows multiple NULL rows and rejects duplicate non-NULL raw keys.

This is a nullable-safe constraints step only. It does not complete production backfill, does not make `storage_key` or `checksum_sha256` NOT NULL, and does not remove the legacy derived-key fallback.

## Orphan audit status

The first audit-only orphan object phase is merged on `main`: `0cb1dcd` (`0cb1dcd6ebbdcf525d7424cd9a2caef2e3be1d74`) with the merge record `7d2acc2883ce65da4cdc9166370d0203fffd4aef`.

Current audit-only capabilities:

- Local object listing through the filesystem audit adapter.
- S3-compatible object listing through `ListObjectsV2`.
- DB referenced-key set comparison against provider-listed objects.
- Referenced key resolution prefers persisted `storage_key`.
- Legacy rows fall back to `fileId + extname(fileName)`.
- Both `active` and `deleted` attachment metadata rows count as referenced, so soft-deleted metadata still protects its object from orphan classification.
- The default grace period is 24 hours.
- Unreferenced objects are classified as `orphan_candidate`, `young`, or `unknown_age`.
- The report exposes aggregate counts, total candidate size, reason counts, age buckets, and bounded item rows.
- Item rows expose only `keyHash`, `sizeBytes`, `reason`, and optional `ageMs` / `ageBucket`; they do not expose raw object keys, buckets, endpoints, or provider details.

Still incomplete:

- No orphan cleanup/delete implementation is complete.
- No production scheduler exists for periodic orphan audits or cleanup.
- No production CLI or API entrypoint is wired for running the orphan audit or cleanup.
- The current audit-only helpers are not a production retention policy.

## Production validation

Before enabling `ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER=s3` in production:

1. Confirm the deployment environment sets the provider and bucket explicitly.
2. Confirm the prefix is environment-scoped rather than a shared root.
3. Confirm the runtime identity has only the object-store permissions required for attachment put, head, get, and delete under the configured prefix.
4. Upload a small supported attachment type through the normal API/UI flow.
5. Download the uploaded attachment and verify the byte length and content are correct.
6. Inspect application logs for stable attachment error codes only; raw provider messages, bucket secrets, credentials, and database connection strings must not appear.
7. Exercise failure handling in a non-production environment by denying or misrouting storage access and confirming the route response remains allowlisted.
8. Run the orphan audit only in an environment where the referenced metadata source and object-store prefix are intentionally paired, and confirm the report contains only hashed keys and aggregate metadata.

## Known operational risks

- Existing or legacy `asset_attachments` rows can have nullable `storage_key` and `checksum_sha256`. Nullable-safe check constraints and raw `storage_key` uniqueness are merged, so check/unique tightening is not wholly pending, but NOT NULL tightening remains future work.
- Production backfill has not actually been executed. Legacy nullable rows can still exist until a production backfill is planned, run, and verified.
- Legacy derived-key fallback is intentional while nullable historical rows exist. Removing it requires a completed backfill and a migration plan.
- Orphan object audit-only support exists, but orphan cleanup/delete is not complete. Failed metadata writes attempt compensating storage delete, and failed S3 verification attempts best-effort cleanup, but periodic object-store reconciliation still needs a scheduler or explicit operational entrypoint.
- Production S3/MinIO integration testing is not part of the default CI path yet. It should remain opt-in because it requires external object-store configuration and credentials.

## Opt-in integration test recommendation

Add S3/MinIO integration coverage behind an explicit opt-in flag rather than default CI. The test should use a disposable bucket or isolated prefix and should never print credentials, bucket secrets, raw object keys, endpoints, or database connection strings.

The repository includes this opt-in suite in `apps/web`. It is not part of `npm test`, `npm run verify`, PR CI, or any GitHub Actions workflow. Run it only when an isolated S3-compatible bucket/prefix is configured:

```sh
npm run test:asset-attachment-object-storage -w apps/web
```

The suite has a second gate and skips unless `ASSET_ATTACHMENT_OBJECT_STORAGE_INTEGRATION=1` is present. Each run writes only below `<ASSET_LOCK_ATTACHMENT_S3_PREFIX>/integration/<yyyyMMdd>/<randomUUID>` and cleanup is scoped to that run prefix.

Recommended coverage:

- Provider resolution fails closed when `ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER=s3` is set without `ASSET_LOCK_ATTACHMENT_S3_BUCKET`.
- Upload writes an object under the configured prefix and verifies put metadata.
- Download returns the same bytes and passes size/checksum verification.
- Missing object maps to `asset_attachment_file_not_found`.
- Corrupt size or checksum fixture maps to `asset_attachment_file_integrity_failed`.
- Provider or SDK failures map through the route allowlist/fallback without exposing raw provider error messages.
- Orphan audit classifies referenced, candidate, young, and unknown-age objects without exposing raw object identifiers.
- Cleanup removes test objects under the disposable prefix, with a follow-up audit that no test objects remain.

Suggested opt-in shape:

```sh
ASSET_ATTACHMENT_OBJECT_STORAGE_INTEGRATION=1
ASSET_LOCK_ATTACHMENT_STORAGE_PROVIDER=s3
ASSET_LOCK_ATTACHMENT_S3_BUCKET=<disposable-test-bucket>
ASSET_LOCK_ATTACHMENT_S3_PREFIX=<disposable-test-prefix>
ASSET_LOCK_ATTACHMENT_S3_REGION=<region>
ASSET_LOCK_ATTACHMENT_S3_ENDPOINT=<optional-minio-endpoint>
ASSET_LOCK_ATTACHMENT_S3_FORCE_PATH_STYLE=<true-for-minio-or-path-style>
```

Keep this suite out of default pull-request CI unless CI provisions an isolated object store and injects secrets through the platform secret manager.

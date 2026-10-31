# Settle: Backblaze B2 storage configuration

Settle now uses the Backblaze B2 S3-compatible API for document uploads, downloads,
and document verification. The bucket remains private; the API issues workspace-scoped
pre-signed URLs with a 15-minute expiry.

## Required production environment variables

```env
B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com
B2_REGION=us-east-005
B2_BUCKET=<your-private-bucket-name>
B2_KEY_ID=<Backblaze-application-key-ID>
B2_APPLICATION_KEY=<Backblaze-application-key>
```

Create an application key in Backblaze with access restricted to this bucket and the
minimum required read/write/list permissions. Keep the key ID and application key only
in the backend API and worker environment. Do not expose them as `VITE_*` or
`NEXT_PUBLIC_*` variables and do not commit them.

`B2_BUCKET`, `B2_KEY_ID`, and `B2_APPLICATION_KEY` take precedence. Legacy
`AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION`
remain as a compatibility fallback when no B2 settings are supplied.

## Bucket configuration

- Bucket type: Private.
- File Lifecycle: Keep all versions (as requested).
- Encryption at rest: Enabled in the Backblaze bucket settings.
- Region/endpoint: `us-east-005` / `https://s3.us-east-005.backblazeb2.com`.

The app intentionally does not send an AWS `x-amz-server-side-encryption` request header.
The bucket's configured server-side encryption policy is authoritative; this avoids
forcing an AWS-specific upload header on the B2 browser pre-signed PUT flow.

## CORS

Configure bucket CORS to allow your exact deployed frontend origin (and localhost only
for development), `PUT`, `GET`, `HEAD`, and the request header `Content-Type`.
Expose `ETag` if your frontend or tooling needs it. Do not use `*` for production origins.
The browser uploads directly to the B2 S3 endpoint using the signed URL, so CORS must
be configured on the B2 bucket, not just on the API server.

## Deploy sequence

1. Create the private B2 bucket in `us-east-005`, keep all versions, and enable encryption.
2. Create a bucket-scoped application key with read/write access.
3. Set the five `B2_*` variables in BOTH the backend API and worker deployments.
4. Deploy the backend and worker together so document verification reads from the same B2 bucket.
5. Update B2 CORS for the frontend's exact origin.
6. Test upload, document registration, asynchronous verification, and signed download.
7. Keep the old S3 bucket and credentials until all old documents have been copied and verified.

## Existing S3 objects

Changing the storage endpoint does not copy existing objects. If the old AWS S3 bucket
contains documents, copy them to B2 while preserving each object key (the database stores
the key, not a provider-specific URL). Use a transfer tool such as rclone with separate
AWS S3 and Backblaze B2 remotes, copy the old bucket contents into the new bucket, then
verify object counts and sample SHA-256 hashes before switching production traffic.
Do not delete the old bucket until verification and a rollback window are complete.

If the old bucket is empty, no object copy is needed. Existing database document rows can
continue to use their existing object keys if those objects are present in B2.

## Smoke test

- Request `POST /v1/documents/upload-url`.
- PUT the file to the returned URL using the returned `required_headers`.
- Register it with `POST /v1/documents`.
- Confirm the worker marks it verified.
- Request `GET /v1/documents/:id/download-url` and open the returned URL.
- Confirm a user in another workspace cannot access the document.

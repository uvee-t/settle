# v0.13.0 — Reliability

- Durable webhook/outbox dispatch state now uses `QUEUED` until the worker actually completes processing.
- Added stale webhook recovery that checks the BullMQ job state before requeueing.
- Added persistent dead-letter records for permanently failed webhook/outbox jobs.
- BullMQ failed/completed jobs are removed before durable retry so deterministic job IDs do not block recovery.
- Outbox failures remain queued during transient BullMQ retries and become `DEAD_LETTERED` only after final failure.
- Webhook success/failure updates now reconcile the corresponding durable outbox record.
- Added migration `0012_reliability_hardening`.
- Removed runtime `.env` from the release and added `.env.example`.

## 0.12.0

- Added Redis-backed concurrency locks for AI defense generation and PayPal evidence submission.
- Added crash recovery for evidence submission using provider-side evidence reconciliation.
- Added `SUBMITTING` evidence submission state.
- Added concrete evidence submission IDs/types to evidence-pack audit metadata.
- Added `.env.example` and removed secret-bearing environment files from release artifacts.

## 0.10.0
- Added milestone delivery and acceptance lifecycle.
- Added verified document attachments to deliveries.
- Added immutable acceptance/rejection event history.
- Added delivery evidence candidates to dispute evidence generation.


## 0.11.0
- Persist dispute-to-payment and dispute-to-invoice links.
- Reconcile PayPal seller transaction IDs only through exact provider identifiers/payload matches; no fuzzy financial matching.
- Correct PayPal response deadline and seller-protection mapping from current dispute payload shapes.
- Evidence collection prefers persisted dispute financial links and only treats accepted deliveries as fulfillment evidence.

## Unreleased — PayPal dispute messaging and Backblaze B2

- Corrected PayPal dispute `send-message` JSON to `{ "message": "<text>" }`.
- Added a regression test for the PayPal message request payload.
- Added Backblaze B2 S3-compatible endpoint, region, bucket, and application-key configuration.
- Kept legacy AWS S3 environment variables as a fallback for a controlled transition.
- Removed the AWS-specific SSE header from browser upload signing; encryption is managed by the configured private B2 bucket.
- Added `BACKBLAZE_B2_MIGRATION.md` and `.env.backblaze.example`.

## Evidence and worker reliability update

- Added exact PayPal evidence-type matching and preflight validation before any external submission.
- Exposed seller-requested PayPal evidence requirements and matched/missing status in the dispute UI.
- Added `OTHER`, refund, receipt, contract, and description evidence types to the attachment selector.
- Preserved manually attached evidence documents when background evidence packs regenerate.
- Added PNG/JPEG/GIF OCR using Tesseract in the worker image.
- Marked permanent document validation failures as terminal skips so scheduled recovery does not retry the same bad file indefinitely.
- Skipped AI dispute analysis when no matching evidence candidates exist.
- Added unit tests for strict evidence-type matching.

# Settle v0.13.3 — Contract-to-Cash Platform

Production-oriented modular monolith for Settle: contracts, milestones, invoices, payments, PayPal synchronization, disputes, evidence, documents, audit logs, idempotency, Redis/BullMQ and transactional outbox processing.


## Frontend

The `frontend/` directory contains the React + Vite application for the existing v1 API. It uses React Router for real URL routes and includes workspace sign-in/registration, overview metrics and charts, cash-flow forecast visualizations, invoice and contract detail workflows, client editing, milestone billing, dispute visibility, document views, and workspace settings.

Start the API and worker in separate terminals, then start the frontend:

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — background workers
npm run worker

# Terminal 3 — frontend
npm run frontend:dev
```

Open `http://localhost:5173`. The default API URL is `http://localhost:4000`; set `SETTLE_API_URL` for the frontend server/container or change it in Settings (the browser remembers it locally). In production, set `CORS_ORIGIN` to the deployed frontend origin. Development explicitly allows Vite on `localhost:5173` and `127.0.0.1:5173`; the API allows PATCH during CORS preflight. Browser-based S3 uploads also require a bucket CORS policy that allows the frontend origin and the required PUT headers.

Frontend syntax and static-server smoke checks:

```bash
npm run frontend:build
```

## Reliability checks

```bash
npm run build
# Optional: configure a dedicated settle_test database first.
cp .env.test.example .env.test
# Edit .env.test, then load it in this shell before the integration tests.
set -a; . ./.env.test; set +a
npm test
```

The PostgreSQL integration tests only run against a database URL ending in `/settle_test`; without `DATABASE_URL`, those tests are skipped. Never point them at a production database.

AI extraction recovery uses stable per-document-content BullMQ job IDs, retries retained failed jobs, pages through the verified-document and successful-run sets, and guards extraction with a Redis lock. Successful extraction reuse is scoped to the workspace, prompt version, document ID, and extracted-text hash, so a result produced by a fallback provider can also be reused. AI recovery remains disabled when `AI_ENABLED` is false. Dead-letter retry/recovery remains deferred; see `docs/Settle_v0.13.0_Deferred_Work_Dead_Letter_Retry.docx`.

### AI provider resilience

The AI gateway supports Gemini, OpenAI-compatible providers, and Groq. Configure the primary provider with `AI_PROVIDER`, `AI_MODEL`, and `AI_API_KEY`. An optional Groq or OpenAI-compatible fallback can be enabled with `AI_FALLBACK_PROVIDER`, `AI_FALLBACK_MODEL`, and `AI_FALLBACK_API_KEY`; set `AI_FALLBACK_BASE_URL` only when using a non-default endpoint.

Fallback is attempted for provider rate limits (HTTP 429), server errors (HTTP 5xx), timeouts, and temporary network failures. Invalid requests, authentication failures, and invalid model output are not silently retried against another provider. Provider secrets are never returned by the AI status endpoint.

AI requests share a Redis-backed fixed-window limit per provider. The defaults are deliberately conservative for free-tier use (`AI_RATE_LIMIT_MAX=4`, `AI_RATE_LIMIT_WINDOW_MS=60000`); adjust them to stay below the quotas for the exact provider/model/account you use. AI BullMQ jobs use exponential retry delays and honor a provider-supplied `Retry-After`/Gemini retry delay when available. Configure the same AI and Redis environment variables for the API and worker processes.

Example optional Groq fallback:

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
AI_API_KEY=your-gemini-key

AI_FALLBACK_PROVIDER=groq
AI_FALLBACK_MODEL=your-enabled-groq-model
AI_FALLBACK_API_KEY=your-groq-key
AI_FALLBACK_BASE_URL=
```

Use model IDs enabled for your own provider account; model availability and free-tier quotas change over time.


## Requirements

- Node.js 22+
- PostgreSQL / Neon
- Redis
- PayPal Sandbox credentials for provider features
- AWS S3 credentials for document features

## Setup

```bash
npm install
cp .env.example .env
npm run db:push
npm run build
npm run start
```

Run background workers separately:

```bash
npm run worker
```

## Health

```bash
curl http://localhost:4000/health
curl http://localhost:4000/health/ready
```

## v0.5.0 financial core

- Invoice lifecycle with guarded transitions
- Transactional invoice + line-item creation
- Idempotency-Key support for invoice creation
- Payment records and payment state transitions
- Invoice/payment reconciliation from PayPal invoice webhooks
- Transactional audit records
- Transactional outbox
- BullMQ outbox dispatcher/worker
- PayPal invoice creation can be executed asynchronously from an outbox event
- Workspace-scoped payment access

## Security

Never commit `.env`, provider secrets, JWT secrets, database credentials, or private S3 credentials. Use a secret manager in production.

The PostgreSQL client dynamically selects a reachable IPv4 address when required by the runtime environment while preserving the Neon hostname for TLS SNI and certificate verification.

## v0.6.0 production hardening

- PayPal webhook ingestion is durable through PostgreSQL + transactional outbox before BullMQ.
- Webhook recovery handles events that were persisted before a process/queue failure.
- JWT failures are normalized to HTTP 401.
- Payment and invoice state transitions are guarded; paid/refunded invoice states are provider-driven.
- Dispute workspace inference and evidence-pack scoping are enforced.
- S3 presigned uploads use SHA-256 checksums and workspace-scoped object keys.
- Automated invoice reminders run through BullMQ and Redis idempotency locks.
- Cash-flow forecast endpoint: `GET /v1/dashboard/cash-flow?days=90`.

## Production environment requirements

Production must provide a non-sandbox PayPal API URL, PayPal credentials and webhook ID, an explicit CORS origin, a strong JWT secret, managed PostgreSQL/Redis, and a private S3 bucket. Keep all secrets outside source control.

Run database migrations in deployment:

```bash
npm run db:generate
npm run db:migrate
```


## Document upload and verification

Documents use workspace-scoped private S3 objects. Uploads require a client-provided SHA-256 checksum and size, are registered only after S3 checksum validation, and are asynchronously verified by the worker. Verification recomputes the checksum, validates content type and filename extension, and can run ClamAV malware scanning. See `docs/V0.7.0.md`.


## v0.8.0 AI + Evidence Intelligence

Settle can now run an asynchronous AI/evidence pipeline. Verified documents can be extracted into structured contract facts with source excerpts and confidence scores. PayPal disputes can be synchronized into a deterministic evidence pack, analyzed by AI, reviewed by an owner/admin, and submitted through the existing PayPal evidence adapter.

AI is disabled by default. Configure `AI_ENABLED=true`, `AI_PROVIDER`, `AI_API_KEY`, and `AI_MODEL` in the environment. Gemini and OpenAI-compatible chat-completions providers are supported without storing provider SDK credentials in source code.

For PDF extraction the production Docker image installs `poppler-utils` and uses `pdftotext`. AI output is validated with Zod and persisted in `ai_runs`; extracted claims are stored with provenance in `evidence_facts`. AI never directly submits a dispute response: approval is required before the evidence-pack submission endpoint can call PayPal.

### AI document extraction

After a verified document is stored, the worker queues `document.extract`. Inspect the result with:

```text
GET /v1/documents/:id/ai-extraction
```

### Dispute defense workflow

```text
PayPal dispute webhook
  -> dispute synchronization
  -> deterministic evidence collection
  -> AI defense analysis
  -> READY_FOR_REVIEW
  -> owner/admin approval
  -> PayPal evidence submission
```

Review endpoints:

```text
GET  /v1/disputes/:disputeId/evidence-pack
POST /v1/disputes/:disputeId/evidence-pack/review
POST /v1/disputes/:disputeId/evidence-pack/submit
```

## React frontend (v0.13.1 update)

The React + Vite frontend lives in `frontend/` and is the single frontend used by Docker Compose. It adds URL-based React Router routes and frontend workflows for client editing, invoice detail/send/remind/cancel, contract milestones, payments, and workspace settings.

- Local frontend: `npm install --prefix frontend && npm run frontend:dev`
- Production build: `npm run frontend:build`
- API URL: set `VITE_SETTLE_API_URL` at frontend build time (defaults to `http://localhost:4000`).

The backend adds `PATCH /v1/clients/:id`, scoped to the authenticated workspace and audited. PayPal seller onboarding is not faked; it remains dependent on PayPal partner/merchant onboarding credentials and configuration.


## Document uploads (DOCX and S3)

The Documents page uploads through the workspace-scoped `POST /v1/documents/upload-url` and `POST /v1/documents` flow. DOCX is included in the default allowed MIME types. If your `.env` explicitly defines `DOCUMENT_ALLOWED_CONTENT_TYPES`, append `application/vnd.openxmlformats-officedocument.wordprocessingml.document` to that comma-separated list and restart the API.

Because the browser uploads directly to S3 using a short-lived presigned URL, configure the S3 bucket CORS policy to allow the exact frontend origin (for local development, `http://localhost:5173`), method `PUT`, and headers `content-type` and `x-amz-server-side-encryption`. Do not expose AWS credentials in frontend environment variables. The backend must have valid S3 credentials and the configured bucket/region.

The overview includes real API-backed quick actions and recent invoices/contracts. The workspace search queries the current workspace's clients, invoices and contracts endpoints; it does not use fabricated sample results.

## v0.14.1 dispute and auth improvements

- `/login` and `/register` are now URL-driven pages. Switching between sign-in and registration navigates to the matching URL. Unauthenticated visits to protected routes redirect to `/login` rather than leaving the browser at `/dashboard` while rendering the auth form.
- The Disputes page includes **Sync all PayPal disputes**. It queries disputes from the configured PayPal API account for the most recent 180 days (bounded pagination), imports/updates them idempotently, and then refreshes the workspace list. Transaction-ID lookup remains available.
- Dispute details can upload a supporting document through the existing workspace-scoped S3 document flow. Once the background verification completes, attach the verified file to the evidence pack, select an evidence type, review the generated claim, approve the pack, and submit. PayPal receives the attached binary files in the multipart `provide-evidence` request along with the evidence notes.
- Adding a document to a reviewed-but-not-submitted pack returns it to `READY_FOR_REVIEW`, so the newly added proof must be reviewed again. Submitted packs cannot be silently modified.

For DOCX uploads, make sure `DOCUMENT_ALLOWED_CONTENT_TYPES` in your local environment includes `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. The backend must have its existing S3 configuration and the bucket CORS policy must allow the frontend origin to PUT files using the signed URL headers.

### Testing the changes

1. Install backend dependencies with `npm ci` in the project root and frontend dependencies with `npm ci` in `frontend/`.
2. Build the frontend with `npm run build` from `frontend/`.
3. Build the backend with `npm run build` from the project root.
4. Start the backend and worker with your normal local environment, sign in, open `/disputes`, and use **Sync all PayPal disputes**.
5. Open a case, upload a DOCX/PDF, wait for the document to show **Verified**, attach it, approve the evidence pack, and submit. Confirm the returned PayPal response and refresh the case.

The frontend production build was verified during preparation. Full backend type-check/build and end-to-end Sandbox submission could not be verified in this environment because backend dependencies were incomplete and PayPal/S3 credentials are environment-specific; run the steps above locally before relying on this flow.


## Fresh database

For a brand-new empty database, see [`FRESH_DATABASE_SETUP.md`](./FRESH_DATABASE_SETUP.md) and use `npm run db:migrate:fresh`. Do not use the fresh baseline against an existing database.


## Storage provider migration

See [Backblaze B2 migration and deployment instructions](BACKBLAZE_B2_MIGRATION.md) and `.env.backblaze.example` for the private B2 bucket configuration.


### AI extraction and provider fallback troubleshooting

- Gemini 404: verify `AI_MODEL` exists for the Gemini API version in use and that `AI_BASE_URL` is blank unless you intentionally override the endpoint. If a fallback is configured, primary-provider 404 responses are routed to the fallback once; the primary is not retried.
- Groq fallback: configure `AI_FALLBACK_PROVIDER=groq`, `AI_FALLBACK_MODEL` with an exact model ID enabled for your account, and `AI_FALLBACK_API_KEY`. Leave `AI_FALLBACK_BASE_URL` blank to use Groq's default endpoint.
- Contract amounts: extraction accepts monetary values as JSON strings or finite JSON numbers and normalizes them to strings before persistence. Other schema fields remain validated.
- Redis `EAI_AGAIN`: this indicates DNS resolution failed for the hostname in `REDIS_URL`. The Redis client now reconnects with capped exponential backoff and jitter, but a stale/incorrect hostname or persistent DNS outage must still be fixed in Redis Cloud / the runtime DNS configuration. Verify with `getent hosts <redis-host>` and `redis-cli -u "$REDIS_URL" PING`.
- PayPal transaction lookup: `/v1/disputes/by-transaction/:transactionId` requires the 17-character alphanumeric seller transaction ID returned in `disputed_transactions[].seller_transaction_id`. Do not pass an order ID, invoice ID, dispute ID, or local payment ID.

## Document AI and image OCR

The worker extracts text from PDF, TXT, CSV, JSON, PNG, JPEG, and GIF documents. Image OCR is performed locally by Tesseract (English language data) before the text is sent to the configured AI provider. The Docker image installs `tesseract-ocr` and `tesseract-ocr-data-eng`; custom worker hosts must install Tesseract and its English trained data separately.

If an image contains no readable text, extraction is marked as skipped for that document version. The original image remains available as a supporting evidence attachment and must be reviewed by a person. OCR output is not proof that a claim is true.

## PayPal evidence matching

Evidence items are matched to the exact `evidence_type` PayPal requested from the seller. Settle does not automatically convert a contract, invoice, or fulfillment record into `OTHER`, because that can misrepresent the evidence category. The dispute page displays seller-requested types and match counts. If PayPal requests `OTHER`, attach the relevant verified document with evidence type `OTHER`, review it, approve the pack, and then submit. See [PayPal's evidence definitions](https://developer.paypal.com/api/customer-disputes/v1/definitions/evidence) and [provide-evidence guide](https://developer.paypal.com/platforms/disputes/handle-disputes/use-disputes-api/).

The AI worker skips dispute analysis when there are no evidence candidates and records terminal document-validation skips so recovery does not retry the same unsupported/invalid file indefinitely. Transient provider and infrastructure failures continue through the configured BullMQ retry/backoff policy.

## PayPal dispute evidence availability

Settle distinguishes locally prepared evidence from evidence PayPal has explicitly requested from the seller. PayPal's `evidences` payload can contain evidence already submitted by a buyer; those entries are not seller requirements. On dispute sync, the local requirement snapshot is reconciled and only entries explicitly marked `REQUESTED_FROM_SELLER` are treated as provider requirements.

When PayPal has not supplied seller evidence requirements (for example, an inquiry-stage case), Settle keeps locally collected and manually attached evidence available for internal review and AI analysis. Dispute-reason-based evidence categories are shown only as suggestions. They are not treated as PayPal requirements, and both evidence submission endpoints refuse to submit until seller requirements are actually available. This avoids inventing requirements or sending evidence under an unsupported category.

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

AI extraction recovery uses stable per-document-content BullMQ job IDs, retries retained failed jobs, pages through the verified-document and successful-run sets, and guards extraction with a Redis lock. Successful extraction reuse is scoped to the workspace, provider/model, prompt version, document ID, and extracted-text hash. AI recovery remains disabled when `AI_ENABLED` is false. Dead-letter retry/recovery remains deferred; see `docs/Settle_v0.13.0_Deferred_Work_Dead_Letter_Retry.docx`.

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

# Settle v0.13.0 — Contract-to-Cash Platform

Production-oriented modular monolith for Settle: contracts, milestones, invoices, payments, PayPal synchronization, disputes, evidence, documents, audit logs, idempotency, Redis/BullMQ and transactional outbox processing.


## Frontend

The `frontend/` directory contains a responsive Next.js app for the existing v1 API. It includes a public landing page, workspace sign-in/registration, overview metrics, cash-flow forecast, invoice and contract registers, client management, dispute visibility, private document upload, AI extraction status, and workspace settings. Its presentation uses a light PayPal-blue palette and keeps the existing API routes and data contracts.

Start the API and worker in separate terminals, then start the frontend:

```bash
# Terminal 1 — API
npm run dev

# Terminal 2 — background workers
npm run worker

# Terminal 3 — frontend
npm run frontend:dev
```

For local frontend development, install its dependencies once with `npm install --prefix frontend`.

Open `http://localhost:3000`. The default API URL is `http://localhost:4000`; set `SETTLE_API_URL` for the frontend server/container or change it in Settings (the browser remembers it locally). Set `CORS_ORIGIN` to the frontend origin for local development and to the deployed frontend origin in production. Browser-based S3 uploads also require a bucket CORS policy that allows the frontend origin and the required PUT headers.

Frontend syntax and production build checks:

```bash
npm run frontend:check
npm --prefix frontend run build
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

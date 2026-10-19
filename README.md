# Settle Backend v0.5.0

Production-oriented modular monolith for Settle: contracts, milestones, invoices, payments, PayPal synchronization, disputes, evidence, documents, audit logs, idempotency, Redis/BullMQ and transactional outbox processing.

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

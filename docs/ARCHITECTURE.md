# Settle Backend Architecture

## Principles

1. PostgreSQL is the source of truth.
2. PayPal is an external provider behind adapters.
3. Webhooks are persisted before asynchronous processing.
4. Provider event IDs are idempotent.
5. Financial/destructive operations require explicit application policy and audit records.
6. Workers handle retries and external side effects.
7. AI may draft/extract evidence but does not directly authorize financial actions.
8. Secrets are injected at runtime and never committed.

## Domain boundaries

- invoices: invoice lifecycle and payment obligations
- payments: payment state and reconciliation
- disputes: provider dispute lifecycle
- evidence: evidence requirements, documents and submissions
- webhooks: provider event ingestion
- audit: immutable business-action history
- paypal: external provider adapter

## Production hardening still to add before live traffic

- authentication and workspace RBAC
- PayPal webhook signature verification
- S3 document service + malware scanning
- complete invoice/payment persistence and reconciliation
- transactional outbox
- stronger idempotency middleware
- OpenTelemetry
- Prometheus metrics
- OpenAPI generation
- database constraints/index review
- migration review
- secrets manager integration
- CI security scans
- comprehensive integration/E2E tests
- staging/production configuration separation

## PayPal webhook security

PayPal webhook events are verified through PayPal's `verify-webhook-signature` endpoint before persistence and queueing. The registered webhook ID is distinct from the PayPal client ID.

The event is then persisted with a provider-event uniqueness constraint and queued for asynchronous processing.

## Dispute lifecycle

The API surface is intentionally action-oriented but the domain should only expose actions that PayPal's current dispute detail response/HATEOAS links allow. Evidence requirements are derived from `evidences[]`, especially entries whose source is `REQUESTED_FROM_SELLER`, rather than hard-coded only from the dispute reason.

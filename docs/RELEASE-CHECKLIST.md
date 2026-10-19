# Settle release checklist

## Before local development
- Copy `.env.example` to `.env`.
- Fill `DATABASE_URL` and `REDIS_URL`.
- Keep PayPal secrets local; never commit them.

## Before Sandbox integration
- Configure `PAYPAL_CLIENT_ID`.
- Configure `PAYPAL_CLIENT_SECRET`.
- Configure `PAYPAL_WEBHOOK_ID`.
- Register the HTTPS webhook URL in the same PayPal REST app used for invoice/payment operations.

## Before production
- Replace Sandbox PayPal base URL with the live base URL.
- Use a dedicated production database and Redis.
- Store secrets in a managed secret store.
- Configure S3 private bucket + least-privilege IAM.
- Configure TLS/HTTPS.
- Configure monitoring, backups, alerting, and log retention.
- Run migrations from CI/CD.
- Run unit, integration, and PayPal Sandbox E2E tests.
- Verify webhook signatures before processing any event.

## v0.6.0 hardening checks
- Verify every PayPal webhook is `RECEIVED` before queue processing and `PROCESSED` only after durable business updates complete.
- Verify duplicate webhook delivery does not create duplicate payments.
- Verify worker restart recovers `RECEIVED` webhook rows.
- Verify expired/malformed JWTs return 401.
- Verify cross-workspace document keys and resource IDs are rejected.
- Verify S3 checksum mismatch is rejected.
- Verify invoice/payment state transitions reject invalid financial transitions.
- Verify dashboard/cash-flow totals never combine different currencies.
- Verify automated reminders are idempotent per invoice/day.
- Run `npm run build` and `npm test` before release.

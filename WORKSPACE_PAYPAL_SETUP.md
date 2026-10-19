# Workspace-specific PayPal apps (Settle v0.16.0 patch)

## How it works
Each workspace can configure its own PayPal REST app in **Settings → PayPal connection**. Settle validates the Client ID/Secret by requesting an OAuth token, encrypts credentials using AES-256-GCM, and never returns the stored secret. API calls for disputes, invoice create/send/remind/cancel, scheduled invoice creation/reminders, and transaction reporting use the active workspace's credentials.

This is a direct REST-app credential model for Sandbox/dev testing. It is not PayPal partner onboarding and does not use `PayPal-Auth-Assertion`. Confirm that the relevant app and merchant account have access to each API operation you use.

## Required environment variable
Set `PAYPAL_CREDENTIALS_ENCRYPTION_KEY` to **exactly 32 UTF-8 bytes**. Generate a random key with:

```bash
openssl rand -hex 16
```

Use the resulting 32-character hex string as the key. Keep it stable and backed up: changing it makes existing encrypted credentials unreadable. Do not commit it or put it in the frontend. The `.env.example` is intentionally credential-free.

## Migration
Apply `drizzle/0013_workspace_paypal_credentials.sql` to the database before starting the updated backend. The migration journal is updated for Drizzle. If your deployment process runs migrations automatically, verify the migration completed before using Settings.

## Connect a workspace
1. Log in as a workspace owner/admin.
2. Open Settings → PayPal connection.
3. Choose Sandbox or Live, and enter the Client ID and Secret from that environment's PayPal Developer app. Optionally enter that app's webhook ID.
4. Click **Validate and connect PayPal**. Settle verifies credentials by requesting a token before storing them encrypted.
5. Repeat separately for each demo workspace using credentials belonging to that workspace's Sandbox merchant/app.

The app validates OAuth credentials only. A successful token request does not guarantee every endpoint/scope is enabled. The reporting endpoint is `GET /v1/paypal/reports/transactions?start_date=...&end_date=...` with ISO datetimes including timezone offsets.

## Webhooks
If you want workspace-specific webhook signature verification, configure the webhook ID belonging to the same PayPal app for that workspace. The webhook receiver checks connected workspace webhook registrations. Legacy global webhook verification is retained only when no workspace is connected. The event is associated with the workspace whose signature verification succeeds. Review event-specific worker handlers before production rollout; the current event processor has legacy provider reconciliation paths that should receive integration tests for every event type used in production.

## Security and rollout notes
- Do not include `.env`, tokens, or real credentials in project ZIPs.
- Credentials are encrypted at rest, but the encryption key must be kept secret and stable.
- Restrict Settings connection changes to workspace owners/admins.
- Use test merchant accounts first. Do not use live credentials until all integration tests and webhook event scoping are verified.
- PayPal API access and features can differ by account type and app configuration.

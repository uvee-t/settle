# Settle — production Neon + Redis deployment (v1.1.0 source / backend package 0.16.1)

This guide is for the project archive that contains `drizzle/`, `drizzle-fresh/`, `drizzle.config.ts`, and `drizzle.fresh.config.ts`.

## Important: which migration path should you use?

The checked-in incremental migration history is incomplete: `drizzle/` contains `0007` through `0013`, but the original `0001`–`0006` SQL files are not present in the supplied project. Do not invent or run made-up replacements.

For a **brand-new, empty production Neon database**, use the single baseline in `drizzle-fresh/0000_initial_schema.sql` with:

```bash
npm run db:migrate:fresh
```

That baseline creates the current schema represented by the project, including the schema additions in `0013`. **Do not then run `npm run db:migrate` on the same fresh database**: that would try to apply the incremental `0007`–`0013` changes on top of the already-current baseline.

For an **existing database with data**, do not use `db:migrate:fresh`. Back it up, inspect `drizzle.__drizzle_migrations`, compare it with the app schema and the `drizzle/` journal, and apply only genuinely pending migrations after testing on a restored clone. The missing `0001`–`0006` mean this archive cannot reconstruct the complete original historical chain for an empty DB by replaying migrations from 0001.

## A. Prepare production Neon

1. In Neon, create a **new production project/database or branch**. Keep development and production separate.
2. Copy its pooled connection string only if the app's runtime expects pooling. For Drizzle migrations, prefer Neon’s direct connection string if available; it avoids pooler limitations during DDL.
3. Keep the connection string private. Do not commit it to Git or paste it into chat.
4. In the backend project root, set `DATABASE_URL` in the deployment provider's secret/environment settings. Do not put production credentials in a frontend `VITE_`/`NEXT_PUBLIC_` variable.
5. Before migration, verify the connection points to the intended empty production database:

```bash
node --env-file=.env --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect(); console.log((await c.query("select current_database() as db, current_user as role")).rows); console.log((await c.query("select count(*)::int as public_tables from information_schema.tables where table_schema = '\''public'\'' and table_type = '\''BASE TABLE'\''")).rows); await c.end();'
```

The public table count should be zero for a truly empty database. If it is not zero, stop and confirm what is in it.

## B. Apply the fresh schema (new empty database only)

Run from the backend root (the directory containing the root `package.json`):

```bash
npm ci
npm run db:migrate:fresh
```

Then verify the schema in Neon SQL Editor:

```sql
SELECT count(*) AS public_tables
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'paypal_accounts'
ORDER BY ordinal_position;

SELECT *
FROM drizzle.__drizzle_migrations
ORDER BY created_at;
```

The baseline is one migration entry (`0000_initial_schema`) in the fresh migration journal. Check the actual migration table schema if your Drizzle version uses a different timestamp column name.

Build and test before deploying:

```bash
npm run build
npm test
```

No users, workspaces, PayPal credentials, or demo records are seeded. Register a workspace through the app after deployment.

## C. Provision production Redis

Redis is not managed by Drizzle and has no SQL migration files.

1. Create a separate production Redis instance/database with persistence and backups appropriate to your provider and workload.
2. Set backend `REDIS_URL` to the production Redis connection string in the deployment provider's secret settings. Use TLS (`rediss://`) when required by the provider.
3. Ensure the API process and the worker process use the **same production Redis instance** and compatible queue/prefix configuration.
4. Do not point production workers at development Redis or vice versa.
5. If moving an already-running queue, plan a cutover: pause producers, let active jobs finish or deliberately handle them, inspect delayed/waiting/failed jobs, then switch API and workers together. Do not casually flush Redis; it can delete queued jobs and idempotency/limiter state.
6. Start the API and worker processes, then verify health checks, queue processing, retries, and dead-letter handling.

## D. Configure the production app

Set all backend environment variables from the project's `.env.example`/deployment configuration, especially:

- `DATABASE_URL` — production Neon database
- `REDIS_URL` — production Redis
- `APP_ORIGIN` / `WEB_ORIGIN` / CORS origins — actual production frontend origin(s)
- encryption key(s), JWT/session secrets, storage credentials, and PayPal settings — generated/stored as secrets, never committed

Use the exact variable names required by the checked-in `.env.example` and source code. Do not copy development secrets into production. Keep frontend public variables limited to values that are safe to expose.

Deploy the backend API and worker as separate processes if that is how the project is configured. Confirm both have the same database and Redis environment values.

## E. Smoke-test after deployment

1. Confirm API health/readiness endpoints.
2. Register a test workspace and sign in.
3. Create a client and contract; create a milestone/invoice using sandbox payment credentials first.
4. Confirm DB rows persist and worker jobs complete.
5. Trigger a test webhook and verify it is acknowledged and processed once (retries must be idempotent).
6. Check logs for DB connection failures, Redis reconnects, failed jobs, and webhook errors.
7. Only move payment credentials/live payment processing to production after sandbox end-to-end tests and provider configuration are verified.

## Migration files included in this archive

- `drizzle-fresh/0000_initial_schema.sql` — one-shot current-schema baseline for an empty database.
- `drizzle/0007_document_verification.sql`
- `drizzle/0008_ai_evidence_intelligence.sql`
- `drizzle/0009_milestone_billing.sql`
- `drizzle/0010_delivery_acceptance.sql`
- `drizzle/0011_dispute_transaction_reconciliation.sql`
- `drizzle/0012_reliability_hardening.sql`
- `drizzle/0013_workspace_paypal_credentials.sql`
- Both migration journals and both Drizzle config files.

The supplied source archive does **not** contain `drizzle/0001` through `drizzle/0006`. The baseline is the safe fresh-install route provided here; it is not a reconstruction of those missing historical SQL files.

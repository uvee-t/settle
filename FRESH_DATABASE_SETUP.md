# Fresh database setup (Settle v0.16.1)

This package includes a separate one-shot baseline migration in `drizzle-fresh/`. It creates the current schema from scratch, including all tables, indexes, unique constraints, foreign keys, and the workspace-specific PayPal credential/webhook columns. It is based on the checked-in Drizzle snapshot (`0012`) plus the schema additions in `0013`.

## Important safety rule

**Use only with a brand-new, empty Neon database.** This migration is not for the existing Settle database and must not be used to repair or reset a database with application data. It is kept separate from `drizzle/`, so the normal `npm run db:migrate` path remains unchanged.

## Steps

1. Create a new database/branch in Neon.
2. Back up and keep your existing `.env`; do not put credentials in source control.
3. Set `DATABASE_URL` to the new database's connection string. Use a connection role that can create tables and the `drizzle` schema.
4. Confirm the target before applying anything: `node --env-file=.env --input-type=module -e 'import pg from "pg"; const c=new pg.Client({connectionString:process.env.DATABASE_URL}); await c.connect(); console.log((await c.query("select current_database() as db, current_user as role, current_setting(\'search_path\') as search_path")).rows); await c.end();'`
5. Install dependencies if needed: `npm ci`.
6. Run the fresh baseline once: `npm run db:migrate:fresh`.
7. Verify table count and required columns (examples):
   ```sql
   SELECT count(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

   SELECT column_name FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'paypal_accounts'
   ORDER BY ordinal_position;
   ```
8. Build/test: `npm run build && npm test`.

## Notes

- The fresh migration is independent of missing historical migrations `0001`–`0006`; it is one baseline rather than replaying `0007` through `0013`.
- It creates the current schema represented in `src/db/schema/index.ts`, with `client_id_encrypted`, `client_secret_encrypted`, `webhook_id_encrypted`, `connection_status`, and `webhook_events.workspace_id` included.
- No seed users, workspaces, PayPal credentials, or demo data are inserted. Register through the application after setup.
- The baseline migration and config are generated from the repository snapshot and schema additions, but must still be validated against a disposable empty Neon database before production use.

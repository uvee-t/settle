# Migration history note

The supplied source archive contains the fresh baseline `drizzle-fresh/0000_initial_schema.sql` and incremental migrations `drizzle/0007` through `drizzle/0013`. The original `drizzle/0001` through `drizzle/0006` files are absent from the supplied source. They have not been fabricated. For a new empty database, use only `npm run db:migrate:fresh`. For an existing populated database, do not use the fresh baseline; inspect its migration history and back it up before applying pending migrations. See `DEPLOY_PRODUCTION_DATABASE.md`.

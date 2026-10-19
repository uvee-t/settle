CREATE TABLE IF NOT EXISTS "dead_letter_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "queue" text NOT NULL,
  "job_id" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "error" text,
  "attempts" text NOT NULL DEFAULT '0',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "resolved_at" timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS "dead_letter_jobs_source_unique"
  ON "dead_letter_jobs" ("source_type", "source_id");

CREATE INDEX IF NOT EXISTS "dead_letter_jobs_queue_idx"
  ON "dead_letter_jobs" ("queue", "created_at");

CREATE INDEX IF NOT EXISTS "dead_letter_jobs_unresolved_idx"
  ON "dead_letter_jobs" ("resolved_at");

CREATE INDEX IF NOT EXISTS "outbox_dispatch_idx"
  ON "outbox_events" ("status", "available_at");

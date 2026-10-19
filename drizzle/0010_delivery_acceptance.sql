CREATE TABLE IF NOT EXISTS "milestone_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "milestone_id" uuid NOT NULL REFERENCES "milestones"("id") ON DELETE CASCADE,
  "submitted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'SUBMITTED',
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "accepted_at" timestamptz,
  "accepted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "rejected_at" timestamptz,
  "rejected_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "rejection_reason" text,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "milestone_deliveries_workspace_idx"
  ON "milestone_deliveries" ("workspace_id");
CREATE INDEX IF NOT EXISTS "milestone_deliveries_milestone_idx"
  ON "milestone_deliveries" ("milestone_id");
CREATE INDEX IF NOT EXISTS "milestone_deliveries_status_idx"
  ON "milestone_deliveries" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_deliveries_one_accepted_unique"
  ON "milestone_deliveries" ("milestone_id")
  WHERE "status" = 'ACCEPTED';

CREATE TABLE IF NOT EXISTS "milestone_delivery_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "delivery_id" uuid NOT NULL REFERENCES "milestone_deliveries"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_delivery_documents_unique"
  ON "milestone_delivery_documents" ("delivery_id", "document_id");
CREATE INDEX IF NOT EXISTS "milestone_delivery_documents_delivery_idx"
  ON "milestone_delivery_documents" ("delivery_id");
CREATE INDEX IF NOT EXISTS "milestone_delivery_documents_document_idx"
  ON "milestone_delivery_documents" ("document_id");

CREATE TABLE IF NOT EXISTS "milestone_acceptance_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "milestone_id" uuid NOT NULL REFERENCES "milestones"("id") ON DELETE CASCADE,
  "delivery_id" uuid NOT NULL REFERENCES "milestone_deliveries"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "note" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "metadata" jsonb
);
CREATE INDEX IF NOT EXISTS "milestone_acceptance_events_milestone_idx"
  ON "milestone_acceptance_events" ("milestone_id");
CREATE INDEX IF NOT EXISTS "milestone_acceptance_events_delivery_idx"
  ON "milestone_acceptance_events" ("delivery_id");

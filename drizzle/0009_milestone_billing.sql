CREATE TABLE IF NOT EXISTS "milestone_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "milestone_id" uuid NOT NULL REFERENCES "milestones"("id") ON DELETE CASCADE,
  "invoice_id" uuid NOT NULL REFERENCES "invoices"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "milestone_invoices_milestone_unique"
  ON "milestone_invoices" ("milestone_id");

CREATE UNIQUE INDEX IF NOT EXISTS "milestone_invoices_invoice_unique"
  ON "milestone_invoices" ("invoice_id");

CREATE INDEX IF NOT EXISTS "milestone_invoices_milestone_idx"
  ON "milestone_invoices" ("milestone_id");

CREATE INDEX IF NOT EXISTS "milestone_invoices_invoice_idx"
  ON "milestone_invoices" ("invoice_id");

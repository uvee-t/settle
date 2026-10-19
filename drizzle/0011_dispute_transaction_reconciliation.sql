ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "payment_id" uuid REFERENCES "payments"("id") ON DELETE SET NULL;

ALTER TABLE "disputes"
  ADD COLUMN IF NOT EXISTS "invoice_id" uuid REFERENCES "invoices"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "disputes_payment_idx"
  ON "disputes" ("payment_id");

CREATE INDEX IF NOT EXISTS "disputes_invoice_idx"
  ON "disputes" ("invoice_id");

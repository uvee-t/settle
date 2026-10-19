ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verification_status" text NOT NULL DEFAULT 'pending';
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verification_error" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "detected_content_type" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verified_at" timestamptz;

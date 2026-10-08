CREATE TABLE IF NOT EXISTS "ai_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "task" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "prompt_version" text NOT NULL,
  "input_hash" text NOT NULL,
  "status" text NOT NULL,
  "result" jsonb,
  "error" text,
  "tokens_in" text,
  "tokens_out" text,
  "latency_ms" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ai_runs_workspace_idx" ON "ai_runs" ("workspace_id");
CREATE INDEX IF NOT EXISTS "ai_runs_input_hash_idx" ON "ai_runs" ("input_hash");

CREATE TABLE IF NOT EXISTS "evidence_facts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "fact_type" text NOT NULL,
  "value" jsonb NOT NULL,
  "confidence" text,
  "source_excerpt" text,
  "ai_run_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "evidence_facts_workspace_idx" ON "evidence_facts" ("workspace_id");
CREATE INDEX IF NOT EXISTS "evidence_facts_source_idx" ON "evidence_facts" ("source_type", "source_id");

CREATE TABLE IF NOT EXISTS "evidence_packs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "dispute_id" uuid NOT NULL UNIQUE,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "strength_score" text,
  "defense_draft" text,
  "analysis" jsonb,
  "ai_run_id" uuid,
  "reviewed_at" timestamptz,
  "reviewed_by" uuid,
  "submitted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "evidence_packs_workspace_idx" ON "evidence_packs" ("workspace_id");

CREATE TABLE IF NOT EXISTS "evidence_pack_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "evidence_pack_id" uuid NOT NULL,
  "evidence_type" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "claim" text NOT NULL,
  "confidence" text,
  "selected" text NOT NULL DEFAULT 'true',
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "evidence_pack_items_pack_idx" ON "evidence_pack_items" ("evidence_pack_id");

import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  task: text("task").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputHash: text("input_hash").notNull(),
  status: text("status").notNull(),
  result: jsonb("result"),
  error: text("error"),
  tokensIn: text("tokens_in"),
  tokensOut: text("tokens_out"),
  latencyMs: text("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  workspaceIdx: index("ai_runs_workspace_idx").on(t.workspaceId),
  inputHashIdx: index("ai_runs_input_hash_idx").on(t.inputHash),
}));

export const evidenceFacts = pgTable("evidence_facts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  factType: text("fact_type").notNull(),
  value: jsonb("value").notNull(),
  confidence: text("confidence"),
  sourceExcerpt: text("source_excerpt"),
  aiRunId: uuid("ai_run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  workspaceIdx: index("evidence_facts_workspace_idx").on(t.workspaceId),
  sourceIdx: index("evidence_facts_source_idx").on(t.sourceType, t.sourceId),
}));

export const evidencePacks = pgTable("evidence_packs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  disputeId: uuid("dispute_id").notNull().unique(),
  status: text("status").notNull().default("DRAFT"),
  strengthScore: text("strength_score"),
  defenseDraft: text("defense_draft"),
  analysis: jsonb("analysis"),
  aiRunId: uuid("ai_run_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  workspaceIdx: index("evidence_packs_workspace_idx").on(t.workspaceId),
}));

export const evidencePackItems = pgTable("evidence_pack_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  evidencePackId: uuid("evidence_pack_id").notNull(),
  evidenceType: text("evidence_type").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  claim: text("claim").notNull(),
  confidence: text("confidence"),
  selected: text("selected").notNull().default("true"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  packIdx: index("evidence_pack_items_pack_idx").on(t.evidencePackId),
}));

import {
  index, jsonb, pgTable, text, timestamp, uuid, uniqueIndex,
} from "drizzle-orm/pg-core";

export const disputeEvidenceRequests = pgTable(
  "dispute_evidence_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    providerEvidenceType: text("provider_evidence_type").notNull(),
    source: text("source"),
    required: text("required").notNull().default("true"),
    status: text("status").notNull().default("PENDING"),
    metadata: jsonb("metadata"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    disputeIdx: index("dispute_evidence_requests_dispute_idx").on(t.disputeId),
    uniqueType: uniqueIndex("dispute_evidence_requests_type_unique").on(t.disputeId, t.providerEvidenceType),
  }),
);

export const disputeEvidenceSubmissions = pgTable(
  "dispute_evidence_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    disputeId: uuid("dispute_id").notNull(),
    evidenceRequestId: uuid("evidence_request_id"),
    evidenceType: text("evidence_type").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("PENDING"),
    providerResponse: jsonb("provider_response"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    disputeIdx: index("dispute_evidence_submissions_dispute_idx").on(t.disputeId),
  }),
);

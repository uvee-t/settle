import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const disputes = pgTable("disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id"),
  provider: text("provider").notNull().default("paypal"),
  providerDisputeId: text("provider_dispute_id").notNull().unique(),
  providerTransactionId: text("provider_transaction_id"),
  reason: text("reason"),
  status: text("status"),
  disputeState: text("dispute_state"),
  lifecycleStage: text("lifecycle_stage"),
  channel: text("channel"),
  amount: text("amount"),
  currency: text("currency"),
  sellerResponseDueAt: timestamp("seller_response_due_at", { withTimezone: true }),
  sellerProtectionEligible: text("seller_protection_eligible"),
  sellerProtectionType: text("seller_protection_type"),
  rawPayload: jsonb("raw_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

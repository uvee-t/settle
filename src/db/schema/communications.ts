import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const communications = pgTable(
  "communications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    clientId: uuid("client_id"),
    contractId: uuid("contract_id"),
    invoiceId: uuid("invoice_id"),
    disputeId: uuid("dispute_id"),
    channel: text("channel").notNull(),
    direction: text("direction").notNull(),
    subject: text("subject"),
    body: text("body"),
    externalId: text("external_id"),
    metadata: jsonb("metadata"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceIdx: index("communications_workspace_idx").on(t.workspaceId),
    clientIdx: index("communications_client_idx").on(t.clientId),
    invoiceIdx: index("communications_invoice_idx").on(t.invoiceId),
  }),
);

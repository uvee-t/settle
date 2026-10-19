import {
    index,
    jsonb,
    pgTable,
    text,
    timestamp,
    uuid,
    uniqueIndex,
} from "drizzle-orm/pg-core";

export const invoices = pgTable(
    "invoices",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        workspaceId: uuid("workspace_id"),
        clientId: uuid("client_id"),
        contractId: uuid("contract_id"),
        provider: text("provider").notNull().default("paypal"),
        providerInvoiceId: text("provider_invoice_id"),
        invoiceNumber: text("invoice_number"),
        reference: text("reference"),
        status: text("status").notNull().default("draft"),
        currency: text("currency").notNull().default("USD"),
        amount: text("amount").notNull().default("0"),
        dueAt: timestamp("due_at", { withTimezone: true }),
        sentAt: timestamp("sent_at", { withTimezone: true }),
        paidAt: timestamp("paid_at", { withTimezone: true }),
        providerPayload: jsonb("provider_payload"),
        rawPayload: jsonb("raw_payload"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({
        providerInvoiceUnique: uniqueIndex(
            "invoices_provider_invoice_unique",
        ).on(t.provider, t.providerInvoiceId),
        workspaceIdx: index("invoices_workspace_idx").on(t.workspaceId),
        clientIdx: index("invoices_client_idx").on(t.clientId),
        dueIdx: index("invoices_due_idx").on(t.dueAt),
    }),
);

export const invoiceItems = pgTable(
    "invoice_items",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        invoiceId: uuid("invoice_id")
            .notNull()
            .references(() => invoices.id, { onDelete: "cascade" }),
        description: text("description").notNull(),
        quantity: text("quantity").notNull().default("1"),
        unitAmount: text("unit_amount").notNull(),
        amount: text("amount").notNull(),
        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({ invoiceIdx: index("invoice_items_invoice_idx").on(t.invoiceId) }),
);

import {
    index,
    pgTable,
    timestamp,
    uniqueIndex,
    uuid,
} from "drizzle-orm/pg-core";
import { invoices } from "./invoices.js";
import { milestones } from "./core.js";

/**
 * Binds a billable milestone to the single Settle invoice created for it.
 *
 * The unique milestone index is the database-level guard against duplicate
 * billing, including concurrent requests.
 */
export const milestoneInvoices = pgTable(
    "milestone_invoices",
    {
        id: uuid("id").defaultRandom().primaryKey(),
        milestoneId: uuid("milestone_id")
            .notNull()
            .references(() => milestones.id, { onDelete: "cascade" }),
        invoiceId: uuid("invoice_id")
            .notNull()
            .references(() => invoices.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true })
            .defaultNow()
            .notNull(),
    },
    (t) => ({
        milestoneUnique: uniqueIndex("milestone_invoices_milestone_unique").on(
            t.milestoneId,
        ),
        invoiceUnique: uniqueIndex("milestone_invoices_invoice_unique").on(
            t.invoiceId,
        ),
        milestoneIdx: index("milestone_invoices_milestone_idx").on(
            t.milestoneId,
        ),
        invoiceIdx: index("milestone_invoices_invoice_idx").on(t.invoiceId),
    }),
);

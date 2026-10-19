import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { milestones, documents, users, workspaces } from "./core.js";

export const milestoneDeliveries = pgTable(
  "milestone_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("SUBMITTED"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceIdx: index("milestone_deliveries_workspace_idx").on(t.workspaceId),
    milestoneIdx: index("milestone_deliveries_milestone_idx").on(t.milestoneId),
    statusIdx: index("milestone_deliveries_status_idx").on(t.status),
    acceptedUnique: uniqueIndex("milestone_deliveries_one_accepted_unique")
      .on(t.milestoneId)
      .where(sql`status = 'ACCEPTED'`),
  }),
);

export const milestoneDeliveryDocuments = pgTable(
  "milestone_delivery_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id").notNull().references(() => milestoneDeliveries.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueLink: uniqueIndex("milestone_delivery_documents_unique").on(t.deliveryId, t.documentId),
    deliveryIdx: index("milestone_delivery_documents_delivery_idx").on(t.deliveryId),
    documentIdx: index("milestone_delivery_documents_document_idx").on(t.documentId),
  }),
);

export const milestoneAcceptanceEvents = pgTable(
  "milestone_acceptance_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").notNull().references(() => milestones.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id").notNull().references(() => milestoneDeliveries.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata"),
  },
  (t) => ({
    milestoneIdx: index("milestone_acceptance_events_milestone_idx").on(t.milestoneId),
    deliveryIdx: index("milestone_acceptance_events_delivery_idx").on(t.deliveryId),
  }),
);

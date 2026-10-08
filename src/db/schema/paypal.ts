import { index, jsonb, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const paypalAccounts = pgTable(
  "paypal_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    merchantId: text("merchant_id"),
    email: text("email"),
    environment: text("environment").notNull().default("sandbox"),
    scopes: jsonb("scopes"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceUnique: uniqueIndex("paypal_accounts_workspace_unique").on(t.workspaceId),
  }),
);

export const paypalResources = pgTable(
  "paypal_resources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id"),
    resourceType: text("resource_type").notNull(),
    providerId: text("provider_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerUnique: uniqueIndex("paypal_resources_type_id_unique").on(t.resourceType, t.providerId),
    workspaceIdx: index("paypal_resources_workspace_idx").on(t.workspaceId),
  }),
);

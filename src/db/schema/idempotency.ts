import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    resourceId: text("resource_id"),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("PROCESSING"),
    response: jsonb("response"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => ({
    keyUnique: uniqueIndex("idempotency_keys_key_unique").on(t.key, t.operation),
  }),
);

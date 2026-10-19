import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const deadLetterJobs = pgTable(
  "dead_letter_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    queue: text("queue").notNull(),
    jobId: text("job_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    payload: jsonb("payload").notNull(),
    error: text("error"),
    attempts: text("attempts").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => ({
    sourceUnique: uniqueIndex("dead_letter_jobs_source_unique").on(
      t.sourceType,
      t.sourceId,
    ),
    queueIdx: index("dead_letter_jobs_queue_idx").on(t.queue, t.createdAt),
    unresolvedIdx: index("dead_letter_jobs_unresolved_idx").on(t.resolvedAt),
  }),
);

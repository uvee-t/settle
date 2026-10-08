import { db } from "../db/client.js";
import { outboxEvents } from "../db/schema/outbox.js";

type InsertExecutor = Pick<typeof db, "insert">;

export async function enqueueOutbox(
  executor: InsertExecutor,
  input: {
    workspaceId?: string;
    topic: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
  },
) {
  const [event] = await executor.insert(outboxEvents).values({
    workspaceId: input.workspaceId,
    topic: input.topic,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
  }).onConflictDoNothing().returning();
  return event;
}

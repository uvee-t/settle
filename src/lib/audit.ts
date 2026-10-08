import { db } from "../db/client.js";
import { auditLogs } from "../db/schema/audit-logs.js";

type AuditExecutor = Pick<typeof db, "insert">;

export async function writeAudit(
  input: {
    workspaceId?: string;
    actorType: string;
    actorId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    requestId?: string;
    before?: unknown;
    after?: unknown;
    metadata?: unknown;
  },
  executor: AuditExecutor = db,
) {
  await executor.insert(auditLogs).values({
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: input.requestId,
    before: input.before,
    after: input.after,
    metadata: input.metadata,
  });
}

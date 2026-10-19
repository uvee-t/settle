import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { clients, contracts, contractVersions, milestones, documents } from "../../db/schema/core.js";
import { requireWorkspace, requireRole } from "../auth/auth.plugin.js";
import { writeAudit } from "../../lib/audit.js";
import { NotFoundError } from "../../lib/errors.js";

const contractSchema = z.object({
  client_id: z.uuid(),
  title: z.string().min(1).max(200),
  status: z.string().default("draft"),
  currency: z.string().length(3).default("USD"),
  total_amount: z.string().optional(),
  starts_at: z.coerce.date().optional(),
  ends_at: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const milestoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: z.string().default("pending"),
  amount: z.string().optional(),
  due_at: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function contractRoutes(app: FastifyInstance) {
  app.get("/v1/contracts", { preHandler: requireWorkspace }, async (request) => {
    return db.query.contracts.findMany({
      where: eq(contracts.workspaceId, request.auth!.workspaceId!),
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });
  });

  app.post("/v1/contracts", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const body = contractSchema.parse(request.body);
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, body.client_id), eq(clients.workspaceId, request.auth!.workspaceId!)),
    });
    if (!client) throw new NotFoundError("Client not found in this workspace.");

    const [contract] = await db.insert(contracts).values({
      workspaceId: request.auth!.workspaceId!,
      clientId: body.client_id,
      title: body.title,
      status: body.status,
      currency: body.currency.toUpperCase(),
      totalAmount: body.total_amount,
      startsAt: body.starts_at,
      endsAt: body.ends_at,
      metadata: body.metadata,
    }).returning();

    await writeAudit({
      workspaceId: request.auth!.workspaceId,
      actorType: "user",
      actorId: request.auth!.userId,
      action: "contract.created",
      resourceType: "contract",
      resourceId: contract.id,
      requestId: request.id,
      after: contract,
    });

    return reply.code(201).send(contract);
  });

  app.get("/v1/contracts/:id", { preHandler: requireWorkspace }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const contract = await db.query.contracts.findFirst({
      where: and(eq(contracts.id, id), eq(contracts.workspaceId, request.auth!.workspaceId!)),
    });
    if (!contract) throw new NotFoundError("Contract not found.");

    const [versions, contractMilestones] = await Promise.all([
      db.query.contractVersions.findMany({ where: eq(contractVersions.contractId, id) }),
      db.query.milestones.findMany({ where: eq(milestones.contractId, id) }),
    ]);

    return { ...contract, versions, milestones: contractMilestones };
  });

  app.post("/v1/contracts/:id/milestones", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = milestoneSchema.parse(request.body);

    const contract = await db.query.contracts.findFirst({
      where: and(eq(contracts.id, id), eq(contracts.workspaceId, request.auth!.workspaceId!)),
    });
    if (!contract) throw new NotFoundError("Contract not found.");

    const [milestone] = await db.insert(milestones).values({
      contractId: id,
      name: body.name,
      description: body.description,
      status: body.status,
      amount: body.amount,
      dueAt: body.due_at,
      metadata: body.metadata,
    }).returning();

    await writeAudit({ workspaceId: request.auth!.workspaceId, actorType: "user", actorId: request.auth!.userId, action: "milestone.created", resourceType: "milestone", resourceId: milestone.id, requestId: request.id, after: milestone });
    return reply.code(201).send(milestone);
  });

  app.patch("/v1/milestones/:id", { preHandler: requireRole("owner", "admin", "member") }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = milestoneSchema.partial().parse(request.body);

    const existing = await db.query.milestones.findFirst({ where: eq(milestones.id, id) });
    if (!existing) throw new NotFoundError("Milestone not found.");

    const contract = await db.query.contracts.findFirst({
      where: and(eq(contracts.id, existing.contractId), eq(contracts.workspaceId, request.auth!.workspaceId!)),
    });
    if (!contract) throw new NotFoundError("Milestone not found.");

    const [updated] = await db.update(milestones).set({
      name: body.name,
      description: body.description,
      status: body.status,
      amount: body.amount,
      dueAt: body.due_at,
      metadata: body.metadata,
      completedAt: body.status === "completed" ? new Date() : existing.completedAt,
      updatedAt: new Date(),
    }).where(eq(milestones.id, id)).returning();

    await writeAudit({ workspaceId: request.auth!.workspaceId, actorType: "user", actorId: request.auth!.userId, action: body.status === "completed" ? "milestone.completed" : "milestone.updated", resourceType: "milestone", resourceId: id, requestId: request.id, before: existing, after: updated });
    return updated;
  });
  app.post("/v1/contracts/:id/versions", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({
      version: z.string().min(1).max(50),
      document_id: z.uuid().optional(),
      extracted_terms: z.record(z.string(), z.unknown()).optional(),
      content_hash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    }).parse(request.body);

    const contract = await db.query.contracts.findFirst({
      where: and(eq(contracts.id, id), eq(contracts.workspaceId, request.auth!.workspaceId!)),
    });
    if (!contract) throw new NotFoundError("Contract not found.");

    if (body.document_id) {
      const document = await db.query.documents.findFirst({
        where: and(eq(documents.id, body.document_id), eq(documents.workspaceId, request.auth!.workspaceId!)),
      });
      if (!document) throw new NotFoundError("Document not found.");
    }

    const [version] = await db.insert(contractVersions).values({
      contractId: id,
      version: body.version,
      documentId: body.document_id,
      extractedTerms: body.extracted_terms,
      contentHash: body.content_hash?.toLowerCase(),
    }).returning();

    await writeAudit({
      workspaceId: request.auth!.workspaceId,
      actorType: "user", actorId: request.auth!.userId,
      action: "contract.version_created", resourceType: "contract", resourceId: id, requestId: request.id, after: version,
    });

    return reply.code(201).send(version);
  });

}

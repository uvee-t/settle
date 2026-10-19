import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { clients } from "../../db/schema/core.js";
import { requireWorkspace, requireRole } from "../auth/auth.plugin.js";
import { writeAudit } from "../../lib/audit.js";
import { NotFoundError } from "../../lib/errors.js";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email().optional(),
  company_name: z.string().max(200).optional(),
  country_code: z.string().length(2).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function clientRoutes(app: FastifyInstance) {
  app.get("/v1/clients", { preHandler: requireWorkspace }, async (request) => {
    return db.query.clients.findMany({
      where: and(eq(clients.workspaceId, request.auth!.workspaceId!), isNull(clients.archivedAt)),
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });
  });

  app.post("/v1/clients", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const [client] = await db.insert(clients).values({
      workspaceId: request.auth!.workspaceId!,
      name: body.name,
      email: body.email,
      companyName: body.company_name,
      countryCode: body.country_code,
      metadata: body.metadata,
    }).returning();

    await writeAudit({
      workspaceId: request.auth!.workspaceId,
      actorType: "user",
      actorId: request.auth!.userId,
      action: "client.created",
      resourceType: "client",
      resourceId: client.id,
      requestId: request.id,
      after: client,
    });

    return reply.code(201).send(client);
  });

  app.get("/v1/clients/:id", { preHandler: requireWorkspace }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const row = await db.query.clients.findFirst({
      where: and(eq(clients.id, id), eq(clients.workspaceId, request.auth!.workspaceId!)),
    });
    if (!row) throw new NotFoundError("Client not found.");
    return row;
  });

  app.delete("/v1/clients/:id", { preHandler: requireRole("owner", "admin") }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const [row] = await db.update(clients)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.workspaceId, request.auth!.workspaceId!)))
      .returning();
    if (!row) throw new NotFoundError("Client not found.");
    await writeAudit({
      workspaceId: request.auth!.workspaceId,
      actorType: "user",
      actorId: request.auth!.userId,
      action: "client.archived",
      resourceType: "client",
      resourceId: id,
      requestId: request.id,
    });
    return { success: true };
  });
}

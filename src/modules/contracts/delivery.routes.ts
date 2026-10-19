import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { milestones } from "../../db/schema/core.js";
import { milestoneDeliveries } from "../../db/schema/deliveries.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { NotFoundError } from "../../lib/errors.js";
import {
  createMilestoneDelivery,
  getMilestoneDelivery,
  listMilestoneDeliveries,
  transitionMilestoneDelivery,
} from "./delivery.service.js";

export async function deliveryRoutes(app: FastifyInstance) {
  app.get(
    "/v1/milestones/:id/deliveries",
    { preHandler: requireWorkspace },
    async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return listMilestoneDeliveries(id, request.auth!.workspaceId!);
    },
  );

  app.post(
    "/v1/milestones/:id/deliveries",
    { preHandler: requireRole("owner", "admin", "member") },
    async (request, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(10000).optional(),
        document_ids: z.array(z.uuid()).max(20).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }).parse(request.body);

      const result = await createMilestoneDelivery({
        workspaceId: request.auth!.workspaceId!,
        milestoneId: id,
        actorId: request.auth!.userId!,
        requestId: request.id,
        title: body.title,
        description: body.description,
        documentIds: body.document_ids,
        metadata: body.metadata,
      });

      return reply.code(201).send(result);
    },
  );

  app.get(
    "/v1/deliveries/:id",
    { preHandler: requireWorkspace },
    async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      return getMilestoneDelivery(id, request.auth!.workspaceId!);
    },
  );

  app.post(
    "/v1/deliveries/:id/accept",
    { preHandler: requireRole("owner", "admin", "member") },
    async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z.object({ note: z.string().max(5000).optional() }).parse(request.body ?? {});
      return transitionMilestoneDelivery({
        workspaceId: request.auth!.workspaceId!,
        deliveryId: id,
        actorId: request.auth!.userId!,
        action: "ACCEPTED",
        note: body.note,
        requestId: request.id,
      });
    },
  );

  app.post(
    "/v1/deliveries/:id/reject",
    { preHandler: requireRole("owner", "admin", "member") },
    async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = z.object({ reason: z.string().min(1).max(5000) }).parse(request.body);
      return transitionMilestoneDelivery({
        workspaceId: request.auth!.workspaceId!,
        deliveryId: id,
        actorId: request.auth!.userId!,
        action: "REJECTED",
        note: body.reason,
        requestId: request.id,
      });
    },
  );
}

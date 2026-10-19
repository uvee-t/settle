import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { requireWorkspace } from "../auth/auth.plugin.js";
import { buildEvidencePack } from "./evidence.service.js";
import { NotFoundError } from "../../lib/errors.js";

export async function evidenceRoutes(app: FastifyInstance) {
  app.get("/v1/disputes/:disputeId/evidence-pack", { preHandler: requireWorkspace }, async (request) => {
    const { disputeId } = z.object({ disputeId: z.uuid() }).parse(request.params);
    const local = await db.query.disputes.findFirst({
      where: and(eq(disputes.id, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)),
    });
    if (!local) throw new NotFoundError("Dispute not found.");
    return buildEvidencePack(disputeId, request.auth!.workspaceId!);
  });
}

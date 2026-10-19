import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { documents } from "../../db/schema/core.js";
import { aiRuns, evidenceFacts } from "../../db/schema/ai.js";
import { requireWorkspace } from "../auth/auth.plugin.js";
import { NotFoundError } from "../../lib/errors.js";

export async function aiRoutes(app: FastifyInstance) {
  app.get("/v1/documents/:id/ai-extraction", { preHandler: requireWorkspace }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const document = await db.query.documents.findFirst({ where: and(eq(documents.id, id), eq(documents.workspaceId, request.auth!.workspaceId!)) });
    if (!document) throw new NotFoundError("Document not found.");
    const runs = await db.query.aiRuns.findMany({ where: and(eq(aiRuns.workspaceId, request.auth!.workspaceId!), eq(aiRuns.task, "document.contract_extraction")), orderBy: (r, { desc }) => [desc(r.createdAt)] });
    const documentRuns = runs.filter(run => { const result = run.result as { document_id?: string } | null; return result?.document_id === id; });
    const facts = await db.query.evidenceFacts.findMany({ where: and(eq(evidenceFacts.workspaceId, request.auth!.workspaceId!), eq(evidenceFacts.sourceType, "document"), eq(evidenceFacts.sourceId, id)) });
    return { document_id: id, runs: documentRuns, facts };
  });
}

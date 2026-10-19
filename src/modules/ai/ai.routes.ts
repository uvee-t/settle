import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { documents } from "../../db/schema/core.js";
import { aiRuns, evidenceFacts } from "../../db/schema/ai.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { aiQueue } from "../../lib/queue.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { documentExtractionJobId } from "./ai-jobs.js";

export async function aiRoutes(app: FastifyInstance) {
  app.post("/v1/documents/:id/ai-extraction", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const document = await db.query.documents.findFirst({
      where: and(eq(documents.id, id), eq(documents.workspaceId, request.auth!.workspaceId!)),
    });
    if (!document) throw new NotFoundError("Document not found.");
    if (document.verificationStatus !== "verified") {
      throw new ValidationError("Only verified documents can be analyzed by AI.");
    }

    const jobId = documentExtractionJobId(document.id, document.sha256);
    const existingJob = await aiQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "failed") {
        await existingJob.retry("failed");
      } else if (state === "completed") {
        // A retained completed job may outlive its persisted run only after an
        // interrupted/disabled processing path. Recreate it when no success exists.
        const successfulRuns = await db.query.aiRuns.findMany({
          where: and(
            eq(aiRuns.workspaceId, document.workspaceId),
            eq(aiRuns.task, "document.contract_extraction"),
            eq(aiRuns.status, "SUCCEEDED"),
          ),
        });
        const hasSuccessfulRun = successfulRuns.some((run) => {
          const result = run.result as { document_id?: string } | null;
          return result?.document_id === document.id;
        });
        if (!hasSuccessfulRun) {
          await existingJob.remove();
          await aiQueue.add("document.extract", { documentId: document.id }, { jobId });
        }
      }
    } else {
      await aiQueue.add(
        "document.extract",
        { documentId: document.id },
        { jobId },
      );
    }

    return reply.code(202).send({
      status: "queued",
      document_id: document.id,
      job_id: jobId,
    });
  });
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

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { documents } from "../../db/schema/core.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { createDownloadUrl, createUploadUrl, headObject } from "./document.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";

export async function documentRoutes(app: FastifyInstance) {
  app.post("/v1/documents/upload-url", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const body = z.object({
      filename: z.string().min(1).max(255),
      content_type: z.string().min(1).max(200),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    }).parse(request.body);

    const result = await createUploadUrl({
      workspaceId: request.auth!.workspaceId!,
      filename: body.filename,
      contentType: body.content_type,
      sha256: body.sha256.toLowerCase(),
    });

    return reply.code(201).send(result);
  });

  app.post("/v1/documents", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const body = z.object({
      object_key: z.string().min(1),
      filename: z.string().min(1).max(255),
      content_type: z.string().min(1).max(200),
      size_bytes: z.string().regex(/^\d+$/),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).parse(request.body);

    const workspaceId = request.auth!.workspaceId!;
    if (!body.object_key.startsWith(`workspaces/${workspaceId}/documents/`)) {
      throw new ValidationError("Uploaded object does not belong to this workspace.");
    }

    const object = await headObject(body.object_key, workspaceId);
    if (!object) throw new NotFoundError("Uploaded object was not found in storage.");

    if (object.ContentLength !== undefined && String(object.ContentLength) !== body.size_bytes) {
      throw new ValidationError("Uploaded object size does not match.");
    }

    if (object.ContentType && object.ContentType !== body.content_type) {
      throw new ValidationError("Uploaded object content type does not match.");
    }

    const expectedChecksum = Buffer.from(body.sha256, "hex").toString("base64");
    if (!object.ChecksumSHA256) {
      throw new ValidationError("Storage checksum is unavailable; refusing to register an unverified document.");
    }
    if (object.ChecksumSHA256 !== expectedChecksum) {
      throw new ValidationError("Uploaded object checksum does not match.");
    }

    const [document] = await db.insert(documents).values({
      workspaceId: request.auth!.workspaceId!,
      ownerUserId: request.auth!.userId,
      objectKey: body.object_key,
      filename: body.filename,
      contentType: body.content_type,
      sizeBytes: body.size_bytes,
      sha256: body.sha256,
      metadata: body.metadata,
      status: "uploaded",
    }).returning();

    await writeAudit({
      workspaceId: request.auth!.workspaceId, actorType: "user", actorId: request.auth!.userId,
      action: "document.registered", resourceType: "document", resourceId: document.id, requestId: request.id, after: document,
    });

    return reply.code(201).send(document);
  });

  app.get("/v1/documents", { preHandler: requireWorkspace }, async (request) => {
    return db.query.documents.findMany({ where: eq(documents.workspaceId, request.auth!.workspaceId!) });
  });

  app.get("/v1/documents/:id/download-url", { preHandler: requireWorkspace }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const document = await db.query.documents.findFirst({
      where: and(eq(documents.id, id), eq(documents.workspaceId, request.auth!.workspaceId!)),
    });
    if (!document) throw new NotFoundError("Document not found.");
    return createDownloadUrl(document.objectKey, request.auth!.workspaceId!);
  });
}

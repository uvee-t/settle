import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { users, workspaceMembers, workspaces } from "../../db/schema/core.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { AppError, NotFoundError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";

export async function workspaceRoutes(app: FastifyInstance) {
  app.get("/v1/workspace", { preHandler: requireWorkspace }, async (request) => {
    const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, request.auth!.workspaceId!) });
    if (!workspace) throw new NotFoundError("Workspace not found.");
    return workspace;
  });

  app.get("/v1/workspace/members", { preHandler: requireWorkspace }, async (request) => {
    const members = await db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.workspaceId, request.auth!.workspaceId!),
    });

    const result = [];
    for (const member of members) {
      const user = await db.query.users.findFirst({ where: eq(users.id, member.userId) });
      result.push({ id: member.id, user_id: member.userId, email: user?.email, name: user?.name, role: member.role, created_at: member.createdAt });
    }
    return result;
  });

  app.patch("/v1/workspace", { preHandler: requireRole("owner", "admin") }, async (request) => {
    const body = z.object({ name: z.string().min(1).max(120) }).parse(request.body);
    const [workspace] = await db.update(workspaces).set({ name: body.name, updatedAt: new Date() })
      .where(eq(workspaces.id, request.auth!.workspaceId!)).returning();
    if (!workspace) throw new NotFoundError("Workspace not found.");
    return workspace;
  });

  app.post("/v1/workspace/members", { preHandler: requireRole("owner", "admin") }, async (request, reply) => {
    const body = z.object({ user_id: z.uuid(), role: z.enum(["admin", "member", "viewer"]).default("member") }).parse(request.body);
    const user = await db.query.users.findFirst({ where: eq(users.id, body.user_id) });
    if (!user) throw new NotFoundError("User not found.");

    const existing = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.userId, body.user_id), eq(workspaceMembers.workspaceId, request.auth!.workspaceId!)),
    });
    if (existing) throw new AppError("MEMBER_EXISTS", "User is already a workspace member.", 409);

    const [member] = await db.insert(workspaceMembers).values({
      workspaceId: request.auth!.workspaceId!,
      userId: body.user_id,
      role: body.role,
    }).returning();

    await writeAudit({
      workspaceId: request.auth!.workspaceId,
      actorType: "user",
      actorId: request.auth!.userId,
      action: "workspace.member_added",
      resourceType: "workspace_member",
      resourceId: member.id,
      requestId: request.id,
      after: member,
    });

    return reply.code(201).send(member);
  });
}

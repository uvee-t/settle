import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "./auth.service.js";
import { db } from "../../db/client.js";
import { workspaceMembers } from "../../db/schema/core.js";
import { AppError } from "../../lib/errors.js";
import { z } from "zod";

declare module "fastify" {
  interface FastifyRequest {
    auth?: { userId: string; email: string; workspaceId?: string; role?: string };
  }
}

export async function requireAuth(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("AUTH_REQUIRED", "Bearer access token required.", 401);
  }

  const auth = await verifyAccessToken(header.slice(7));
  request.auth = auth;
}

export async function requireWorkspace(request: FastifyRequest) {
  await requireAuth(request);
  const workspaceId = request.headers["x-workspace-id"]?.toString();
  if (!workspaceId) throw new AppError("WORKSPACE_REQUIRED", "x-workspace-id header is required.", 400);
  const parsedWorkspaceId = z.uuid().safeParse(workspaceId);
  if (!parsedWorkspaceId.success) throw new AppError("INVALID_WORKSPACE_ID", "x-workspace-id must be a valid UUID.", 400);

  const member = await db.query.workspaceMembers.findFirst({
    where: (m, { and, eq }) => and(eq(m.workspaceId, parsedWorkspaceId.data), eq(m.userId, request.auth!.userId)),
  });

  if (!member) throw new AppError("WORKSPACE_ACCESS_DENIED", "You do not have access to this workspace.", 403);

  request.auth = { ...request.auth!, workspaceId: parsedWorkspaceId.data, role: member.role };
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest) => {
    await requireWorkspace(request);
    if (!roles.includes(request.auth!.role ?? "")) {
      throw new AppError("FORBIDDEN", "Insufficient workspace permissions.", 403);
    }
  };
}

export async function authPlugin(_app: FastifyInstance) {
  // Authentication is exposed as reusable preHandlers.
}

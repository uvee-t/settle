import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { login, logout, refresh, register } from "./auth.service.js";
import { requireAuth } from "./auth.plugin.js";

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(10).max(128),
  name: z.string().min(1).max(120),
  workspace_name: z.string().min(1).max(120),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/v1/auth/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await register({
      email: body.email,
      password: body.password,
      name: body.name,
      workspaceName: body.workspace_name,
    });
    return reply.code(201).send(result);
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    return login(loginSchema.parse(request.body));
  });

  app.post("/v1/auth/refresh", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request) => {
    const body = z.object({ refresh_token: z.string().min(20) }).parse(request.body);
    return refresh({ refreshToken: body.refresh_token });
  });

  app.post("/v1/auth/logout", { preHandler: requireAuth }, async (request) => {
    const body = z.object({ refresh_token: z.string().min(20) }).parse(request.body);
    await logout(body.refresh_token);
    return { success: true };
  });
}

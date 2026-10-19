import type { FastifyInstance } from "fastify";
import { pool } from "../../db/client.js";
import { logger } from "../../lib/logger.js";
import { redis } from "../../lib/redis.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "settle-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/health/ready", async (_request, reply) => {
    const checks = { postgres: "failed" as "ok" | "failed", redis: "failed" as "ok" | "failed" };

    try {
      await pool.query("SELECT 1");
      checks.postgres = "ok";
    } catch (error) {
      logger.error({ err: error, check: "postgresql" }, "PostgreSQL readiness check failed");
    }

    try {
      await redis.ping();
      checks.redis = "ok";
    } catch (error) {
      logger.error({ err: error, check: "redis" }, "Redis readiness check failed");
    }

    if (checks.postgres !== "ok" || checks.redis !== "ok") {
      return reply.code(503).send({ status: "not_ready", checks });
    }

    return { status: "ready", checks };
  });
}

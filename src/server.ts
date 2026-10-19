import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { pool } from "./db/client.js";
import { redis } from "./lib/redis.js";

import { healthRoutes } from "./modules/health/health.routes.js";
import { webhookRoutes } from "./modules/webhooks/webhook.routes.js";
import { disputeRoutes } from "./modules/disputes/dispute.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { clientRoutes } from "./modules/clients/client.routes.js";
import { contractRoutes } from "./modules/contracts/contract.routes.js";
import { invoiceRoutes } from "./modules/invoices/invoice.routes.js";
import { workspaceRoutes } from "./modules/workspaces/workspace.routes.js";
import { documentRoutes } from "./modules/documents/document.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { evidenceRoutes } from "./modules/evidence/evidence.routes.js";
import { metaRoutes } from "./modules/meta/meta.routes.js";
import { paymentRoutes } from "./modules/payments/payment.routes.js";
import { aiRoutes } from "./modules/ai/ai.routes.js";

const app = Fastify({
  loggerInstance: logger,
  requestIdHeader: "x-request-id",
  genReqId: (req) => {
    const supplied = req.headers["x-request-id"]?.toString();
    return supplied && /^[a-zA-Z0-9._-]{1,128}$/.test(supplied) ? supplied : crypto.randomUUID();
  },
  requestTimeout: 30_000,
  keepAliveTimeout: 5_000,
  bodyLimit: 2 * 1024 * 1024,
});

await app.register(helmet);
await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
await app.register(rateLimit, {
  max: env.API_RATE_LIMIT_MAX,
  timeWindow: env.API_RATE_LIMIT_WINDOW,
});

app.addHook("onSend", async (request, reply) => {
  reply.header("x-request-id", request.id);
});

app.setErrorHandler((error: unknown, request, reply) => {
  const err = error as {
    statusCode?: number;
    message?: string;
    code?: string;
    details?: unknown;
    name?: string;
  };

  const isValidation = err.name === "ZodError";
  const statusCode =
    isValidation ? 400 :
    typeof err.statusCode === "number" && err.statusCode >= 400 ? err.statusCode : 500;

  logger.error(
    {
      err: error,
      requestId: request.id,
      method: request.method,
      url: request.url,
    },
    "Request failed",
  );

  return reply.code(statusCode).send({
    error: {
      code: isValidation ? "VALIDATION_ERROR" : statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.code ?? "REQUEST_FAILED",
      message: statusCode >= 500 ? "An unexpected error occurred." : err.message ?? "Request failed.",
      details: statusCode < 500 ? err.details : undefined,
      request_id: request.id,
    },
  });
});

await app.register(healthRoutes);
await app.register(metaRoutes);
await app.register(authRoutes);
await app.register(workspaceRoutes);
await app.register(clientRoutes);
await app.register(contractRoutes);
await app.register(invoiceRoutes);
await app.register(paymentRoutes);
await app.register(aiRoutes);
await app.register(documentRoutes);
await app.register(dashboardRoutes);
await app.register(evidenceRoutes);
await app.register(disputeRoutes);
await app.register(webhookRoutes);

app.addHook("onClose", async () => {
  await pool.end();
  await redis.quit();
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutdown signal received");
  try {
    await app.close();
    logger.info("Settle API shut down cleanly");
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Graceful shutdown failed");
    process.exit(1);
  }
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: env.PORT, host: env.HOST });

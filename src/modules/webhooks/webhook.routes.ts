import type { FastifyInstance } from "fastify";
import { verifyAndIngestPayPalWebhook } from "./webhook.service.js";
import { logger } from "../../lib/logger.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/paypal", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    try {
      const payload = request.body as Record<string, unknown>;
      const headers = request.headers as Record<string, string | string[] | undefined>;
      const result = await verifyAndIngestPayPalWebhook(payload, headers);
      return reply.code(200).send(result);
    } catch (error) {
      const err = error as { statusCode?: number; code?: string };
      const statusCode = typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 400;
      logger.error({ err: error, requestId: request.id }, "PayPal webhook rejected");
      return reply.code(statusCode).send({
        error: {
          code: err.code ?? "WEBHOOK_VERIFICATION_FAILED",
          message: statusCode >= 500 ? "Webhook processing is temporarily unavailable." : "Webhook could not be verified.",
          request_id: request.id,
        },
      });
    }
  });
}

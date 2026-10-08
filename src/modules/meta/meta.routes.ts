import type { FastifyInstance } from "fastify";

export async function metaRoutes(app: FastifyInstance) {
  app.get("/v1/meta", async () => ({
    service: "settle-api", version: "0.6.0", api_version: "v1",
    capabilities: ["authentication", "workspaces", "clients", "contracts", "milestones", "invoices", "payments", "paypal", "webhooks", "outbox", "idempotency", "disputes", "evidence-packs", "documents", "dashboard", "cash-flow-forecast", "automated-reminders", "s3-checksum-verification"],
  }));
}

import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { paypalAccounts } from "../../db/schema/paypal.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { PayPalClient } from "./paypal.client.js";
import { encryptSecret } from "./paypal.workspace.js";

const connectSchema = z.object({
  clientId: z.string().trim().min(8).max(500),
  clientSecret: z.string().min(8).max(1000),
  environment: z.enum(["sandbox", "live"]).default("sandbox"),
  webhookId: z.string().trim().min(1).max(500).optional(),
});

export async function paypalConnectionRoutes(app: FastifyInstance) {
  app.get("/v1/paypal/connection", { preHandler: requireWorkspace }, async (request) => {
    const row = await db.query.paypalAccounts.findFirst({ where: eq(paypalAccounts.workspaceId, request.auth!.workspaceId!) });
    return { connected: row?.connectionStatus === "CONNECTED", environment: row?.environment ?? null, merchantId: row?.merchantId ?? null, email: row?.email ?? null, scopes: row?.scopes ?? null, updatedAt: row?.updatedAt ?? null };
  });

  app.put("/v1/paypal/connection", { preHandler: requireRole("owner", "admin") }, async (request, reply) => {
    const body = connectSchema.parse(request.body);
    const baseUrl = body.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
    const client = new PayPalClient(body.clientId, body.clientSecret, baseUrl);
    // Validate credentials by obtaining a token before persisting anything. Never return token or credentials.
    await client.getAccessToken();
    const now = new Date();
    const values = {
      workspaceId: request.auth!.workspaceId!,
      clientIdEncrypted: encryptSecret(body.clientId),
      clientSecretEncrypted: encryptSecret(body.clientSecret),
      webhookIdEncrypted: body.webhookId ? encryptSecret(body.webhookId) : null,
      environment: body.environment,
      connectionStatus: "CONNECTED",
      updatedAt: now,
    };
    const [row] = await db.insert(paypalAccounts).values(values).onConflictDoUpdate({
      target: paypalAccounts.workspaceId,
      set: values,
    }).returning({ id: paypalAccounts.id, workspaceId: paypalAccounts.workspaceId, environment: paypalAccounts.environment, connectionStatus: paypalAccounts.connectionStatus, updatedAt: paypalAccounts.updatedAt });
    return reply.code(200).send({ connected: true, connection: row });
  });

  app.delete("/v1/paypal/connection", { preHandler: requireRole("owner", "admin") }, async (request) => {
    await db.update(paypalAccounts).set({ clientIdEncrypted: null, clientSecretEncrypted: null, webhookIdEncrypted: null, connectionStatus: "DISCONNECTED", updatedAt: new Date() }).where(eq(paypalAccounts.workspaceId, request.auth!.workspaceId!));
    return { connected: false };
  });
}

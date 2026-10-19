import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { webhookEvents } from "../../db/schema/webhook-events.js";
import { enqueueOutbox } from "../../lib/outbox.js";
import { paypalClient, PayPalClient } from "../paypal/paypal.client.js";
import { paypalAccounts } from "../../db/schema/paypal.js";
import { decryptSecret } from "../paypal/paypal.workspace.js";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

export async function verifyAndIngestPayPalWebhook(
  payload: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>,
) {
  const eventId = String(payload.id ?? "");
  const eventType = String(payload.event_type ?? "UNKNOWN");
  if (!eventId) throw new Error("PayPal webhook is missing event id");

  const get = (name: string) => {
    const value = headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  };

  let verifiedWorkspaceId: string | null = null;
  let signatureVerified = false;
  const connectedAccounts = await db.query.paypalAccounts.findMany();
  const accountsWithWebhook = connectedAccounts.filter((account) =>
    account.connectionStatus === "CONNECTED" && account.clientIdEncrypted && account.clientSecretEncrypted && account.webhookIdEncrypted,
  );

  const verificationInput = {
    auth_algo: get("paypal-auth-algo") ?? "",
    cert_url: get("paypal-cert-url") ?? "",
    transmission_id: get("paypal-transmission-id") ?? "",
    transmission_sig: get("paypal-transmission-sig") ?? "",
    transmission_time: get("paypal-transmission-time") ?? "",
    webhook_event: payload,
  };

  if (accountsWithWebhook.length) {
    for (const account of accountsWithWebhook) {
      try {
        const baseUrl = account.environment === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
        const client = new PayPalClient(decryptSecret(account.clientIdEncrypted!), decryptSecret(account.clientSecretEncrypted!), baseUrl);
        const verification = await client.verifyWebhookSignature({ ...verificationInput, webhook_id: decryptSecret(account.webhookIdEncrypted!) });
        if (verification.verification_status === "SUCCESS") {
          verifiedWorkspaceId = account.workspaceId;
          signatureVerified = true;
          break;
        }
      } catch {
        // Continue checking other connected workspace webhook registrations without logging credentials.
      }
    }
  } else if (connectedAccounts.every((account) => account.connectionStatus !== "CONNECTED") && env.PAYPAL_WEBHOOK_ID) {
    const verification = await paypalClient.verifyWebhookSignature({ ...verificationInput, webhook_id: env.PAYPAL_WEBHOOK_ID });
    if (verification.verification_status === "SUCCESS") { verifiedWorkspaceId = null; signatureVerified = true; }
  }

  if (!signatureVerified) {
    if ((!env.PAYPAL_WEBHOOK_ID || connectedAccounts.some((account) => account.connectionStatus === "CONNECTED")) && accountsWithWebhook.length === 0) {
      throw new Error("No PayPal webhook configuration is available.");
    }
    throw new AppError("WEBHOOK_SIGNATURE_INVALID", "Invalid PayPal webhook signature.", 400);
  }

  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({
        provider: "paypal",
        workspaceId: verifiedWorkspaceId,
        providerEventId: eventId,
        eventType,
        payload,
        status: "RECEIVED",
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });

    let webhookId = inserted[0]?.id;
    let duplicate = false;

    if (!webhookId) {
      const existing = await tx.query.webhookEvents.findFirst({
        where: and(
          eq(webhookEvents.provider, "paypal"),
          eq(webhookEvents.providerEventId, eventId),
        ),
      });
      if (!existing) throw new Error("PayPal webhook could not be persisted");
      webhookId = existing.id;
      duplicate = true;
    }

    // The webhook row and its durable delivery instruction are committed
    // together. If BullMQ is unavailable, the dispatcher will retry later.
    await enqueueOutbox(tx, {
      topic: "paypal.webhook",
      aggregateType: "webhook_event",
      aggregateId: webhookId,
      payload: { webhookEventId: webhookId, eventId, eventType, workspaceId: verifiedWorkspaceId },
    });

    return { duplicate, eventId, webhookId };
  });

  return result;
}

import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { webhookEvents } from "../../db/schema/webhook-events.js";
import { enqueueOutbox } from "../../lib/outbox.js";
import { paypalClient } from "../paypal/paypal.client.js";
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

  if (!env.PAYPAL_WEBHOOK_ID) {
    throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  }

  const verification = await paypalClient.verifyWebhookSignature({
    auth_algo: get("paypal-auth-algo") ?? "",
    cert_url: get("paypal-cert-url") ?? "",
    transmission_id: get("paypal-transmission-id") ?? "",
    transmission_sig: get("paypal-transmission-sig") ?? "",
    transmission_time: get("paypal-transmission-time") ?? "",
    webhook_id: env.PAYPAL_WEBHOOK_ID,
    webhook_event: payload,
  });

  if (verification.verification_status !== "SUCCESS") {
    throw new AppError("WEBHOOK_SIGNATURE_INVALID", "Invalid PayPal webhook signature.", 400);
  }

  const result = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({
        provider: "paypal",
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
      payload: { webhookEventId: webhookId, eventId, eventType },
    });

    return { duplicate, eventId, webhookId };
  });

  return result;
}

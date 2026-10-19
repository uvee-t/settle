import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const { verifyWebhookSignature } = vi.hoisted(() => ({
    verifyWebhookSignature: vi.fn(),
}));

vi.mock("../src/modules/paypal/paypal.client.js", () => ({
    paypalClient: {
        verifyWebhookSignature,
    },
}));

import { webhookEvents } from "../src/db/schema/webhook-events.js";
import { outboxEvents } from "../src/db/schema/outbox.js";
import { verifyAndIngestPayPalWebhook } from "../src/modules/webhooks/webhook.service.js";

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

integrationDescribe("PayPal webhook service integration", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl) {
            throw new Error("DATABASE_URL must be set before running tests");
        }

        if (!new URL(databaseUrl).pathname.endsWith("/settle_test")) {
            throw new Error(
                "Refusing to run webhook tests outside settle_test",
            );
        }

        process.env.PAYPAL_WEBHOOK_ID = "test-webhook-id";

        pool = new Pool({
            connectionString: databaseUrl,
            ssl: { rejectUnauthorized: false },
            max: 2,
        });

        db = drizzle(pool);
        await pool.query("SELECT 1");
    });

    afterAll(async () => {
        await pool?.end();
    });

    it("persists a verified webhook and its outbox instruction", async () => {
        const eventId = `evt-${randomUUID()}`;

        verifyWebhookSignature.mockResolvedValue({
            verification_status: "SUCCESS",
        });

        try {
            const result = await verifyAndIngestPayPalWebhook(
                {
                    id: eventId,
                    event_type: "PAYMENT.CAPTURE.COMPLETED",
                },
                {},
            );

            expect(result.duplicate).toBe(false);
            expect(result.eventId).toBe(eventId);

            const storedEvents = await db
                .select()
                .from(webhookEvents)
                .where(
                    (await import("drizzle-orm")).eq(
                        webhookEvents.providerEventId,
                        eventId,
                    ),
                );

            expect(storedEvents).toHaveLength(1);

            const storedOutbox = await pool.query(
                `SELECT id
                 FROM outbox_events
                 WHERE topic = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
                ["paypal.webhook", "webhook_event", result.webhookId],
            );

            expect(storedOutbox.rowCount).toBe(1);
        } finally {
            const event = await pool.query(
                `SELECT id FROM webhook_events
                 WHERE provider = $1 AND provider_event_id = $2`,
                ["paypal", eventId],
            );

            if (event.rows[0]) {
                await pool.query(
                    `DELETE FROM outbox_events
                     WHERE topic = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
                    ["paypal.webhook", "webhook_event", event.rows[0].id],
                );
            }

            await pool.query(
                "DELETE FROM webhook_events WHERE provider = $1 AND provider_event_id = $2",
                ["paypal", eventId],
            );
        }
    });

    it("recognizes repeated delivery of the same verified event", async () => {
        const eventId = `evt-${randomUUID()}`;

        verifyWebhookSignature.mockResolvedValue({
            verification_status: "SUCCESS",
        });

        try {
            const payload = {
                id: eventId,
                event_type: "PAYMENT.CAPTURE.COMPLETED",
            };

            const first = await verifyAndIngestPayPalWebhook(payload, {});
            const second = await verifyAndIngestPayPalWebhook(payload, {});

            expect(first.duplicate).toBe(false);
            expect(second.duplicate).toBe(true);
            expect(second.webhookId).toBe(first.webhookId);

            const events = await pool.query(
                `SELECT id
                 FROM webhook_events
                 WHERE provider = $1 AND provider_event_id = $2`,
                ["paypal", eventId],
            );

            expect(events.rowCount).toBe(1);

            const outbox = await pool.query(
                `SELECT id
                 FROM outbox_events
                 WHERE topic = $1
                   AND aggregate_type = $2
                   AND aggregate_id = $3`,
                ["paypal.webhook", "webhook_event", first.webhookId],
            );

            expect(outbox.rowCount).toBe(1);
        } finally {
            await pool.query(
                `DELETE FROM outbox_events
                 WHERE topic = $1
                   AND aggregate_type = $2
                   AND aggregate_id IN (
                       SELECT id FROM webhook_events
                       WHERE provider = $3 AND provider_event_id = $4
                   )`,
                ["paypal.webhook", "webhook_event", "paypal", eventId],
            );

            await pool.query(
                `DELETE FROM webhook_events
                 WHERE provider = $1 AND provider_event_id = $2`,
                ["paypal", eventId],
            );
        }
    });
    it("rejects invalid signatures without persisting events", async () => {
        const eventId = `evt-invalid-${randomUUID()}`;

        verifyWebhookSignature.mockResolvedValue({
            verification_status: "FAILURE",
        });

        await expect(
            verifyAndIngestPayPalWebhook(
                {
                    id: eventId,
                    event_type: "PAYMENT.CAPTURE.COMPLETED",
                },
                {},
            ),
        ).rejects.toMatchObject({
            code: "WEBHOOK_SIGNATURE_INVALID",
            statusCode: 400,
        });

        const events = await pool.query(
            `SELECT id
         FROM webhook_events
         WHERE provider = $1 AND provider_event_id = $2`,
            ["paypal", eventId],
        );

        expect(events.rowCount).toBe(0);

        const outbox = await pool.query(
            `SELECT id
         FROM outbox_events
         WHERE topic = $1 AND payload->>'eventId' = $2`,
            ["paypal.webhook", eventId],
        );

        expect(outbox.rowCount).toBe(0);
    });
});

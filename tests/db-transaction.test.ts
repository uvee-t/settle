import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { users } from "../src/db/schema/core.js";
import { workspaces, documents } from "../src/db/schema/core.js";
import { idempotencyKeys } from "../src/db/schema/idempotency.js";
import { webhookEvents } from "../src/db/schema/webhook-events.js";
import { outboxEvents } from "../src/db/schema/outbox.js";

const integrationDescribe = process.env.DATABASE_URL ? describe : describe.skip;

integrationDescribe("PostgreSQL transaction integration", () => {
    let pool: Pool;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        const databaseUrl = process.env.DATABASE_URL;

        if (!databaseUrl) {
            throw new Error(
                "DATABASE_URL must be set before running integration tests",
            );
        }

        if (!new URL(databaseUrl).pathname.endsWith("/settle_test")) {
            throw new Error(
                "Refusing to run integration tests outside settle_test",
            );
        }

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

    it("rolls back writes when a transaction fails", async () => {
        const email = `rollback-${randomUUID()}@test.invalid`;

        await expect(
            db.transaction(async (tx) => {
                await tx.insert(users).values({
                    email,
                    passwordHash: "test-hash",
                    name: "Rollback Test",
                });

                throw new Error("intentional rollback");
            }),
        ).rejects.toThrow("intentional rollback");

        const result = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [email],
        );

        expect(result.rowCount).toBe(0);
    });

    it("rejects duplicate user emails at the database level", async () => {
        const email = `unique-${randomUUID()}@test.invalid`;

        const first = await db
            .insert(users)
            .values({
                email,
                passwordHash: "test-hash",
                name: "Original User",
            })
            .returning();

        try {
            await expect(
                db.insert(users).values({
                    email,
                    passwordHash: "another-test-hash",
                    name: "Duplicate User",
                }),
            ).rejects.toMatchObject({
                cause: {
                    code: "23505",
                    constraint: "users_email_unique",
                },
            });

            const result = await pool.query(
                "SELECT id, name FROM users WHERE email = $1",
                [email],
            );

            expect(result.rowCount).toBe(1);
            expect(result.rows[0].id).toBe(first[0].id);
            expect(result.rows[0].name).toBe("Original User");
        } finally {
            await pool.query("DELETE FROM users WHERE email = $1", [email]);
        }
    });
    it("rejects documents with a nonexistent owner user", async () => {
        const suffix = randomUUID();

        const [workspace] = await db
            .insert(workspaces)
            .values({
                name: `FK Test Workspace ${suffix}`,
                slug: `fk-test-${suffix}`,
            })
            .returning({ id: workspaces.id });

        const nonexistentUserId = randomUUID();

        try {
            await expect(
                db.insert(documents).values({
                    workspaceId: workspace.id,
                    ownerUserId: nonexistentUserId,
                    objectKey: `fk-test/${suffix}`,
                    filename: "test.txt",
                    contentType: "text/plain",
                    sizeBytes: "1",
                    sha256: "a".repeat(64),
                }),
            ).rejects.toMatchObject({
                cause: {
                    code: "23503",
                    constraint: "documents_owner_user_id_users_id_fk",
                },
            });
        } finally {
            await pool.query("DELETE FROM workspaces WHERE id = $1", [
                workspace.id,
            ]);
        }
    });
    it("enforces idempotency key uniqueness per operation", async () => {
        const key = `test-${randomUUID()}`;

        try {
            await db.insert(idempotencyKeys).values({
                key,
                operation: "invoice.create",
                requestHash: "hash-a",
                status: "PROCESSING",
                expiresAt: new Date(Date.now() + 60_000),
            });

            // Same key + same operation must be rejected.
            await expect(
                db.insert(idempotencyKeys).values({
                    key,
                    operation: "invoice.create",
                    requestHash: "hash-a",
                    status: "PROCESSING",
                    expiresAt: new Date(Date.now() + 60_000),
                }),
            ).rejects.toMatchObject({
                cause: {
                    code: "23505",
                    constraint: "idempotency_keys_key_unique",
                },
            });

            // Same key + different operation must be allowed.
            await expect(
                db.insert(idempotencyKeys).values({
                    key,
                    operation: "contract.create",
                    requestHash: "hash-b",
                    status: "PROCESSING",
                    expiresAt: new Date(Date.now() + 60_000),
                }),
            ).resolves.toBeDefined();
        } finally {
            await pool.query("DELETE FROM idempotency_keys WHERE key = $1", [
                key,
            ]);
        }
    });

    it("allows only one concurrent claim for the same idempotency key", async () => {
        const key = `concurrent-${randomUUID()}`;
        const operation = "invoice.create";

        const claim = () =>
            db
                .insert(idempotencyKeys)
                .values({
                    key,
                    operation,
                    requestHash: "same-request-hash",
                    status: "PROCESSING",
                    expiresAt: new Date(Date.now() + 60_000),
                })
                .onConflictDoNothing()
                .returning({ id: idempotencyKeys.id });

        try {
            const results = await Promise.all([claim(), claim()]);

            const totalClaims = results.reduce(
                (total, rows) => total + rows.length,
                0,
            );

            // Exactly one concurrent insert must win.
            expect(totalClaims).toBe(1);

            const stored = await pool.query(
                `SELECT id, status
             FROM idempotency_keys
             WHERE key = $1 AND operation = $2`,
                [key, operation],
            );

            expect(stored.rowCount).toBe(1);
            expect(stored.rows[0].status).toBe("PROCESSING");
        } finally {
            await pool.query(
                "DELETE FROM idempotency_keys WHERE key = $1 AND operation = $2",
                [key, operation],
            );
        }
    });
    it("deduplicates webhook events and outbox instructions", async () => {
        const eventId = `evt-${randomUUID()}`;

        // A UUID is required for aggregateId.
        const aggregateId = randomUUID();

        try {
            const firstEvent = await db
                .insert(webhookEvents)
                .values({
                    provider: "paypal",
                    providerEventId: eventId,
                    eventType: "PAYMENT.CAPTURE.COMPLETED",
                    payload: { id: eventId },
                    status: "RECEIVED",
                })
                .onConflictDoNothing()
                .returning({ id: webhookEvents.id });

            const duplicateEvent = await db
                .insert(webhookEvents)
                .values({
                    provider: "paypal",
                    providerEventId: eventId,
                    eventType: "PAYMENT.CAPTURE.COMPLETED",
                    payload: { id: eventId },
                    status: "RECEIVED",
                })
                .onConflictDoNothing()
                .returning({ id: webhookEvents.id });

            expect(firstEvent).toHaveLength(1);
            expect(duplicateEvent).toHaveLength(0);

            const firstOutbox = await db
                .insert(outboxEvents)
                .values({
                    topic: "paypal.webhook",
                    aggregateType: "webhook_event",
                    aggregateId,
                    payload: { webhookEventId: aggregateId, eventId },
                })
                .onConflictDoNothing()
                .returning({ id: outboxEvents.id });

            const duplicateOutbox = await db
                .insert(outboxEvents)
                .values({
                    topic: "paypal.webhook",
                    aggregateType: "webhook_event",
                    aggregateId,
                    payload: { webhookEventId: aggregateId, eventId },
                })
                .onConflictDoNothing()
                .returning({ id: outboxEvents.id });

            expect(firstOutbox).toHaveLength(1);
            expect(duplicateOutbox).toHaveLength(0);
        } finally {
            await pool.query(
                "DELETE FROM outbox_events WHERE aggregate_id = $1",
                [aggregateId],
            );

            await pool.query(
                "DELETE FROM webhook_events WHERE provider = $1 AND provider_event_id = $2",
                ["paypal", eventId],
            );
        }
    });
});

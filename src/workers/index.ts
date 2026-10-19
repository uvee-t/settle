import { Worker } from "bullmq";

import { and, eq, lte, inArray } from "drizzle-orm";

import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { db, pool } from "../db/client.js";

import { webhookEvents } from "../db/schema/webhook-events.js";
import { invoices } from "../db/schema/invoices.js";
import { payments, documents } from "../db/schema/core.js";
import { outboxEvents } from "../db/schema/outbox.js";
import { deadLetterJobs } from "../db/schema/dead-letter.js";

import { syncDispute } from "../modules/disputes/dispute.service.js";
import { extractContractFacts } from "../modules/ai/ai.service.js";
import { documentExtractionJobId, successfulExtractionDocumentIds } from "../modules/ai/ai-jobs.js";
import {
    analyzeEvidencePack,
    generateEvidencePack,
} from "../modules/evidence/evidence-intelligence.service.js";

import { evidencePacks, aiRuns } from "../db/schema/ai.js";
import { workspacePayPalInvoices } from "../modules/paypal/paypal.invoices.js";
import { getWorkspacePayPalClient } from "../modules/paypal/paypal.workspace.js";
import { workspacePayPalDisputes } from "../modules/paypal/paypal.disputes.js";
import { verifyStoredDocument } from "../modules/documents/document.service.js";

import {
    webhookQueue,
    outboxQueue,
    reminderQueue,
    documentQueue,
    aiQueue,
} from "../lib/queue.js";

import { env } from "../config/env.js";
import { writeAudit } from "../lib/audit.js";
import { AppError } from "../lib/errors.js";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

async function recordDeadLetter(input: {
    queue: string;
    jobId: string;
    sourceType: string;
    sourceId: string;
    payload: unknown;
    error: unknown;
    attempts: number;
}) {
    await db
        .insert(deadLetterJobs)
        .values({
            queue: input.queue,
            jobId: input.jobId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            payload: input.payload,
            error: input.error instanceof Error
                ? input.error.message.slice(0, 2000)
                : String(input.error).slice(0, 2000),
            attempts: String(input.attempts),
        })
        .onConflictDoNothing();
}

/* -------------------------------------------------------------------------- */
/* Webhook Worker                                                             */
/* -------------------------------------------------------------------------- */

const webhookWorker = new Worker(
    "settle-webhooks",
    async (job) => {
        const {
            eventId,
            eventType,
            payload: jobPayload,
        } = job.data as {
            eventId: string;
            eventType: string;
            payload?: Record<string, unknown>;
        };

        logger.info(
            {
                jobId: job.id,
                jobName: job.name,
                eventId,
                eventType,
            },
            "Processing webhook job",
        );

        /**
         * The webhook payload should normally be present in BullMQ.
         *
         * However, the database is our durable source of truth.
         * If a job was manually repaired/requeued with only eventId,
         * recover the original payload from webhook_events.
         */
        let payload = jobPayload;
        const storedWebhookEvent = await db.query.webhookEvents.findFirst({
            where: and(eq(webhookEvents.provider, "paypal"), eq(webhookEvents.providerEventId, eventId)),
        });
        const webhookWorkspaceId = storedWebhookEvent?.workspaceId ?? null;

        if (!payload) {
            logger.warn(
                {
                    jobId: job.id,
                    eventId,
                    eventType,
                },
                "Webhook job payload missing; loading payload from database",
            );

            const storedEvent = await db.query.webhookEvents.findFirst({
                where: and(
                    eq(webhookEvents.provider, "paypal"),
                    eq(webhookEvents.providerEventId, eventId),
                ),
            });

            if (!storedEvent) {
                throw new Error(
                    `Webhook event ${eventId} not found in database`,
                );
            }

            payload = asRecord(storedEvent.payload);
        }

        const resource = asRecord(payload.resource);

        try {
            /* ------------------------------------------------------------------ */
            /* PayPal Invoice Webhooks                                             */
            /* ------------------------------------------------------------------ */

            if (eventType.startsWith("INVOICING.INVOICE.")) {
                const invoice = asRecord(resource.invoice ?? resource);

                const providerInvoiceId = asString(invoice.id) ?? "";

                if (providerInvoiceId) {
                    const detail = asRecord(invoice.detail);
                    const amount = asRecord(invoice.amount);

                    const status = String(
                        invoice.status ??
                            eventType.split(".").at(-1) ??
                            "UNKNOWN",
                    ).toLowerCase();

                    await db.transaction(async (tx) => {
                        const existing = await tx.query.invoices.findFirst({
                            where: and(
                                eq(invoices.provider, "paypal"),
                                eq(
                                    invoices.providerInvoiceId,
                                    providerInvoiceId,
                                ),
                                webhookWorkspaceId ? eq(invoices.workspaceId, webhookWorkspaceId) : undefined,
                            ),
                        });

                        /* ------------------------------------------------------ */
                        /* Existing local invoice                                */
                        /* ------------------------------------------------------ */

                        if (existing) {
                            /*
                             * Capture the state before applying the provider
                             * update. This is required for a correct financial
                             * audit trail.
                             */
                            const previousStatus = existing.status;
                            const previousPaidAt = existing.paidAt;

                            /*
                             * Reuse the same paidAt timestamp for both the
                             * database state transition and the audit record.
                             */
                            const paidAt =
                                status === "paid"
                                    ? (existing.paidAt ?? new Date())
                                    : existing.paidAt;

                            /* -------------------------------------------------- */
                            /* Update invoice state                               */
                            /* -------------------------------------------------- */

                            await tx
                                .update(invoices)
                                .set({
                                    status,
                                    rawPayload: invoice,
                                    paidAt,
                                    updatedAt: new Date(),
                                })
                                .where(eq(invoices.id, existing.id));

                            /* -------------------------------------------------- */
                            /* Payment creation/update                            */
                            /* -------------------------------------------------- */

                            /**
                             * PayPal's INVOICING.INVOICE.PAID payload stores
                             * payment information under:
                             *
                             * resource.invoice.payments.transactions[]
                             */
                            if (status === "paid") {
                                const invoicePayments = asRecord(
                                    invoice.payments,
                                );

                                const transactions = Array.isArray(
                                    invoicePayments.transactions,
                                )
                                    ? invoicePayments.transactions
                                    : [];

                                for (const transaction of transactions) {
                                    if (
                                        !transaction ||
                                        typeof transaction !== "object"
                                    ) {
                                        continue;
                                    }

                                    const payment = asRecord(transaction);

                                    const paymentId = asString(
                                        payment.payment_id,
                                    );

                                    if (!paymentId) {
                                        continue;
                                    }

                                    const transactionAmount = asRecord(
                                        payment.amount,
                                    );

                                    const paymentAmount =
                                        asString(transactionAmount.value) ??
                                        existing.amount;

                                    const paymentCurrency =
                                        asString(
                                            transactionAmount.currency_code,
                                        ) ?? existing.currency;

                                    const paymentDateTime = asString(
                                        payment.payment_date_time,
                                    );

                                    const capturedAt = paymentDateTime
                                        ? new Date(paymentDateTime)
                                        : new Date();

                                    await tx
                                        .insert(payments)
                                        .values({
                                            workspaceId: existing.workspaceId!,
                                            invoiceId: existing.id,
                                            provider: "paypal",
                                            providerPaymentId: paymentId,
                                            status: "succeeded",
                                            amount: paymentAmount,
                                            currency: paymentCurrency,
                                            capturedAt,
                                            rawPayload: payment,
                                        })
                                        .onConflictDoUpdate({
                                            target: [
                                                payments.provider,
                                                payments.providerPaymentId,
                                            ],
                                            set: {
                                                status: "succeeded",
                                                invoiceId: existing.id,
                                                amount: paymentAmount,
                                                currency: paymentCurrency,
                                                capturedAt,
                                                rawPayload: payment,
                                                updatedAt: new Date(),
                                            },
                                        });

                                    logger.info(
                                        {
                                            jobId: job.id,
                                            eventId,
                                            providerInvoiceId,
                                            providerPaymentId: paymentId,
                                            amount: paymentAmount,
                                            currency: paymentCurrency,
                                        },
                                        "PayPal payment persisted",
                                    );
                                }

                                /* -------------------------------------------------- */
                                /* Financial audit                                    */
                                /* -------------------------------------------------- */

                                /**
                                 * Only create invoice.paid when the invoice
                                 * actually transitions into paid.
                                 *
                                 * This is important because PayPal webhooks
                                 * can be delivered more than once.
                                 *
                                 * Example:
                                 *
                                 * sent -> paid
                                 *       ^ audit created
                                 *
                                 * paid -> paid
                                 *       ^ no duplicate audit
                                 */
                                if (previousStatus !== "paid") {
                                    await writeAudit(
                                        {
                                            workspaceId:
                                                existing.workspaceId ??
                                                undefined,

                                            actorType: "system",

                                            action: "invoice.paid",

                                            resourceType: "invoice",

                                            resourceId: existing.id,

                                            /*
                                             * Provider event ID is useful for
                                             * tracing the exact PayPal event
                                             * which caused the financial
                                             * transition.
                                             */
                                            requestId: eventId,

                                            before: {
                                                status: previousStatus,
                                                paidAt: previousPaidAt,
                                            },

                                            after: {
                                                status: "paid",
                                                paidAt,
                                            },

                                            metadata: {
                                                provider: "paypal",
                                                providerInvoiceId,
                                                eventId,
                                            },
                                        },
                                        tx,
                                    );

                                    logger.info(
                                        {
                                            jobId: job.id,
                                            eventId,
                                            providerInvoiceId,
                                            invoiceId: existing.id,
                                        },
                                        "PayPal invoice paid audit recorded",
                                    );
                                }
                            }
                        } else {
                            /* -------------------------------------------------- */
                            /* Invoice does not exist locally                    */
                            /* -------------------------------------------------- */

                            /**
                             * Keep webhook processing resilient if PayPal
                             * sends an event before local reconciliation.
                             */
                            await tx.insert(invoices).values({
                                workspaceId: webhookWorkspaceId ?? undefined,
                                provider: "paypal",

                                providerInvoiceId,

                                invoiceNumber: asString(detail.invoice_number),

                                reference: asString(detail.reference),

                                status,

                                currency:
                                    asString(amount.currency_code) ?? "USD",

                                amount: asString(amount.value) ?? "0",

                                dueAt: (() => {
                                    const paymentTerm = asRecord(
                                        detail.payment_term,
                                    );

                                    const dueDate = asString(
                                        paymentTerm.due_date,
                                    );

                                    return dueDate
                                        ? new Date(dueDate)
                                        : undefined;
                                })(),

                                rawPayload: invoice,

                                paidAt:
                                    status === "paid" ? new Date() : undefined,
                            });

                            logger.warn(
                                {
                                    jobId: job.id,
                                    eventId,
                                    providerInvoiceId,
                                },
                                "PayPal invoice did not exist locally; created reconciliation record",
                            );
                        }
                    });

                    logger.info(
                        {
                            jobId: job.id,
                            eventId,
                            providerInvoiceId,
                            status,
                        },
                        "PayPal invoice webhook processed",
                    );
                }
            }

            /* ------------------------------------------------------------------ */
            /* PayPal Dispute Webhooks                                             */
            /* ------------------------------------------------------------------ */

            if (eventType.startsWith("CUSTOMER.DISPUTE.")) {
                const dispute = asRecord(resource.dispute ?? resource);

                const disputeId = asString(dispute.dispute_id);

                if (disputeId) {
                    if (webhookWorkspaceId) {
                        const client = await getWorkspacePayPalClient(webhookWorkspaceId);
                        await syncDispute(disputeId, webhookWorkspaceId, workspacePayPalDisputes(client));
                    } else {
                        await syncDispute(disputeId);
                    }
                }

                logger.info(
                    {
                        jobId: job.id,
                        eventId,
                        eventType,
                        disputeId,
                    },
                    "PayPal dispute webhook processed",
                );
            }

            /* ------------------------------------------------------------------ */
            /* Mark webhook event as processed                                    */
            /* ------------------------------------------------------------------ */

            await db.transaction(async (tx) => {
                await tx
                    .update(webhookEvents)
                    .set({
                        status: "PROCESSED",
                        processedAt: new Date(),
                        attempts: String(job.attemptsMade + 1),
                        lastError: null,
                    })
                    .where(and(eq(webhookEvents.providerEventId, eventId), webhookWorkspaceId ? eq(webhookEvents.workspaceId, webhookWorkspaceId) : undefined));

                await tx
                    .update(outboxEvents)
                    .set({
                        status: "PROCESSED",
                        processedAt: new Date(),
                        lastError: null,
                    })
                    .where(
                        and(
                            eq(outboxEvents.topic, "paypal.webhook"),
                            eq(outboxEvents.aggregateType, "webhook_event"),
                            eq(outboxEvents.aggregateId, (await tx.query.webhookEvents.findFirst({
                                where: and(
                                    eq(webhookEvents.provider, "paypal"),
                                    eq(webhookEvents.providerEventId, eventId),
                                ),
                            }))!.id),
                        ),
                    );
            });

            logger.info(
                {
                    jobId: job.id,
                    eventId,
                    eventType,
                },
                "Webhook job completed successfully",
            );
        } catch (error) {
            const attempt = job.attemptsMade + 1;
            const finalAttempt = attempt >= (job.opts.attempts ?? 1);
            const message = error instanceof Error ? error.message : String(error);

            await db.transaction(async (tx) => {
                const stored = await tx.query.webhookEvents.findFirst({
                    where: and(
                        eq(webhookEvents.provider, "paypal"),
                        eq(webhookEvents.providerEventId, eventId),
                    ),
                });

                if (!stored) return;

                await tx
                    .update(webhookEvents)
                    .set({
                        status: finalAttempt ? "FAILED" : "RECEIVED",
                        attempts: String(attempt),
                        lastError: message.slice(0, 2000),
                    })
                    .where(eq(webhookEvents.id, stored.id));

                if (finalAttempt) {
                    await tx
                        .update(outboxEvents)
                        .set({
                            status: "DEAD_LETTERED",
                            lastError: message.slice(0, 2000),
                            availableAt: new Date(),
                        })
                        .where(
                            and(
                                eq(outboxEvents.topic, "paypal.webhook"),
                                eq(outboxEvents.aggregateType, "webhook_event"),
                                eq(outboxEvents.aggregateId, stored.id),
                            ),
                        );
                }
            });

            if (finalAttempt) {
                await recordDeadLetter({
                    queue: "settle-webhooks",
                    jobId: String(job.id),
                    sourceType: "webhook_event",
                    sourceId: (await db.query.webhookEvents.findFirst({
                        where: and(
                            eq(webhookEvents.provider, "paypal"),
                            eq(webhookEvents.providerEventId, eventId),
                        ),
                    }))!.id,
                    payload,
                    error,
                    attempts: attempt,
                });
            }

            logger.error(
                {
                    jobId: job.id,
                    eventId,
                    eventType,
                    err: error,
                },
                "Webhook processing failed",
            );

            throw error;
        }
    },
    {
        connection: redis,
        concurrency: 10,
    },
);

/* -------------------------------------------------------------------------- */
/* Webhook worker lifecycle logging                                           */
/* -------------------------------------------------------------------------- */

webhookWorker.on("ready", () => {
    logger.info("Webhook worker ready");
});

webhookWorker.on("active", (job) => {
    logger.info(
        {
            jobId: job.id,
            jobName: job.name,
        },
        "Webhook job active",
    );
});

webhookWorker.on("completed", (job) => {
    logger.info(
        {
            jobId: job.id,
            jobName: job.name,
        },
        "Webhook job completed",
    );
});

webhookWorker.on("failed", (job, error) => {
    logger.error(
        {
            jobId: job?.id,
            jobName: job?.name,
            err: error,
        },
        "Webhook job failed",
    );
});

webhookWorker.on("error", (error) => {
    logger.error(
        {
            err: error,
        },
        "Webhook worker error",
    );
});

/* -------------------------------------------------------------------------- */
/* Outbox Worker                                                              */
/* -------------------------------------------------------------------------- */

const outboxWorker = new Worker(
    "settle-outbox",
    async (job) => {
        const { outboxId } = job.data as {
            outboxId: string;
        };

        const event = await db.query.outboxEvents.findFirst({
            where: eq(outboxEvents.id, outboxId),
        });

        if (!event || event.status === "PROCESSED") {
            return;
        }

        try {
            if (event.topic === "invoice.created") {
                const payload = event.payload as {
                    invoiceId?: string;
                };

                if (payload.invoiceId) {
                    const invoice = await db.query.invoices.findFirst({
                        where: eq(invoices.id, payload.invoiceId),
                    });

                    if (
                        invoice?.providerPayload &&
                        !invoice.providerInvoiceId
                    ) {
                        if (!invoice.workspaceId) throw new Error("Invoice is missing workspace ownership.");
                        const provider = await workspacePayPalInvoices(await getWorkspacePayPalClient(invoice.workspaceId)).create(
                            invoice.providerPayload as Record<string, unknown>,
                            `settle-invoice-${invoice.id}`,
                        );

                        const providerId =
                            typeof (provider as Record<string, unknown>).id ===
                            "string"
                                ? String(
                                      (provider as Record<string, unknown>).id,
                                  )
                                : "";

                        await db
                            .update(invoices)
                            .set({
                                providerInvoiceId: providerId || undefined,

                                rawPayload: provider,

                                status: String(
                                    (provider as Record<string, unknown>)
                                        .status ?? "DRAFT",
                                ).toLowerCase(),

                                updatedAt: new Date(),
                            })
                            .where(eq(invoices.id, invoice.id));
                    }
                }
            }

            const attempt = Number(event.attempts) + 1;

            await db
                .update(outboxEvents)
                .set({
                    status: "PROCESSED",
                    processedAt: new Date(),
                    attempts: String(attempt),
                    lastError: null,
                })
                .where(eq(outboxEvents.id, outboxId));
        } catch (error) {
            const attempt = Number(event.attempts) + 1;
            const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
            const message = error instanceof Error ? error.message : String(error);

            await db
                .update(outboxEvents)
                .set({
                    status: finalAttempt ? "DEAD_LETTERED" : "QUEUED",
                    attempts: String(attempt),
                    lastError: message.slice(0, 2000),
                    availableAt: finalAttempt
                        ? new Date(Date.now() + 5 * 60_000)
                        : new Date(),
                })
                .where(eq(outboxEvents.id, outboxId));

            if (finalAttempt) {
                await recordDeadLetter({
                    queue: "settle-outbox",
                    jobId: String(job.id),
                    sourceType: "outbox_event",
                    sourceId: outboxId,
                    payload: event.payload,
                    error,
                    attempts: attempt,
                });
            }

            throw error;
        }
    },
    {
        connection: redis,
        concurrency: 5,
    },
);

/* -------------------------------------------------------------------------- */
/* Outbox worker lifecycle logging                                            */
/* -------------------------------------------------------------------------- */

outboxWorker.on("ready", () => {
    logger.info("Outbox worker ready");
});

outboxWorker.on("active", (job) => {
    logger.info(
        {
            jobId: job.id,
            jobName: job.name,
        },
        "Outbox job active",
    );
});

outboxWorker.on("completed", (job) => {
    logger.info(
        {
            jobId: job.id,
            jobName: job.name,
        },
        "Outbox job completed",
    );
});

outboxWorker.on("failed", (job, error) => {
    logger.error(
        {
            jobId: job?.id,
            jobName: job?.name,
            err: error,
        },
        "Outbox job failed",
    );
});

outboxWorker.on("error", (error) => {
    logger.error(
        {
            err: error,
        },
        "Outbox worker error",
    );
});

/* -------------------------------------------------------------------------- */
/* Outbox Dispatcher                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Moves pending DB outbox events into BullMQ.
 *
 * BullMQ custom job IDs cannot contain ":".
 */

const recoverWebhookOutbox = async () => {
    const cutoff = new Date(Date.now() - 2 * 60_000);

    const events = await db.query.webhookEvents.findMany({
        where: eq(webhookEvents.status, "RECEIVED"),
        limit: 100,
    });

    for (const event of events) {
        if (event.receivedAt > cutoff) continue;

        let existingOutbox = await db.query.outboxEvents.findFirst({
            where: and(
                eq(outboxEvents.topic, "paypal.webhook"),
                eq(outboxEvents.aggregateType, "webhook_event"),
                eq(outboxEvents.aggregateId, event.id),
            ),
        });

        if (!existingOutbox) {
            const [created] = await db
                .insert(outboxEvents)
                .values({
                    topic: "paypal.webhook",
                    aggregateType: "webhook_event",
                    aggregateId: event.id,
                    payload: {
                        webhookEventId: event.id,
                        eventId: event.providerEventId,
                        eventType: event.eventType,
                    },
                })
                .onConflictDoNothing()
                .returning();
            existingOutbox = created;
        }

        if (!existingOutbox || existingOutbox.status === "DEAD_LETTERED") {
            continue;
        }

        if (existingOutbox.status === "QUEUED") {
            const job = await webhookQueue.getJob(`webhook-${event.id}`);
            if (job) {
                const state = await job.getState();
                if (["waiting", "delayed", "active"].includes(state)) {
                    continue;
                }
            }
        }

        await db
            .update(outboxEvents)
            .set({
                status: "PENDING",
                processedAt: null,
                availableAt: new Date(),
                lastError: "Webhook recovery requeued stale delivery",
            })
            .where(eq(outboxEvents.id, existingOutbox.id));
    }
};

void recoverWebhookOutbox().catch((error) =>
    logger.error({ err: error }, "Webhook recovery failed"),
);

const webhookRecoveryInterval = setInterval(
    () =>
        void recoverWebhookOutbox().catch((error) =>
            logger.error({ err: error }, "Webhook recovery failed"),
        ),
    60 * 1000,
);

const dispatcher = setInterval(async () => {
    try {
        const pending = await db.query.outboxEvents.findMany({
            where: and(
                inArray(outboxEvents.status, ["PENDING", "FAILED"]),
                lte(outboxEvents.availableAt, new Date()),
            ),
            limit: 100,
        });

        for (const event of pending) {
            const queue =
                event.topic === "paypal.webhook" ? webhookQueue : outboxQueue;
            const jobId =
                event.topic === "paypal.webhook"
                    ? `webhook-${event.aggregateId}`
                    : `outbox-${event.id}`;

            const existingJob = await queue.getJob(jobId);
            if (existingJob) {
                const state = await existingJob.getState();

                if (["waiting", "delayed", "active", "paused"].includes(state)) {
                    await db
                        .update(outboxEvents)
                        .set({ status: "QUEUED" })
                        .where(eq(outboxEvents.id, event.id));
                    continue;
                }

                await existingJob.remove().catch(() => undefined);
            }

            if (event.topic === "paypal.webhook") {
                await webhookQueue.add("paypal.webhook", event.payload, {
                    jobId,
                });
            } else {
                await outboxQueue.add(
                    event.topic,
                    { outboxId: event.id },
                    { jobId },
                );
            }

            await db
                .update(outboxEvents)
                .set({
                    status: "QUEUED",
                    processedAt: null,
                    availableAt: new Date(),
                })
                .where(eq(outboxEvents.id, event.id));
        }
    } catch (error) {
        logger.error({ err: error }, "Outbox dispatcher failed");
    }
}, 1000);

/* -------------------------------------------------------------------------- */
/* Automated invoice reminders                                                */
/* -------------------------------------------------------------------------- */

const reminderWorker = new Worker(
    "settle-reminders",
    async (job) => {
        const { invoiceId } = job.data as {
            invoiceId: string;
        };

        const invoice = await db.query.invoices.findFirst({
            where: eq(invoices.id, invoiceId),
        });

        if (
            !invoice ||
            invoice.status !== "sent" ||
            !invoice.providerInvoiceId
        ) {
            return;
        }

        const lockKey = `settle:reminder:${
            invoice.id
        }:${new Date().toISOString().slice(0, 10)}`;

        const locked = await redis.set(lockKey, "1", "EX", 86_400, "NX");

        if (locked !== "OK") return;

        if (!invoice.workspaceId) throw new Error("Invoice is missing workspace ownership.");
        await workspacePayPalInvoices(await getWorkspacePayPalClient(invoice.workspaceId)).remind(invoice.providerInvoiceId, {});

        try {
            await writeAudit({
                workspaceId: invoice.workspaceId ?? undefined,

                actorType: "system",

                action: "invoice.reminder_sent",

                resourceType: "invoice",

                resourceId: invoice.id,

                metadata: {
                    automated: true,
                },
            });
        } catch (auditError) {
            logger.error(
                {
                    err: auditError,
                    invoiceId: invoice.id,
                },
                "Failed to write reminder audit",
            );
        }

        logger.info(
            {
                invoiceId: invoice.id,
                providerInvoiceId: invoice.providerInvoiceId,
            },
            "Automated invoice reminder sent",
        );
    },
    {
        connection: redis,
        concurrency: 5,
    },
);

const dispatchReminders = async () => {
    if (!env.REMINDER_ENABLED) return;

    try {
        const now = new Date();

        const horizon = new Date(
            now.getTime() + env.REMINDER_DAYS_BEFORE_DUE * 86_400_000,
        );

        const rows = await db.query.invoices.findMany({
            where: and(
                eq(invoices.status, "sent"),
                lte(invoices.dueAt, horizon),
            ),
            limit: 5000,
        });

        const dateKey = now.toISOString().slice(0, 10);

        for (const invoice of rows) {
            if (!invoice.dueAt || !invoice.providerInvoiceId) {
                continue;
            }

            await reminderQueue.add(
                "invoice.reminder",
                {
                    invoiceId: invoice.id,
                },
                {
                    jobId: `invoice-reminder-${invoice.id}-${dateKey}`,
                },
            );
        }
    } catch (error) {
        logger.error(
            {
                err: error,
            },
            "Reminder dispatcher failed",
        );
    }
};

void dispatchReminders();

const reminderDispatcher = setInterval(
    () => void dispatchReminders(),
    60 * 60 * 1000,
);

reminderWorker.on("ready", () => logger.info("Reminder worker ready"));

reminderWorker.on("failed", (job, error) =>
    logger.error(
        {
            jobId: job?.id,
            err: error,
        },
        "Reminder job failed",
    ),
);

/* -------------------------------------------------------------------------- */
/* Document verification worker                                               */
/* -------------------------------------------------------------------------- */

const documentWorker = new Worker(
    "settle-documents",
    async (job) => {
        const { documentId } = job.data as {
            documentId: string;
        };

        const document = await db.query.documents.findFirst({
            where: eq(documents.id, documentId),
        });

        if (!document) return;

        if (document.verificationStatus === "verified") {
            return;
        }

        await db
            .update(documents)
            .set({
                verificationStatus: "verifying",
                verificationError: null,
            })
            .where(eq(documents.id, document.id));

        try {
            const result = await verifyStoredDocument({
                workspaceId: document.workspaceId,

                objectKey: document.objectKey,

                filename: document.filename,

                contentType: document.contentType,

                expectedSizeBytes: Number(document.sizeBytes),

                expectedSha256: document.sha256,
            });

            const [verified] = await db
                .update(documents)
                .set({
                    status: "verified",

                    verificationStatus: "verified",

                    verificationError: null,

                    detectedContentType: result.detectedContentType,

                    verifiedAt: new Date(),
                })
                .where(eq(documents.id, document.id))
                .returning();

            await writeAudit({
                workspaceId: document.workspaceId,

                actorType: "system",

                action: "document.verified",

                resourceType: "document",

                resourceId: document.id,

                after: verified,
            });

            if (env.AI_ENABLED) {
                try {
                    await aiQueue.add(
                        "document.extract",
                        {
                            documentId: document.id,
                        },
                        {
                            jobId: documentExtractionJobId(document.id, document.sha256),
                        },
                    );
                } catch (error) {
                    logger.error(
                        {
                            documentId: document.id,
                            err: error,
                        },
                        "Failed to enqueue document AI extraction; recovery will retry",
                    );
                }
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);

            await db
                .update(documents)
                .set({
                    status: "rejected",

                    verificationStatus: "rejected",

                    verificationError: message.slice(0, 1000),
                })
                .where(eq(documents.id, document.id));

            await writeAudit({
                workspaceId: document.workspaceId,

                actorType: "system",

                action: "document.verification_failed",

                resourceType: "document",

                resourceId: document.id,

                metadata: {
                    error: message.slice(0, 1000),
                },
            });

            if (error instanceof AppError && error.statusCode < 500) {
                return;
            }

            throw error;
        }
    },
    {
        connection: redis,
        concurrency: 3,
    },
);

documentWorker.on("ready", () =>
    logger.info("Document verification worker ready"),
);

documentWorker.on("failed", (job, error) =>
    logger.error(
        {
            jobId: job?.id,
            err: error,
        },
        "Document verification job failed",
    ),
);

const recoverDocuments = async () => {
    const rows = await db.query.documents.findMany({
        where: inArray(documents.verificationStatus, ["pending", "verifying"]),
        limit: 100,
    });

    for (const document of rows) {
        await documentQueue.add(
            "document.verify",
            {
                documentId: document.id,
            },
            {
                jobId: `document-verify-${document.id}`,
            },
        );
    }
};

void recoverDocuments();

const documentRecoveryInterval = setInterval(
    () =>
        void recoverDocuments().catch((error) =>
            logger.error(
                {
                    err: error,
                },
                "Document recovery failed",
            ),
        ),
    60 * 1000,
);

/* -------------------------------------------------------------------------- */
/* AI + evidence intelligence worker                                         */
/* -------------------------------------------------------------------------- */

const aiWorker = new Worker(
    "settle-ai",
    async (job) => {
        if (job.name === "document.extract") {
            const { documentId } = job.data as {
                documentId: string;
            };

            if (!env.AI_ENABLED) {
                logger.info(
                    {
                        documentId,
                    },
                    "AI disabled; document extraction skipped",
                );

                return;
            }

            await extractContractFacts(documentId);

            logger.info(
                {
                    documentId,
                },
                "Document AI extraction completed",
            );

            return;
        }

        if (job.name === "dispute.analyze") {
            const { disputeId, workspaceId } = job.data as {
                disputeId: string;
                workspaceId: string;
            };

            if (!env.AI_ENABLED) {
                logger.info(
                    {
                        disputeId,
                    },
                    "AI disabled; dispute analysis skipped",
                );

                return;
            }

            const generated = await generateEvidencePack(
                disputeId,
                workspaceId,
            );

            await analyzeEvidencePack(generated.packId, workspaceId);

            logger.info(
                {
                    disputeId,
                    packId: generated.packId,
                },
                "Dispute evidence pack analyzed",
            );

            return;
        }

        throw new Error(`Unknown AI job ${job.name}`);
    },
    {
        connection: redis,
        concurrency: 2,
    },
);

aiWorker.on("ready", () => logger.info("AI/evidence worker ready"));

aiWorker.on("failed", (job, error) =>
    logger.error(
        {
            jobId: job?.id,
            jobName: job?.name,
            err: error,
        },
        "AI job failed",
    ),
);

const recoverAiJobs = async () => {
    if (!env.AI_ENABLED) return;

    const analyzedIds = new Set<string>();
    const runPageSize = 1000;
    let runOffset = 0;
    while (true) {
        const runs = await db.query.aiRuns.findMany({
            where: and(
                eq(aiRuns.task, "document.contract_extraction"),
                eq(aiRuns.status, "SUCCEEDED"),
            ),
            orderBy: (run, { asc }) => [asc(run.createdAt), asc(run.id)],
            limit: runPageSize,
            offset: runOffset,
        });
        for (const id of successfulExtractionDocumentIds(runs)) analyzedIds.add(id);
        if (runs.length < runPageSize) break;
        runOffset += runs.length;
    }

    const documentPageSize = 100;
    let documentOffset = 0;
    while (true) {
        const verified = await db.query.documents.findMany({
            where: eq(documents.verificationStatus, "verified"),
            orderBy: (document, { asc }) => [asc(document.createdAt), asc(document.id)],
            limit: documentPageSize,
            offset: documentOffset,
        });
        if (verified.length === 0) break;

        for (const document of verified) {
            if (analyzedIds.has(document.id)) continue;
            const jobId = documentExtractionJobId(document.id, document.sha256);
            const existingJob = await aiQueue.getJob(jobId);
            if (existingJob) {
                const state = await existingJob.getState();
                if (state === "failed") {
                    await existingJob.retry("failed");
                } else if (state === "completed") {
                    // No successful DB run was found, so this completed queue record
                    // must not permanently block recovery.
                    await existingJob.remove();
                    await aiQueue.add("document.extract", { documentId: document.id }, { jobId });
                }
                // Waiting, delayed, active and other in-flight states are already queued.
                continue;
            }
            await aiQueue.add("document.extract", { documentId: document.id }, { jobId });
        }

        if (verified.length < documentPageSize) break;
        documentOffset += verified.length;
    }
};

void recoverAiJobs().catch((error) =>
    logger.error(
        {
            err: error,
        },
        "AI recovery failed",
    ),
);

const aiRecoveryInterval = setInterval(
    () =>
        void recoverAiJobs().catch((error) =>
            logger.error(
                {
                    err: error,
                },
                "AI recovery failed",
            ),
        ),
    5 * 60 * 1000,
);

/* -------------------------------------------------------------------------- */
/* Graceful shutdown                                                         */
/* -------------------------------------------------------------------------- */

let shuttingDown = false;

async function shutdown(signal: string) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    logger.info(
        {
            signal,
        },
        "Shutting down workers",
    );

    clearInterval(dispatcher);
    clearInterval(reminderDispatcher);
    clearInterval(webhookRecoveryInterval);
    clearInterval(documentRecoveryInterval);
    clearInterval(aiRecoveryInterval);

    await Promise.all([
        webhookWorker.close(),
        outboxWorker.close(),
        reminderWorker.close(),
        documentWorker.close(),
        aiWorker.close(),
    ]);

    await redis.quit();
    await pool.end();

    logger.info("Workers shut down cleanly");

    process.exit(0);
}

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

logger.info("Settle workers started");

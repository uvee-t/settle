import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../db/client.js";
import { invoiceItems, invoices } from "../../db/schema/invoices.js";
import { clients, contracts } from "../../db/schema/core.js";

import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";

import { paypalInvoices } from "../paypal/paypal.invoices.js";

import { writeAudit } from "../../lib/audit.js";

import {
    ExternalServiceError,
    NotFoundError,
    ValidationError,
} from "../../lib/errors.js";

import { findExistingPayPalInvoice } from "../paypal/paypal.invoice-reconciliation.js";

import {
    beginIdempotency,
    completeIdempotency,
    getIdempotentResponse,
    releaseIdempotency,
} from "../../lib/idempotency.js";

import { enqueueOutbox } from "../../lib/outbox.js";
import { multiplyMoney, sumMoney } from "../../lib/money.js";

const itemSchema = z.object({
    description: z.string().min(1).max(500),

    quantity: z
        .string()
        .regex(/^\d+(\.\d{1,4})?$/)
        .default("1"),

    unit_amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
});

const createSchema = z.object({
    client_id: z.uuid(),

    contract_id: z.uuid().optional(),

    invoice_number: z.string().max(100).optional(),

    reference: z.string().max(200).optional(),

    currency: z.string().length(3).default("USD"),

    due_at: z.coerce.date().optional(),

    items: z.array(itemSchema).min(1),

    paypal_payload: z.record(z.string(), z.unknown()).optional(),
});

const transitionSchema = z.object({
    status: z.enum(["draft", "sent", "paid", "cancelled", "refunded"]),
});

const transitions: Record<string, string[]> = {
    draft: ["sent", "cancelled"],
    sent: ["paid", "cancelled", "refunded"],
    paid: ["refunded"],
    cancelled: [],
    refunded: [],
};

function total(items: Array<{ quantity: string; unit_amount: string }>) {
    return sumMoney(
        items.map((item) => multiplyMoney(item.quantity, item.unit_amount)),
    );
}

export async function invoiceRoutes(app: FastifyInstance) {
    /*
     * List invoices
     */
    app.get(
        "/v1/invoices",
        {
            preHandler: requireWorkspace,
        },
        async (request) => {
            return db.query.invoices.findMany({
                where: eq(invoices.workspaceId, request.auth!.workspaceId!),
                orderBy: [desc(invoices.createdAt)],
            });
        },
    );

    /*
     * Get invoice
     */
    app.get(
        "/v1/invoices/:id",
        {
            preHandler: requireWorkspace,
        },
        async (request) => {
            const { id } = z
                .object({
                    id: z.uuid(),
                })
                .parse(request.params);

            const invoice = await db.query.invoices.findFirst({
                where: and(
                    eq(invoices.id, id),
                    eq(invoices.workspaceId, request.auth!.workspaceId!),
                ),
            });

            if (!invoice) {
                throw new NotFoundError("Invoice not found.");
            }

            const items = await db.query.invoiceItems.findMany({
                where: eq(invoiceItems.invoiceId, id),
            });

            return {
                ...invoice,
                items,
            };
        },
    );

    /*
     * Create invoice
     */
    app.post(
        "/v1/invoices",
        {
            preHandler: requireRole("owner", "admin", "member"),
        },
        async (request, reply) => {
            const body = createSchema.parse(request.body);

            const operation = "invoice.create";

            /*
             * First check whether this idempotency key
             * already completed.
             */
            const cached = await getIdempotentResponse(request, operation);

            if (cached) {
                return reply.code(200).send(cached);
            }

            /*
             * Create/reclaim the PROCESSING claim.
             */
            const idempotency = await beginIdempotency(request, operation);

            const workspaceId = request.auth!.workspaceId!;

            /*
             * Extract the idempotency record ID.
             *
             * If no Idempotency-Key was supplied,
             * this remains null.
             */
            const idempotencyId =
                idempotency &&
                typeof idempotency === "object" &&
                idempotency !== null &&
                "id" in idempotency &&
                typeof (
                    idempotency as {
                        id?: unknown;
                    }
                ).id === "string"
                    ? (
                          idempotency as {
                              id: string;
                          }
                      ).id
                    : null;

            try {
                /*
                 * The invoice, invoice items, outbox event,
                 * and audit record are created in one transaction.
                 */
                const result = await db.transaction(async (tx) => {
                    /*
                     * Verify client belongs to workspace.
                     */
                    const client = await tx.query.clients.findFirst({
                        where: and(
                            eq(clients.id, body.client_id),
                            eq(clients.workspaceId, workspaceId),
                        ),
                    });

                    if (!client) {
                        throw new NotFoundError("Client not found.");
                    }

                    /*
                     * Verify contract belongs to workspace.
                     */
                    if (body.contract_id) {
                        const contract = await tx.query.contracts.findFirst({
                            where: and(
                                eq(contracts.id, body.contract_id),
                                eq(contracts.workspaceId, workspaceId),
                            ),
                        });

                        if (!contract) {
                            throw new NotFoundError("Contract not found.");
                        }
                    }

                    const amount = total(body.items);

                    const currency = body.currency.toUpperCase();

                    /*
                     * Create invoice.
                     */
                    const [invoice] = await tx
                        .insert(invoices)
                        .values({
                            workspaceId,

                            clientId: body.client_id,

                            contractId: body.contract_id,

                            invoiceNumber: body.invoice_number,

                            reference: body.reference,

                            currency,

                            amount,

                            dueAt: body.due_at,

                            status: "draft",

                            providerPayload: body.paypal_payload,
                        })
                        .returning();

                    /*
                     * Create invoice items.
                     */
                    for (const item of body.items) {
                        await tx.insert(invoiceItems).values({
                            invoiceId: invoice.id,

                            description: item.description,

                            quantity: item.quantity,

                            unitAmount: item.unit_amount,

                            amount: multiplyMoney(
                                item.quantity,
                                item.unit_amount,
                            ),
                        });
                    }

                    /*
                     * Create outbox event.
                     */
                    await enqueueOutbox(tx, {
                        workspaceId,

                        topic: "invoice.created",

                        aggregateType: "invoice",

                        aggregateId: invoice.id,

                        payload: {
                            invoiceId: invoice.id,
                        },
                    });

                    /*
                     * Write audit record.
                     */
                    await writeAudit(
                        {
                            workspaceId,

                            actorType: "user",

                            actorId: request.auth!.userId,

                            action: "invoice.created",

                            resourceType: "invoice",

                            resourceId: invoice.id,

                            requestId: request.id,

                            after: invoice,
                        },
                        tx,
                    );

                    return {
                        invoice,
                        items: body.items,
                    };
                });

                /*
                 * The database transaction has successfully committed.
                 *
                 * Now mark the idempotency request as COMPLETED.
                 *
                 * If the process dies between these two operations,
                 * the 5-minute PROCESSING lease allows a safe retry.
                 */
                if (idempotencyId) {
                    await completeIdempotency(idempotencyId, result);
                }

                return reply.code(201).send(result);
            } catch (error) {
                /*
                 * The invoice transaction failed.
                 *
                 * Remove the PROCESSING claim so the client
                 * can retry immediately.
                 *
                 * If the entire process crashes instead,
                 * the 5-minute lease handles recovery.
                 */
                if (idempotencyId) {
                    try {
                        await releaseIdempotency(idempotencyId);
                    } catch (releaseError) {
                        request.log.error(
                            {
                                err: releaseError,
                                idempotencyId,
                            },
                            "Failed to release idempotency claim",
                        );
                    }
                }

                throw error;
            }
        },
    );

    /*
     * Send invoice through PayPal.
     */
    /*
     * Send invoice through PayPal.
     *
     * If the local invoice does not have a PayPal invoice yet,
     * create one from the Settle invoice source of truth first.
     */
    app.post(
        "/v1/invoices/:id/send",
        {
            preHandler: requireRole("owner", "admin"),
        },
        async (request) => {
            const { id } = z
                .object({
                    id: z.uuid(),
                })
                .parse(request.params);

            const workspaceId = request.auth!.workspaceId!;

            const invoice = await db.query.invoices.findFirst({
                where: and(
                    eq(invoices.id, id),
                    eq(invoices.workspaceId, workspaceId),
                ),
            });

            if (!invoice) {
                throw new NotFoundError("Invoice not found.");
            }

            if (!transitions[invoice.status]?.includes("sent")) {
                throw new ValidationError(
                    `Invoice cannot transition from ${invoice.status} to sent.`,
                );
            }

            /*
             * Load the client because PayPal needs the recipient's
             * email address.
             */
            if (!invoice.clientId) {
                throw new ValidationError(
                    "Invoice does not have a client assigned.",
                );
            }

            const client = await db.query.clients.findFirst({
                where: and(
                    eq(clients.id, invoice.clientId),
                    eq(clients.workspaceId, workspaceId),
                ),
            });

            if (!client) {
                throw new NotFoundError("Invoice client not found.");
            }

            if (!client.email) {
                throw new ValidationError(
                    "Invoice client does not have an email address.",
                );
            }

            /*
             * Load invoice line items from our source of truth.
             */
            const items = await db.query.invoiceItems.findMany({
                where: eq(invoiceItems.invoiceId, invoice.id),
            });

            if (items.length === 0) {
                throw new ValidationError("Invoice has no line items.");
            }

            /*
             * If we already have a PayPal invoice ID locally,
             * never create another PayPal invoice.
             */
            let providerInvoiceId: string | null = invoice.providerInvoiceId;

            let providerPayload: unknown = invoice.rawPayload;

            /*
             * Create/reconcile the PayPal invoice if we don't
             * already have a provider invoice ID.
             */
            if (!providerInvoiceId) {
                /*
                 * Prefer an explicitly supplied PayPal payload when
                 * one was stored during invoice creation.
                 *
                 * Otherwise construct the payload from the local
                 * Settle invoice source of truth.
                 */
                const suppliedPayload =
                    invoice.providerPayload &&
                    typeof invoice.providerPayload === "object" &&
                    !Array.isArray(invoice.providerPayload)
                        ? (invoice.providerPayload as Record<string, unknown>)
                        : null;

                const paypalPayload: Record<string, unknown> =
                    suppliedPayload ?? {
                        detail: {
                            invoice_number:
                                invoice.invoiceNumber ??
                                invoice.reference ??
                                `SETTLE-${invoice.id.slice(0, 8)}`,

                            reference: invoice.reference ?? undefined,

                            currency_code: invoice.currency.toUpperCase(),

                            payment_term: invoice.dueAt
                                ? {
                                      term_type: "DUE_ON_DATE_SPECIFIED",

                                      due_date: invoice.dueAt
                                          .toISOString()
                                          .slice(0, 10),
                                  }
                                : {
                                      term_type: "DUE_ON_RECEIPT",
                                  },
                        },

                        primary_recipients: [
                            {
                                billing_info: {
                                    email_address: client.email,

                                    name: {
                                        full_name: client.name,
                                    },

                                    ...(client.companyName
                                        ? {
                                              business_name: client.companyName,
                                          }
                                        : {}),
                                },
                            },
                        ],

                        items: items.map((item) => ({
                            name: item.description,

                            quantity: item.quantity,

                            unit_amount: {
                                currency_code: invoice.currency.toUpperCase(),

                                value: item.unitAmount,
                            },
                        })),
                    };

                let provider: unknown = null;

                try {
                    /*
                     * PayPal-Request-Id makes this create operation
                     * idempotent on the provider side.
                     */
                    provider = await paypalInvoices.create(
                        paypalPayload,
                        `settle-invoice-${invoice.id}`,
                    );

                    const providerRecord = provider as Record<string, unknown>;

                    providerInvoiceId =
                        typeof providerRecord.id === "string"
                            ? providerRecord.id
                            : null;

                    /*
                     * PayPal's successful create response can contain
                     * only:
                     *
                     * {
                     *   rel: "self",
                     *   href: ".../invoices/INV-...",
                     *   method: "GET"
                     * }
                     *
                     * The adapter now normalizes that response and
                     * exposes `id`, so this is primarily a safety net.
                     */
                    if (!providerInvoiceId) {
                        const existing = await findExistingPayPalInvoice({
                            reference: invoice.reference ?? undefined,

                            amount: invoice.amount,

                            currency: invoice.currency,
                        });

                        if (existing && typeof existing.id === "string") {
                            provider = existing;
                            providerInvoiceId = existing.id;
                        }
                    }
                } catch (error) {
                    /*
                     * A provider request can fail after PayPal has
                     * actually created the invoice.
                     *
                     * Reconcile before returning an error so that
                     * retries do not create duplicate invoices.
                     */
                    if (!(error instanceof ExternalServiceError)) {
                        throw error;
                    }

                    const existing = await findExistingPayPalInvoice({
                        reference: invoice.reference ?? undefined,

                        amount: invoice.amount,

                        currency: invoice.currency,
                    });

                    if (!existing || typeof existing.id !== "string") {
                        throw error;
                    }

                    provider = existing;
                    providerInvoiceId = existing.id;
                }

                /*
                 * At this point PayPal must have given us an invoice ID
                 * either directly or through reconciliation.
                 */
                if (!providerInvoiceId) {
                    throw new ValidationError(
                        "PayPal invoice could not be created or reconciled.",
                    );
                }

                /*
                 * TypeScript now knows this is definitely a string.
                 */
                const resolvedProviderInvoiceId = providerInvoiceId;

                providerPayload = provider;

                /*
                 * Persist the provider invoice immediately.
                 *
                 * If the subsequent send request fails, a retry will
                 * reuse this PayPal invoice instead of creating another.
                 */
                await db
                    .update(invoices)
                    .set({
                        providerInvoiceId: resolvedProviderInvoiceId,

                        rawPayload: provider,

                        updatedAt: new Date(),
                    })
                    .where(eq(invoices.id, invoice.id));

                /*
                 * Keep the narrowed value for the send operation.
                 */
                providerInvoiceId = resolvedProviderInvoiceId;
            }

            /*
             * Final invariant:
             * providerInvoiceId must exist before we call PayPal.
             */
            if (!providerInvoiceId) {
                throw new ValidationError("PayPal invoice ID is missing.");
            }

            /*
             * Send the already-created PayPal invoice.
             */
            const sendResponse = await paypalInvoices.send(
                providerInvoiceId,
                request.body as Record<string, unknown>,
            );

            const combinedPayload = {
                create: providerPayload,
                send: sendResponse,
            };

            const [updated] = await db
                .update(invoices)
                .set({
                    status: "sent",

                    sentAt: new Date(),

                    rawPayload: combinedPayload,

                    updatedAt: new Date(),
                })
                .where(eq(invoices.id, id))
                .returning();

            await writeAudit({
                workspaceId,

                actorType: "user",

                actorId: request.auth!.userId,

                action: "invoice.sent",

                resourceType: "invoice",

                resourceId: id,

                requestId: request.id,

                after: updated,
            });

            return updated;
        },
    );

    /*
     * Send PayPal reminder.
     */
    app.post(
        "/v1/invoices/:id/remind",
        {
            preHandler: requireRole("owner", "admin"),
        },
        async (request) => {
            const { id } = z
                .object({
                    id: z.uuid(),
                })
                .parse(request.params);

            const invoice = await db.query.invoices.findFirst({
                where: and(
                    eq(invoices.id, id),
                    eq(invoices.workspaceId, request.auth!.workspaceId!),
                ),
            });

            if (!invoice?.providerInvoiceId) {
                throw new NotFoundError(
                    "Invoice or provider invoice not found.",
                );
            }

            if (invoice.status !== "sent") {
                throw new ValidationError(
                    "Reminders can only be sent for sent invoices.",
                );
            }

            await paypalInvoices.remind(
                invoice.providerInvoiceId,
                request.body as Record<string, unknown>,
            );

            await writeAudit({
                workspaceId: request.auth!.workspaceId,

                actorType: "user",

                actorId: request.auth!.userId,

                action: "invoice.reminder_sent",

                resourceType: "invoice",

                resourceId: id,

                requestId: request.id,
            });

            return {
                success: true,
            };
        },
    );

    /*
     * Manually transition invoice status.
     */
    app.post(
        "/v1/invoices/:id/status",
        {
            preHandler: requireRole("owner", "admin"),
        },
        async (request) => {
            const { id } = z
                .object({
                    id: z.uuid(),
                })
                .parse(request.params);

            const body = transitionSchema.parse(request.body);

            const existing = await db.query.invoices.findFirst({
                where: and(
                    eq(invoices.id, id),
                    eq(invoices.workspaceId, request.auth!.workspaceId!),
                ),
            });

            if (!existing) {
                throw new NotFoundError("Invoice not found.");
            }

            if (body.status === existing.status) {
                return existing;
            }

            if (["paid", "refunded"].includes(body.status)) {
                throw new ValidationError(
                    "Paid and refunded invoice states are provider-driven and cannot be set manually.",
                );
            }

            if (!transitions[existing.status]?.includes(body.status)) {
                throw new ValidationError(
                    `Invoice cannot transition from ${existing.status} to ${body.status}.`,
                );
            }

            const now = new Date();

            const [updated] = await db
                .update(invoices)
                .set({
                    status: body.status,

                    paidAt: body.status === "paid" ? now : existing.paidAt,

                    updatedAt: now,
                })
                .where(eq(invoices.id, id))
                .returning();

            await writeAudit({
                workspaceId: request.auth!.workspaceId,

                actorType: "user",

                actorId: request.auth!.userId,

                action: `invoice.${body.status}`,

                resourceType: "invoice",

                resourceId: id,

                requestId: request.id,

                before: existing,

                after: updated,
            });

            return updated;
        },
    );

    /*
     * Cancel invoice.
     */
    app.post(
        "/v1/invoices/:id/cancel",
        {
            preHandler: requireRole("owner", "admin"),
        },
        async (request) => {
            const { id } = z
                .object({
                    id: z.uuid(),
                })
                .parse(request.params);

            const invoice = await db.query.invoices.findFirst({
                where: and(
                    eq(invoices.id, id),
                    eq(invoices.workspaceId, request.auth!.workspaceId!),
                ),
            });

            if (!invoice) {
                throw new NotFoundError("Invoice not found.");
            }

            if (!transitions[invoice.status]?.includes("cancelled")) {
                throw new ValidationError(
                    `Invoice cannot be cancelled from ${invoice.status}.`,
                );
            }

            if (invoice.providerInvoiceId) {
                await paypalInvoices.cancel(
                    invoice.providerInvoiceId,
                    request.body as Record<string, unknown>,
                );
            }

            const [updated] = await db
                .update(invoices)
                .set({
                    status: "cancelled",
                    updatedAt: new Date(),
                })
                .where(eq(invoices.id, id))
                .returning();

            await writeAudit({
                workspaceId: request.auth!.workspaceId,

                actorType: "user",

                actorId: request.auth!.userId,

                action: "invoice.cancelled",

                resourceType: "invoice",

                resourceId: id,

                requestId: request.id,

                before: invoice,

                after: updated,
            });

            return updated;
        },
    );
}

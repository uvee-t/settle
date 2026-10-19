import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { invoices } from "../../db/schema/invoices.js";
import { payments } from "../../db/schema/core.js";
import {
    disputeEvidenceRequests,
    disputeEvidenceSubmissions,
} from "../../db/schema/evidence.js";
import {
    paypalDisputes,
    type PayPalDispute,
} from "../paypal/paypal.disputes.js";
import { aiQueue } from "../../lib/queue.js";
import { withRedisLock } from "../../lib/distributed-lock.js";

function mapDispute(
    payload: PayPalDispute,
    workspaceId?: string,
    links?: { paymentId?: string; invoiceId?: string },
) {
    const amount = payload.dispute_amount;
    const transaction = payload.disputed_transactions?.[0];

    const sellerProtectionEligibleRaw =
        transaction?.seller_protection_eligible ??
        payload.seller_protection_eligible;

    const sellerProtectionEligible =
        typeof sellerProtectionEligibleRaw === "boolean"
            ? sellerProtectionEligibleRaw
            : undefined;

    const sellerProtectionTypeRaw =
        transaction?.seller_protection_type ?? payload.seller_protection_type;

    const sellerProtectionType =
        typeof sellerProtectionTypeRaw === "string"
            ? sellerProtectionTypeRaw
            : undefined;

    const responseDueDateRaw =
        payload.seller_response_due_date ?? payload.buyer_response_due_date;

    const responseDueDate =
        typeof responseDueDateRaw === "string" ? responseDueDateRaw : undefined;

    return {
        workspaceId,
        provider: "paypal",
        providerDisputeId: payload.dispute_id,
        providerTransactionId:
            typeof transaction?.seller_transaction_id === "string"
                ? transaction.seller_transaction_id
                : undefined,
        paymentId: links?.paymentId,
        invoiceId: links?.invoiceId,
        reason: payload.reason,
        status: payload.status,
        disputeState: payload.dispute_state,
        lifecycleStage: payload.dispute_life_cycle_stage,
        channel: payload.dispute_channel,
        amount: amount?.value,
        currency: amount?.currency_code,

        sellerResponseDueAt: responseDueDate
            ? new Date(responseDueDate)
            : undefined,

        sellerProtectionEligible:
            sellerProtectionEligible === undefined
                ? undefined
                : String(sellerProtectionEligible),

        sellerProtectionType,

        rawPayload: payload,
        updatedAt: new Date(),
        resolvedAt: ["RESOLVED", "CLOSED"].includes(payload.status ?? "")
            ? new Date()
            : undefined,
    };
}

function containsExactString(value: unknown, target: string): boolean {
    if (value === target) return true;
    if (Array.isArray(value))
        return value.some((item) => containsExactString(item, target));
    if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).some((item) =>
            containsExactString(item, target),
        );
    }
    return false;
}

export async function syncDispute(
    providerDisputeId: string,
    workspaceId?: string,
) {
    const payload = await paypalDisputes.get(providerDisputeId);
    const existing = await db.query.disputes.findFirst({
        where: eq(disputes.providerDisputeId, providerDisputeId),
    });

    const providerTransactionId =
        typeof payload.disputed_transactions?.[0]?.seller_transaction_id ===
        "string"
            ? payload.disputed_transactions[0].seller_transaction_id
            : undefined;

    let inferredWorkspaceId = existing?.workspaceId ?? undefined;
    let linkedPaymentId = existing?.paymentId ?? undefined;
    let linkedInvoiceId = existing?.invoiceId ?? undefined;

    if (providerTransactionId) {
        const directPayment = await db.query.payments.findFirst({
            where: eq(payments.providerPaymentId, providerTransactionId),
        });

        if (directPayment) {
            linkedPaymentId = directPayment.id;
            linkedInvoiceId = directPayment.invoiceId ?? undefined;
            inferredWorkspaceId = directPayment.workspaceId;
        } else {
            // PayPal can expose a seller transaction identifier that differs from
            // the payment/capture identifier stored by an INVOICING.INVOICE.PAID
            // webhook. Only accept an exact identifier found inside our durable
            // provider payloads; never fuzzy-match on amount, currency, or dates.
            const paymentRows = await db.query.payments.findMany({
                where: workspaceId
                    ? eq(payments.workspaceId, workspaceId)
                    : undefined,
            });
            const payloadPayment = paymentRows.find((payment) =>
                containsExactString(payment.rawPayload, providerTransactionId),
            );

            if (payloadPayment) {
                linkedPaymentId = payloadPayment.id;
                linkedInvoiceId = payloadPayment.invoiceId ?? undefined;
                inferredWorkspaceId = payloadPayment.workspaceId;
            }
        }

        if (!linkedInvoiceId) {
            const invoiceRows = await db.query.invoices.findMany({
                where: workspaceId
                    ? eq(invoices.workspaceId, workspaceId)
                    : undefined,
            });
            const payloadInvoice = invoiceRows.find(
                (invoice) =>
                    containsExactString(
                        invoice.rawPayload,
                        providerTransactionId,
                    ) ||
                    containsExactString(
                        invoice.providerPayload,
                        providerTransactionId,
                    ),
            );

            if (payloadInvoice) {
                linkedInvoiceId = payloadInvoice.id;
                inferredWorkspaceId =
                    inferredWorkspaceId ??
                    payloadInvoice.workspaceId ??
                    undefined;
            }
        }
    }

    const effectiveWorkspaceId =
        workspaceId ?? inferredWorkspaceId ?? undefined;
    const values = mapDispute(payload, effectiveWorkspaceId, {
        paymentId: linkedPaymentId,
        invoiceId: linkedInvoiceId,
    });

    const [row] = await db
        .insert(disputes)
        .values(values)
        .onConflictDoUpdate({
            target: disputes.providerDisputeId,
            set: values,
        })
        .returning();

    for (const evidence of payload.evidences ?? []) {
        const evidenceType = String(
            evidence.evidence_type ?? evidence.type ?? "UNKNOWN",
        );
        await db
            .insert(disputeEvidenceRequests)
            .values({
                disputeId: row.id,
                providerEvidenceType: evidenceType,
                source: String(evidence.source ?? ""),
                required: String(evidence.required ?? true),
                status: String(evidence.status ?? "PENDING"),
                metadata: evidence,
                dueAt: payload.seller_response_due_date
                    ? new Date(payload.seller_response_due_date)
                    : undefined,
            })
            .onConflictDoUpdate({
                target: [
                    disputeEvidenceRequests.disputeId,
                    disputeEvidenceRequests.providerEvidenceType,
                ],
                set: {
                    source: String(evidence.source ?? ""),
                    required: String(evidence.required ?? true),
                    status: String(evidence.status ?? "PENDING"),
                    metadata: evidence,
                    dueAt: payload.seller_response_due_date
                        ? new Date(payload.seller_response_due_date)
                        : undefined,
                    updatedAt: new Date(),
                },
            });
    }

    if (row.workspaceId) {
        const fingerprint = createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex")
            .slice(0, 20);
        await aiQueue.add(
            "dispute.analyze",
            { disputeId: row.id, workspaceId: row.workspaceId },
            { jobId: `dispute-ai-${row.id}-${fingerprint}` },
        );
    }

    return row;
}

export async function submitEvidence(input: {
    disputeId: string;
    providerDisputeId: string;
    evidenceType: string;
    evidenceRequestId?: string;
    notes?: string;
}) {
    return withRedisLock(
        `settle:paypal:evidence:${input.disputeId}:${input.evidenceType}`,
        async () => {
            let submission =
                await db.query.disputeEvidenceSubmissions.findFirst({
                    where: and(
                        eq(
                            disputeEvidenceSubmissions.disputeId,
                            input.disputeId,
                        ),
                        eq(
                            disputeEvidenceSubmissions.evidenceType,
                            input.evidenceType,
                        ),
                    ),
                });

            if (submission?.status === "SUBMITTED") {
                if (
                    !submission.evidenceRequestId &&
                    input.evidenceRequestId
                ) {
                    const [updated] = await db
                        .update(disputeEvidenceSubmissions)
                        .set({ evidenceRequestId: input.evidenceRequestId })
                        .where(
                            eq(
                                disputeEvidenceSubmissions.id,
                                submission.id,
                            ),
                        )
                        .returning();
                    return updated;
                }

                return submission;
            }

            if (!submission) {
                const [created] = await db
                    .insert(disputeEvidenceSubmissions)
                    .values({
                        disputeId: input.disputeId,
                        evidenceRequestId: input.evidenceRequestId,
                        evidenceType: input.evidenceType,
                        notes: input.notes,
                        status: "PENDING",
                    })
                    .returning();
                submission = created;
            } else if (
                input.evidenceRequestId &&
                !submission.evidenceRequestId
            ) {
                const [updated] = await db
                    .update(disputeEvidenceSubmissions)
                    .set({
                        evidenceRequestId: input.evidenceRequestId,
                        notes: input.notes ?? submission.notes,
                    })
                    .where(
                        eq(
                            disputeEvidenceSubmissions.id,
                            submission.id,
                        ),
                    )
                    .returning();
                submission = updated;
            }

            const [submitting] = await db
                .update(disputeEvidenceSubmissions)
                .set({
                    status: "SUBMITTING",
                    notes: input.notes ?? submission.notes,
                })
                .where(
                    eq(
                        disputeEvidenceSubmissions.id,
                        submission.id,
                    ),
                )
                .returning();
            submission = submitting;

            // Recover safely if a previous process reached PayPal but crashed
            // before persisting the successful local submission. PayPal's
            // dispute representation is the external source of truth here.
            const providerDispute = await paypalDisputes.get(
                input.providerDisputeId,
            );
            const existingProviderEvidence = (providerDispute.evidences ?? []).find(
                (evidence) =>
                    String(
                        evidence.evidence_type ?? evidence.type ?? "",
                    ) === input.evidenceType &&
                    String(evidence.source ?? "") === "SUBMITTED_BY_SELLER",
            );

            if (existingProviderEvidence) {
                const [updated] = await db
                    .update(disputeEvidenceSubmissions)
                    .set({
                        status: "SUBMITTED",
                        providerResponse: existingProviderEvidence,
                        submittedAt:
                            typeof existingProviderEvidence.date === "string"
                                ? new Date(existingProviderEvidence.date)
                                : new Date(),
                    })
                    .where(
                        eq(
                            disputeEvidenceSubmissions.id,
                            submission.id,
                        ),
                    )
                    .returning();

                await db
                    .update(disputes)
                    .set({ updatedAt: new Date() })
                    .where(eq(disputes.id, input.disputeId));

                return updated;
            }

            const result = await paypalDisputes.provideEvidence(
                input.providerDisputeId,
                {
                    evidence_type: input.evidenceType,
                    notes: input.notes,
                },
            );

            const [updated] = await db
                .update(disputeEvidenceSubmissions)
                .set({
                    status: "SUBMITTED",
                    providerResponse: result,
                    submittedAt: new Date(),
                })
                .where(
                    eq(
                        disputeEvidenceSubmissions.id,
                        submission.id,
                    ),
                )
                .returning();

            await db
                .update(disputes)
                .set({ updatedAt: new Date() })
                .where(eq(disputes.id, input.disputeId));

            return updated;
        },
        { ttlMs: 90_000, waitMs: 10_000 },
    );
}


import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import {
    contracts,
    contractVersions,
    documents,
    milestones,
    payments,
} from "../../db/schema/core.js";
import { milestoneInvoices } from "../../db/schema/billing.js";
import {
    milestoneDeliveries,
    milestoneDeliveryDocuments,
} from "../../db/schema/deliveries.js";
import { invoices } from "../../db/schema/invoices.js";
import { communications } from "../../db/schema/communications.js";
import {
    evidenceFacts,
    evidencePackItems,
    evidencePacks,
} from "../../db/schema/ai.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { generateDisputeDefense } from "../ai/ai.service.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";

const DEFAULT_REQUIREMENTS: Record<string, string[]> = {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: [
        "PROOF_OF_FULFILLMENT",
        "PROOF_OF_DELIVERY",
        "COMMUNICATION",
    ],
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: [
        "PROOF_OF_FULFILLMENT",
        "COMMUNICATION",
        "CONTRACT",
    ],
    DUPLICATE_TRANSACTION: ["TRANSACTION_RECEIPT", "COMMUNICATION"],
    CREDIT_NOT_PROCESSED: ["REFUND_DOCUMENTATION", "COMMUNICATION"],
    CANCELED_RECURRING_BILLING: ["CONTRACT", "COMMUNICATION"],
    UNKNOWN: ["CONTRACT", "INVOICE", "PAYMENT", "COMMUNICATION"],
};

function evidenceTypeForSource(sourceType: string) {
    if (sourceType === "document") return "DOCUMENT";
    if (sourceType === "communication") return "COMMUNICATION";
    if (sourceType === "milestone") return "PROOF_OF_FULFILLMENT";
    if (sourceType === "contract") return "CONTRACT";
    if (sourceType === "invoice") return "INVOICE";
    if (sourceType === "payment") return "TRANSACTION_RECEIPT";
    return "OTHER";
}

export async function collectEvidenceCandidates(
    disputeId: string,
    workspaceId: string,
) {
    const dispute = await db.query.disputes.findFirst({
        where: and(
            eq(disputes.id, disputeId),
            eq(disputes.workspaceId, workspaceId),
        ),
    });
    if (!dispute) throw new NotFoundError("Dispute not found.");
    const payment = dispute.paymentId
        ? await db.query.payments.findFirst({
              where: and(
                  eq(payments.workspaceId, workspaceId),
                  eq(payments.id, dispute.paymentId),
              ),
          })
        : dispute.providerTransactionId
          ? await db.query.payments.findFirst({
                where: and(
                    eq(payments.workspaceId, workspaceId),
                    eq(
                        payments.providerPaymentId,
                        dispute.providerTransactionId,
                    ),
                ),
            })
          : undefined;
    const relatedInvoices = dispute.invoiceId
        ? await db.query.invoices.findMany({
              where: and(
                  eq(invoices.workspaceId, workspaceId),
                  eq(invoices.id, dispute.invoiceId),
              ),
          })
        : payment?.invoiceId
          ? await db.query.invoices.findMany({
                where: and(
                    eq(invoices.workspaceId, workspaceId),
                    eq(invoices.id, payment.invoiceId),
                ),
            })
          : [];
    const contractIds = new Set(
        relatedInvoices
            .map((i) => i.contractId)
            .filter((x): x is string => Boolean(x)),
    );
    const relatedContracts = contractIds.size
        ? await db.query.contracts.findMany({
              where: eq(contracts.workspaceId, workspaceId),
          })
        : [];
    const scopedContracts = relatedContracts.filter((c) =>
        contractIds.has(c.id),
    );
    const linkedMilestoneRows = relatedInvoices.length
        ? await db.query.milestoneInvoices.findMany({
              where: inArray(
                  milestoneInvoices.invoiceId,
                  relatedInvoices.map((invoice) => invoice.id),
              ),
          })
        : [];

    const linkedMilestoneIds = new Set(
        linkedMilestoneRows.map((row) => row.milestoneId),
    );

    const scopedMilestones = linkedMilestoneIds.size
        ? (await db.query.milestones.findMany()).filter((milestone) =>
              linkedMilestoneIds.has(milestone.id),
          )
        : [];
    const communicationsRows = await db.query.communications.findMany({
        where: eq(communications.workspaceId, workspaceId),
        orderBy: [desc(communications.occurredAt)],
    });
    const relatedCommunications = communicationsRows.filter(
        (c) =>
            c.disputeId === dispute.id ||
            relatedInvoices.some((i) => c.invoiceId === i.id) ||
            scopedContracts.some((contract) => contract.id === c.contractId),
    );
    const versions = scopedContracts.length
        ? (await db.query.contractVersions.findMany()).filter((v) =>
              contractIds.has(v.contractId),
          )
        : [];
    const documentIds = new Set(
        versions
            .map((v) => v.documentId)
            .filter((x): x is string => Boolean(x)),
    );
    const docs = documentIds.size
        ? (
              await db.query.documents.findMany({
                  where: eq(documents.workspaceId, workspaceId),
              })
          ).filter(
              (d) =>
                  documentIds.has(d.id) && d.verificationStatus === "verified",
          )
        : [];
    const facts = docs.length
        ? await db.query.evidenceFacts.findMany({
              where: eq(evidenceFacts.workspaceId, workspaceId),
          })
        : [];
    const scopedFacts = facts.filter(
        (f) =>
            f.sourceType === "document" &&
            docs.some((d) => d.id === f.sourceId),
    );

    const deliveryRows = scopedMilestones.length
        ? await db.query.milestoneDeliveries.findMany({
              where: and(
                  eq(milestoneDeliveries.workspaceId, workspaceId),
                  inArray(
                      milestoneDeliveries.milestoneId,
                      scopedMilestones.map((m) => m.id),
                  ),
              ),
          })
        : [];

    const deliveryLinks = deliveryRows.length
        ? await db.query.milestoneDeliveryDocuments.findMany({
              where: inArray(
                  milestoneDeliveryDocuments.deliveryId,
                  deliveryRows.map((d) => d.id),
              ),
          })
        : [];

    const deliveryDocumentIds = new Set(
        deliveryLinks.map((link) => link.documentId),
    );
    const deliveryDocuments = deliveryDocumentIds.size
        ? (
              await db.query.documents.findMany({
                  where: eq(documents.workspaceId, workspaceId),
              })
          ).filter(
              (d) =>
                  deliveryDocumentIds.has(d.id) &&
                  d.verificationStatus === "verified",
          )
        : [];

    return {
        dispute,
        payment,
        invoices: relatedInvoices,
        contracts: scopedContracts,
        milestones: scopedMilestones,
        communications: relatedCommunications,
        documents: docs,
        facts: scopedFacts,
        deliveries: deliveryRows,
        deliveryDocuments,
    };
}

export async function generateEvidencePack(
    disputeId: string,
    workspaceId: string,
) {
    const collected = await collectEvidenceCandidates(disputeId, workspaceId);
    const providerRequirements =
        await db.query.disputeEvidenceRequests.findMany({
            where: eq(disputeEvidenceRequests.disputeId, disputeId),
        });
    const required = providerRequirements.length
        ? providerRequirements.map((r) => r.providerEvidenceType)
        : (DEFAULT_REQUIREMENTS[collected.dispute.reason ?? "UNKNOWN"] ??
          DEFAULT_REQUIREMENTS.UNKNOWN);

    const candidates: Array<{
        evidenceType: string;
        sourceType: string;
        sourceId: string;
        claim: string;
        confidence: string;
        metadata?: unknown;
    }> = [];
    for (const invoice of collected.invoices)
        candidates.push({
            evidenceType: "INVOICE",
            sourceType: "invoice",
            sourceId: invoice.id,
            claim: `Invoice ${invoice.invoiceNumber ?? invoice.id} records ${invoice.amount} ${invoice.currency}.`,
            confidence: "0.90",
        });
    if (collected.payment)
        candidates.push({
            evidenceType: "TRANSACTION_RECEIPT",
            sourceType: "payment",
            sourceId: collected.payment.id,
            claim: `Payment records ${collected.payment.amount} ${collected.payment.currency} with provider transaction ${collected.payment.providerPaymentId ?? "unknown"}.`,
            confidence: "0.98",
        });
    for (const contract of collected.contracts)
        candidates.push({
            evidenceType: "CONTRACT",
            sourceType: "contract",
            sourceId: contract.id,
            claim: `Contract ${contract.title} establishes the commercial relationship and agreed scope.`,
            confidence: "0.90",
        });
    for (const milestone of collected.milestones)
        if (milestone.status === "completed")
            candidates.push({
                evidenceType: "PROOF_OF_FULFILLMENT",
                sourceType: "milestone",
                sourceId: milestone.id,
                claim: `Milestone ${milestone.name} is recorded as completed${milestone.completedAt ? ` on ${milestone.completedAt.toISOString()}` : ""}.`,
                confidence: "0.95",
            });
    for (const delivery of collected.deliveries) {
        if (delivery.status !== "ACCEPTED") continue;
        const deliveryConfidence = "0.99";
        const timing = delivery.acceptedAt
            ? ` and accepted on ${delivery.acceptedAt.toISOString()}`
            : delivery.rejectedAt
              ? ` and rejected on ${delivery.rejectedAt.toISOString()}`
              : "";
        candidates.push({
            evidenceType: "PROOF_OF_FULFILLMENT",
            sourceType: "milestone_delivery",
            sourceId: delivery.id,
            claim: `Delivery "${delivery.title}" for milestone ${delivery.milestoneId} is ${delivery.status.toLowerCase()}${timing}.${delivery.description ? ` Description: ${delivery.description.slice(0, 1500)}` : ""}`,
            confidence: deliveryConfidence,
            metadata: {
                milestone_id: delivery.milestoneId,
                status: delivery.status,
            },
        });
    }
    for (const document of collected.deliveryDocuments) {
        candidates.push({
            evidenceType: "PROOF_OF_DELIVERY",
            sourceType: "delivery_document",
            sourceId: document.id,
            claim: `Verified delivery document ${document.filename} is attached to a milestone delivery and available as supporting evidence.`,
            confidence: "0.98",
            metadata: {
                content_type: document.contentType,
                sha256: document.sha256,
            },
        });
    }
    for (const communication of collected.communications.slice(0, 20)) {
        const body = communication.body
            ? communication.body.slice(0, 2000)
            : "";
        candidates.push({
            evidenceType: "COMMUNICATION",
            sourceType: "communication",
            sourceId: communication.id,
            claim: `${communication.channel} communication${communication.subject ? `: ${communication.subject}` : ""} occurred on ${communication.occurredAt.toISOString()}.${body ? ` Content: ${body}` : ""}`,
            confidence: "0.75",
        });
    }
    for (const doc of collected.documents)
        candidates.push({
            evidenceType: evidenceTypeForSource("document"),
            sourceType: "document",
            sourceId: doc.id,
            claim: `Verified document ${doc.filename} is available as supporting evidence.`,
            confidence: "0.95",
            metadata: { content_type: doc.contentType, sha256: doc.sha256 },
        });
    for (const fact of collected.facts)
        candidates.push({
            evidenceType: "AI_FACT",
            sourceType: fact.sourceType,
            sourceId: fact.sourceId,
            claim: `${fact.factType}: ${JSON.stringify(fact.value)}${fact.sourceExcerpt ? ` (source: ${fact.sourceExcerpt})` : ""}`,
            confidence: fact.confidence ?? "0.50",
        });

    const [pack] = await db
        .insert(evidencePacks)
        .values({
            workspaceId,
            disputeId,
            status: "DRAFT",
            strengthScore: "0",
            analysis: {
                required_evidence: required,
                generated_at: new Date().toISOString(),
            },
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: evidencePacks.disputeId,
            set: {
                status: "DRAFT",
                updatedAt: new Date(),
                analysis: {
                    required_evidence: required,
                    generated_at: new Date().toISOString(),
                },
            },
        })
        .returning();
    await db
        .delete(evidencePackItems)
        .where(eq(evidencePackItems.evidencePackId, pack.id));
    const selected = candidates
        .filter((c) =>
            required.some(
                (r) =>
                    c.evidenceType === r ||
                    (r === "PROOF_OF_DELIVERY" &&
                        ["PROOF_OF_FULFILLMENT", "DOCUMENT"].includes(
                            c.evidenceType,
                        )) ||
                    (r === "COMMUNICATION" &&
                        c.evidenceType === "COMMUNICATION"),
            ),
        )
        .slice(0, 50);
    if (selected.length)
        await db.insert(evidencePackItems).values(
            selected.map((c) => ({
                evidencePackId: pack.id,
                evidenceType: c.evidenceType,
                sourceType: c.sourceType,
                sourceId: c.sourceId,
                claim: c.claim,
                confidence: c.confidence,
                selected: "true",
                metadata: c.metadata,
            })),
        );
    const missing = required.filter(
        (r) =>
            !selected.some(
                (c) =>
                    c.evidenceType === r ||
                    (r === "PROOF_OF_DELIVERY" &&
                        ["PROOF_OF_FULFILLMENT", "DOCUMENT"].includes(
                            c.evidenceType,
                        )),
            ),
    );
    const strength = Math.round(
        Math.min(
            100,
            selected.reduce((sum, c) => sum + Number(c.confidence) * 20, 0) +
                (missing.length === 0 ? 20 : 0),
        ),
    );
    await db
        .update(evidencePacks)
        .set({
            strengthScore: String(strength),
            analysis: {
                required_evidence: required,
                missing_evidence: missing,
                candidate_count: candidates.length,
            },
            updatedAt: new Date(),
        })
        .where(eq(evidencePacks.id, pack.id));
    return {
        packId: pack.id,
        collected,
        required,
        missing,
        candidates: selected,
        strengthScore: strength,
    };
}

export async function analyzeEvidencePack(packId: string, workspaceId: string) {
    const pack = await db.query.evidencePacks.findFirst({
        where: and(
            eq(evidencePacks.id, packId),
            eq(evidencePacks.workspaceId, workspaceId),
        ),
    });
    if (!pack) throw new NotFoundError("Evidence pack not found.");
    const dispute = await db.query.disputes.findFirst({
        where: and(
            eq(disputes.id, pack.disputeId),
            eq(disputes.workspaceId, workspaceId),
        ),
    });
    if (!dispute) throw new NotFoundError("Dispute not found.");
    const items = await db.query.evidencePackItems.findMany({
        where: eq(evidencePackItems.evidencePackId, pack.id),
    });
    if (!items.length)
        throw new ValidationError("Evidence pack has no evidence items.");
    const ai = await generateDisputeDefense({
        workspaceId,
        dispute: {
            id: dispute.id,
            provider_dispute_id: dispute.providerDisputeId,
            reason: dispute.reason,
            amount: dispute.amount,
            currency: dispute.currency,
            due_at: dispute.sellerResponseDueAt,
        },
        evidence: items.map((i) => ({
            type: i.evidenceType,
            claim: i.claim,
            confidence: i.confidence,
            source_type: i.sourceType,
            source_id: i.sourceId,
        })),
    });
    const [updated] = await db
        .update(evidencePacks)
        .set({
            status: "READY_FOR_REVIEW",
            strengthScore: String(ai.result.strength_score),
            defenseDraft: ai.result.defense_draft,
            analysis: ai.result,
            aiRunId: ai.run.id,
            updatedAt: new Date(),
        })
        .where(eq(evidencePacks.id, pack.id))
        .returning();
    await writeAudit({
        workspaceId,
        actorType: "system",
        action: "evidence_pack.ai_analyzed",
        resourceType: "evidence_pack",
        resourceId: pack.id,
        after: updated,
    });
    return { pack: updated, items };
}

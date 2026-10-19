import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { contracts, milestones, documents, payments } from "../../db/schema/core.js";
import { invoices } from "../../db/schema/invoices.js";
import { communications } from "../../db/schema/communications.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { NotFoundError } from "../../lib/errors.js";

function includesProviderId(value: unknown, providerId: string) {
  return value !== null && value !== undefined && JSON.stringify(value).includes(providerId);
}

export async function buildEvidencePack(disputeId: string, workspaceId: string) {
  const dispute = await db.query.disputes.findFirst({
    where: and(eq(disputes.id, disputeId), eq(disputes.workspaceId, workspaceId)),
  });
  if (!dispute) throw new NotFoundError("Dispute not found.");

  const evidenceRequests = await db.query.disputeEvidenceRequests.findMany({
    where: eq(disputeEvidenceRequests.disputeId, dispute.id),
  });

  const providerTransactionId = dispute.providerTransactionId;
  const allPayments = await db.query.payments.findMany({
    where: eq(payments.workspaceId, workspaceId),
  });
  const relatedPayments = providerTransactionId
    ? allPayments.filter((payment) =>
        payment.providerPaymentId === providerTransactionId || includesProviderId(payment.rawPayload, providerTransactionId),
      )
    : [];

  const allInvoices = await db.query.invoices.findMany({
    where: eq(invoices.workspaceId, workspaceId),
  });
  const relatedInvoiceIds = new Set(
    relatedPayments.map((payment) => payment.invoiceId).filter((id): id is string => Boolean(id)),
  );
  const relatedInvoices = allInvoices.filter((invoice) =>
    relatedInvoiceIds.has(invoice.id) ||
    invoice.providerInvoiceId === providerTransactionId ||
    (providerTransactionId ? includesProviderId(invoice.rawPayload, providerTransactionId) : false),
  );

  const relatedContractIds = new Set(
    relatedInvoices.map((invoice) => invoice.contractId).filter((id): id is string => Boolean(id)),
  );
  const allContracts = await db.query.contracts.findMany({ where: eq(contracts.workspaceId, workspaceId) });
  const relatedContracts = allContracts.filter((contract) => relatedContractIds.has(contract.id));

  const relatedMilestones = relatedContractIds.size
    ? await db.query.milestones.findMany()
    : [];
  const scopedMilestones = relatedMilestones.filter((milestone) => relatedContractIds.has(milestone.contractId));

  const allDocuments = await db.query.documents.findMany({ where: eq(documents.workspaceId, workspaceId) });
  const allCommunications = await db.query.communications.findMany({ where: eq(communications.workspaceId, workspaceId) });

  const relatedCommunications = allCommunications.filter((communication) =>
    relatedInvoices.some((invoice) => communication.invoiceId === invoice.id) ||
    relatedContracts.some((contract) => communication.contractId === contract.id) ||
    communication.disputeId === dispute.id,
  );

  return {
    generated_at: new Date().toISOString(),
    dispute: {
      id: dispute.id,
      provider_dispute_id: dispute.providerDisputeId,
      transaction_id: dispute.providerTransactionId,
      reason: dispute.reason,
      amount: dispute.amount,
      currency: dispute.currency,
      seller_response_due_at: dispute.sellerResponseDueAt,
      seller_protection_eligible: dispute.sellerProtectionEligible,
      seller_protection_type: dispute.sellerProtectionType,
    },
    requirements: evidenceRequests,
    evidence: {
      invoices: relatedInvoices,
      payments: relatedPayments,
      contracts: relatedContracts,
      milestones: scopedMilestones,
      documents: allDocuments,
      communications: relatedCommunications,
    },
    recommendations: evidenceRequests.map((request) => ({
      evidence_type: request.providerEvidenceType,
      status: request.status,
      suggested_sources: [
        "contract",
        "milestone",
        "invoice",
        "payment",
        "communication",
        "document",
      ],
    })),
  };
}

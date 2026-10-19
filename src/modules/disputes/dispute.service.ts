import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { invoices } from "../../db/schema/invoices.js";
import { payments } from "../../db/schema/core.js";
import { disputeEvidenceRequests, disputeEvidenceSubmissions } from "../../db/schema/evidence.js";
import { paypalDisputes, type PayPalDispute } from "../paypal/paypal.disputes.js";

function mapDispute(payload: PayPalDispute, workspaceId?: string) {
  const amount = payload.dispute_amount;
  return {
    workspaceId,
    provider: "paypal",
    providerDisputeId: payload.dispute_id,
    providerTransactionId: typeof payload.disputed_transactions?.[0]?.seller_transaction_id === "string"
      ? payload.disputed_transactions[0].seller_transaction_id
      : undefined,
    reason: payload.reason,
    status: payload.status,
    disputeState: payload.dispute_state,
    lifecycleStage: payload.dispute_life_cycle_stage,
    channel: payload.dispute_channel,
    amount: amount?.value,
    currency: amount?.currency_code,
    sellerResponseDueAt: payload.seller_response_due_date ? new Date(payload.seller_response_due_date) : undefined,
    sellerProtectionEligible: payload.seller_protection_eligible === undefined ? undefined : String(payload.seller_protection_eligible),
    sellerProtectionType: payload.seller_protection_type,
    rawPayload: payload,
    updatedAt: new Date(),
    resolvedAt: ["RESOLVED", "CLOSED"].includes(payload.status ?? "") ? new Date() : undefined,
  };
}

export async function syncDispute(providerDisputeId: string, workspaceId?: string) {
  const payload = await paypalDisputes.get(providerDisputeId);
  const existing = await db.query.disputes.findFirst({
    where: eq(disputes.providerDisputeId, providerDisputeId),
  });

  const providerTransactionId =
    typeof payload.disputed_transactions?.[0]?.seller_transaction_id === "string"
      ? payload.disputed_transactions[0].seller_transaction_id
      : undefined;

  let inferredWorkspaceId = existing?.workspaceId ?? undefined;
  if (!inferredWorkspaceId && providerTransactionId) {
    const payment = await db.query.payments.findFirst({
      where: eq(payments.providerPaymentId, providerTransactionId),
    });
    inferredWorkspaceId = payment?.workspaceId;

    if (!inferredWorkspaceId) {
      const invoice = await db.query.invoices.findFirst({
        where: eq(invoices.providerInvoiceId, providerTransactionId),
      });
      inferredWorkspaceId = invoice?.workspaceId ?? undefined;
    }
  }

  const effectiveWorkspaceId = workspaceId ?? inferredWorkspaceId ?? undefined;
  const values = mapDispute(payload, effectiveWorkspaceId);

  const [row] = await db.insert(disputes).values(values).onConflictDoUpdate({
    target: disputes.providerDisputeId,
    set: values,
  }).returning();

  for (const evidence of payload.evidences ?? []) {
    const evidenceType = String(evidence.evidence_type ?? evidence.type ?? "UNKNOWN");
    await db.insert(disputeEvidenceRequests).values({
      disputeId: row.id,
      providerEvidenceType: evidenceType,
      source: String(evidence.source ?? ""),
      required: String(evidence.required ?? true),
      status: String(evidence.status ?? "PENDING"),
      metadata: evidence,
      dueAt: payload.seller_response_due_date ? new Date(payload.seller_response_due_date) : undefined,
    }).onConflictDoUpdate({
      target: [disputeEvidenceRequests.disputeId, disputeEvidenceRequests.providerEvidenceType],
      set: {
        source: String(evidence.source ?? ""),
        required: String(evidence.required ?? true),
        status: String(evidence.status ?? "PENDING"),
        metadata: evidence,
        dueAt: payload.seller_response_due_date ? new Date(payload.seller_response_due_date) : undefined,
        updatedAt: new Date(),
      },
    });
  }

  return row;
}

export async function submitEvidence(input: {
  disputeId: string;
  providerDisputeId: string;
  evidenceType: string;
  notes?: string;
}) {
  const existingSubmission = await db.query.disputeEvidenceSubmissions.findFirst({
    where: and(
      eq(disputeEvidenceSubmissions.disputeId, input.disputeId),
      eq(disputeEvidenceSubmissions.evidenceType, input.evidenceType),
      eq(disputeEvidenceSubmissions.status, "SUBMITTED"),
    ),
  });
  if (existingSubmission) return existingSubmission;

  const result = await paypalDisputes.provideEvidence(input.providerDisputeId, {
    evidence_type: input.evidenceType,
    notes: input.notes,
  });

  const [submission] = await db.insert(disputeEvidenceSubmissions).values({
    disputeId: input.disputeId,
    evidenceType: input.evidenceType,
    notes: input.notes,
    status: "SUBMITTED",
    providerResponse: result,
    submittedAt: new Date(),
  }).returning();

  await db.update(disputes)
    .set({ updatedAt: new Date() })
    .where(eq(disputes.id, input.disputeId));

  return submission;
}

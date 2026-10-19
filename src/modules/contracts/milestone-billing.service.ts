import { and, eq } from "drizzle-orm";

import { clients, contracts, milestones } from "../../db/schema/core.js";
import { invoiceItems, invoices } from "../../db/schema/invoices.js";
import { milestoneInvoices } from "../../db/schema/billing.js";
import { enqueueOutbox } from "../../lib/outbox.js";
import { writeAudit } from "../../lib/audit.js";
import { ValidationError, NotFoundError } from "../../lib/errors.js";
import { db } from "../../db/client.js";

export type BillingExecutor = Pick<typeof db, "query" | "insert" | "update" | "delete">;

/**
 * Create the single draft invoice for a completed milestone.
 *
 * This function must be called inside a DB transaction when it is part of
 * another state transition. The unique milestone_invoices constraint is the
 * final concurrency/idempotency guard.
 */
export async function billMilestone(
  tx: BillingExecutor,
  input: {
    workspaceId: string;
    milestoneId: string;
    actorType: string;
    actorId?: string;
    requestId?: string;
    dueAt?: Date;
  },
) {
  const milestone = await tx.query.milestones.findFirst({
    where: eq(milestones.id, input.milestoneId),
  });

  if (!milestone) throw new NotFoundError("Milestone not found.");

  const contract = await tx.query.contracts.findFirst({
    where: eq(contracts.id, milestone.contractId),
  });

  if (!contract || contract.workspaceId !== input.workspaceId) {
    throw new NotFoundError("Milestone not found.");
  }

  if (milestone.status !== "completed") {
    throw new ValidationError("Only completed milestones can be billed.");
  }

  if (!milestone.amount) {
    throw new ValidationError("Milestone does not have a billable amount.");
  }

  const existingBinding = await tx.query.milestoneInvoices.findFirst({
    where: eq(milestoneInvoices.milestoneId, milestone.id),
  });

  if (existingBinding) {
    const existingInvoice = await tx.query.invoices.findFirst({
      where: and(
        eq(invoices.id, existingBinding.invoiceId),
        eq(invoices.workspaceId, input.workspaceId),
      ),
    });

    if (!existingInvoice) {
      throw new ValidationError("Milestone billing record is inconsistent.");
    }

    return { milestone, invoice: existingInvoice, created: false };
  }

  const client = await tx.query.clients.findFirst({
    where: and(
      eq(clients.id, contract.clientId),
      eq(clients.workspaceId, input.workspaceId),
    ),
  });

  if (!client) throw new NotFoundError("Milestone client not found.");

  const reference = `MILESTONE-${milestone.id}`;
  const invoiceNumber = `SETTLE-${milestone.id.slice(0, 8).toUpperCase()}`;
  const dueAt = input.dueAt ?? milestone.dueAt ?? undefined;

  const [invoice] = await tx.insert(invoices).values({
    workspaceId: input.workspaceId,
    clientId: client.id,
    contractId: contract.id,
    provider: "paypal",
    invoiceNumber,
    reference,
    status: "draft",
    currency: contract.currency.toUpperCase(),
    amount: milestone.amount,
    dueAt,
  }).returning();

  await tx.insert(invoiceItems).values({
    invoiceId: invoice.id,
    description: milestone.name,
    quantity: "1",
    unitAmount: milestone.amount,
    amount: milestone.amount,
    metadata: {
      milestoneId: milestone.id,
      contractId: contract.id,
      source: "milestone_billing",
    },
  });

  // This unique insert is the database-level duplicate billing guard.
  // onConflictDoNothing makes concurrent billing requests converge on the
  // already-created invoice instead of producing a second bill.
  const [binding] = await tx
    .insert(milestoneInvoices)
    .values({
      milestoneId: milestone.id,
      invoiceId: invoice.id,
    })
    .onConflictDoNothing()
    .returning();

  if (!binding) {
    await tx.delete(invoices).where(eq(invoices.id, invoice.id));

    const existingBinding = await tx.query.milestoneInvoices.findFirst({
      where: eq(milestoneInvoices.milestoneId, milestone.id),
    });

    if (!existingBinding) {
      throw new ValidationError("Milestone billing could not be resolved.");
    }

    const existingInvoice = await tx.query.invoices.findFirst({
      where: and(
        eq(invoices.id, existingBinding.invoiceId),
        eq(invoices.workspaceId, input.workspaceId),
      ),
    });

    if (!existingInvoice) {
      throw new ValidationError("Milestone billing record is inconsistent.");
    }

    return { milestone, invoice: existingInvoice, created: false };
  }

  await enqueueOutbox(tx, {
    workspaceId: input.workspaceId,
    topic: "invoice.created",
    aggregateType: "milestone",
    aggregateId: milestone.id,
    payload: {
      milestoneId: milestone.id,
      invoiceId: invoice.id,
      contractId: contract.id,
    },
  });

  await writeAudit({
    workspaceId: input.workspaceId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: "invoice.created",
    resourceType: "invoice",
    resourceId: invoice.id,
    requestId: input.requestId,
    after: invoice,
    metadata: {
      milestoneId: milestone.id,
      contractId: contract.id,
    },
  }, tx);

  return { milestone, invoice, created: true };
}

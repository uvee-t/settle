import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  milestoneAcceptanceEvents,
  milestoneDeliveryDocuments,
  milestoneDeliveries,
} from "../../db/schema/deliveries.js";
import { contracts, documents, milestones } from "../../db/schema/core.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";

const DELIVERY_STATUSES = ["SUBMITTED", "ACCEPTED", "REJECTED"] as const;

type Executor = typeof db;

async function getScopedMilestone(executor: any, milestoneId: string, workspaceId: string) {
  const milestone = await executor.query.milestones.findFirst({
    where: eq(milestones.id, milestoneId),
  });
  if (!milestone) throw new NotFoundError("Milestone not found.");

  const contract = await executor.query.contracts.findFirst({
    where: and(eq(contracts.id, milestone.contractId), eq(contracts.workspaceId, workspaceId)),
  });
  if (!contract) throw new NotFoundError("Milestone not found.");

  return { milestone, contract };
}

export async function createMilestoneDelivery(input: {
  workspaceId: string;
  milestoneId: string;
  actorId: string;
  requestId?: string;
  title: string;
  description?: string;
  documentIds?: string[];
  metadata?: unknown;
}) {
  const result = await db.transaction(async (tx) => {
    const { milestone } = await getScopedMilestone(tx, input.milestoneId, input.workspaceId);

    if (["cancelled", "rejected"].includes(milestone.status.toLowerCase())) {
      throw new ValidationError("Cannot submit delivery for a cancelled or rejected milestone.");
    }

    const documentIds = [...new Set(input.documentIds ?? [])];
    if (documentIds.length) {
      const docs = await tx.query.documents.findMany({
        where: and(
          eq(documents.workspaceId, input.workspaceId),
          inArray(documents.id, documentIds),
        ),
      });

      if (docs.length !== documentIds.length) {
        throw new NotFoundError("One or more delivery documents were not found.");
      }

      const unverified = docs.filter((d) => d.verificationStatus !== "verified");
      if (unverified.length) {
        throw new ValidationError("All delivery documents must be verified before they can be attached.");
      }
    }

    const [delivery] = await tx.insert(milestoneDeliveries).values({
      workspaceId: input.workspaceId,
      milestoneId: input.milestoneId,
      submittedBy: input.actorId,
      title: input.title,
      description: input.description,
      metadata: input.metadata,
    }).returning();

    if (documentIds.length) {
      await tx.insert(milestoneDeliveryDocuments).values(
        documentIds.map((documentId) => ({ deliveryId: delivery.id, documentId })),
      );
    }

    await tx.insert(milestoneAcceptanceEvents).values({
      workspaceId: input.workspaceId,
      milestoneId: input.milestoneId,
      deliveryId: delivery.id,
      action: "SUBMITTED",
      actorUserId: input.actorId,
      metadata: { document_count: documentIds.length },
    });

    await writeAudit({
      workspaceId: input.workspaceId,
      actorType: "user",
      actorId: input.actorId,
      action: "milestone.delivery_submitted",
      resourceType: "milestone_delivery",
      resourceId: delivery.id,
      requestId: input.requestId,
      after: delivery,
      metadata: { milestoneId: input.milestoneId, documentIds },
    }, tx);

    return { delivery, documentIds };
  });

  return getMilestoneDelivery(result.delivery.id, input.workspaceId);
}

export async function transitionMilestoneDelivery(input: {
  workspaceId: string;
  deliveryId: string;
  actorId: string;
  action: "ACCEPTED" | "REJECTED";
  note?: string;
  requestId?: string;
}) {
  return db.transaction(async (tx) => {
    const delivery = await tx.query.milestoneDeliveries.findFirst({
      where: and(
        eq(milestoneDeliveries.id, input.deliveryId),
        eq(milestoneDeliveries.workspaceId, input.workspaceId),
      ),
    });
    if (!delivery) throw new NotFoundError("Delivery not found.");

    if (delivery.status !== "SUBMITTED") {
      throw new ValidationError(`Delivery cannot transition from ${delivery.status} to ${input.action}.`);
    }

    if (input.action === "REJECTED" && !input.note?.trim()) {
      throw new ValidationError("A rejection reason is required.");
    }

    const { milestone } = await getScopedMilestone(tx, delivery.milestoneId, input.workspaceId);

    if (input.action === "ACCEPTED") {
      const existingAccepted = await tx.query.milestoneDeliveries.findFirst({
        where: and(
          eq(milestoneDeliveries.milestoneId, delivery.milestoneId),
          eq(milestoneDeliveries.status, "ACCEPTED"),
        ),
      });
      if (existingAccepted) {
        throw new ValidationError("This milestone already has an accepted delivery.");
      }
    }

    const now = new Date();
    const [updated] = await tx.update(milestoneDeliveries).set(
      input.action === "ACCEPTED"
        ? { status: "ACCEPTED", acceptedAt: now, acceptedBy: input.actorId, updatedAt: now }
        : { status: "REJECTED", rejectedAt: now, rejectedBy: input.actorId, rejectionReason: input.note!.trim(), updatedAt: now },
    ).where(eq(milestoneDeliveries.id, delivery.id)).returning();

    await tx.insert(milestoneAcceptanceEvents).values({
      workspaceId: input.workspaceId,
      milestoneId: delivery.milestoneId,
      deliveryId: delivery.id,
      action: input.action,
      actorUserId: input.actorId,
      note: input.note?.trim(),
      occurredAt: now,
    });

    await writeAudit({
      workspaceId: input.workspaceId,
      actorType: "user",
      actorId: input.actorId,
      action: input.action === "ACCEPTED" ? "milestone.delivery_accepted" : "milestone.delivery_rejected",
      resourceType: "milestone_delivery",
      resourceId: delivery.id,
      requestId: input.requestId,
      before: delivery,
      after: updated,
      metadata: { milestoneId: delivery.milestoneId, note: input.note?.trim() },
    }, tx);

    return getMilestoneDeliveryInTx(tx, updated.id, milestone.id);
  });
}

async function getMilestoneDeliveryInTx(executor: any, deliveryId: string, milestoneId?: string) {
  const delivery = await executor.query.milestoneDeliveries.findFirst({
    where: milestoneId
      ? and(eq(milestoneDeliveries.id, deliveryId), eq(milestoneDeliveries.milestoneId, milestoneId))
      : eq(milestoneDeliveries.id, deliveryId),
  });
  if (!delivery) throw new NotFoundError("Delivery not found.");

  const links = await executor.query.milestoneDeliveryDocuments.findMany({
    where: eq(milestoneDeliveryDocuments.deliveryId, delivery.id),
  });
  const ids = links.map((l: any) => l.documentId);
  const attachedDocuments = ids.length
    ? await executor.query.documents.findMany({ where: inArray(documents.id, ids) })
    : [];
  const events = await executor.query.milestoneAcceptanceEvents.findMany({
    where: eq(milestoneAcceptanceEvents.deliveryId, delivery.id),
  });

  return { delivery, documents: attachedDocuments, events };
}

export async function getMilestoneDelivery(deliveryId: string, workspaceId: string) {
  const delivery = await db.query.milestoneDeliveries.findFirst({
    where: and(eq(milestoneDeliveries.id, deliveryId), eq(milestoneDeliveries.workspaceId, workspaceId)),
  });
  if (!delivery) throw new NotFoundError("Delivery not found.");
  return getMilestoneDeliveryInTx(db, deliveryId);
}

export async function listMilestoneDeliveries(milestoneId: string, workspaceId: string) {
  const { milestone } = await getScopedMilestone(db, milestoneId, workspaceId);
  const rows = await db.query.milestoneDeliveries.findMany({
    where: and(eq(milestoneDeliveries.milestoneId, milestone.id), eq(milestoneDeliveries.workspaceId, workspaceId)),
  });

  return Promise.all(rows.map((row) => getMilestoneDelivery(row.id, workspaceId)));
}

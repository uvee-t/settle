import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { buildEvidencePack } from "./evidence.service.js";
import { evidencePackItems, evidencePacks } from "../../db/schema/ai.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { submitEvidence } from "../disputes/dispute.service.js";
import { writeAudit } from "../../lib/audit.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";

export async function evidenceRoutes(app: FastifyInstance) {
    app.get(
        "/v1/disputes/:disputeId/evidence-pack",
        { preHandler: requireWorkspace },
        async (request) => {
            const { disputeId } = z
                .object({ disputeId: z.uuid() })
                .parse(request.params);
            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.id, disputeId),
                    eq(disputes.workspaceId, request.auth!.workspaceId!),
                ),
            });
            if (!local) throw new NotFoundError("Dispute not found.");
            return buildEvidencePack(disputeId, request.auth!.workspaceId!);
        },
    );

    app.post(
        "/v1/disputes/:disputeId/evidence-pack/review",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = z
                .object({ disputeId: z.uuid() })
                .parse(request.params);
            const body = z
                .object({
                    action: z.enum(["approve", "reject"]),
                    selected_item_ids: z.array(z.uuid()).optional(),
                })
                .parse(request.body);
            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.id, disputeId),
                    eq(disputes.workspaceId, request.auth!.workspaceId!),
                ),
            });
            if (!local) throw new NotFoundError("Dispute not found.");
            const pack = await db.query.evidencePacks.findFirst({
                where: and(
                    eq(evidencePacks.disputeId, disputeId),
                    eq(evidencePacks.workspaceId, request.auth!.workspaceId!),
                ),
            });
            if (!pack) throw new NotFoundError("Evidence pack not found.");
            if (pack.status === "SUBMITTED")
                throw new NotFoundError(
                    "Evidence pack has already been submitted.",
                );
            const selected = body.selected_item_ids
                ? new Set(body.selected_item_ids)
                : undefined;
            const items = await db.query.evidencePackItems.findMany({
                where: eq(evidencePackItems.evidencePackId, pack.id),
            });
            if (selected) {
                for (const item of items)
                    await db
                        .update(evidencePackItems)
                        .set({
                            selected: selected.has(item.id) ? "true" : "false",
                        })
                        .where(eq(evidencePackItems.id, item.id));
            }
            const [updated] = await db
                .update(evidencePacks)
                .set({
                    status: body.action === "approve" ? "APPROVED" : "REJECTED",
                    reviewedAt: new Date(),
                    reviewedBy: request.auth!.userId,
                    updatedAt: new Date(),
                })
                .where(eq(evidencePacks.id, pack.id))
                .returning();
            await writeAudit({
                workspaceId: request.auth!.workspaceId,
                actorType: "user",
                actorId: request.auth!.userId,
                action:
                    body.action === "approve"
                        ? "evidence_pack.approved"
                        : "evidence_pack.rejected",
                resourceType: "evidence_pack",
                resourceId: pack.id,
                requestId: request.id,
                after: updated,
            });
            return {
                pack: updated,
                items: await db.query.evidencePackItems.findMany({
                    where: eq(evidencePackItems.evidencePackId, pack.id),
                }),
            };
        },
    );

    app.post(
        "/v1/disputes/:disputeId/evidence-pack/submit",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = z
                .object({ disputeId: z.uuid() })
                .parse(request.params);
            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.id, disputeId),
                    eq(disputes.workspaceId, request.auth!.workspaceId!),
                ),
            });
            if (!local) throw new NotFoundError("Dispute not found.");
            const pack = await db.query.evidencePacks.findFirst({
                where: and(
                    eq(evidencePacks.disputeId, disputeId),
                    eq(evidencePacks.workspaceId, request.auth!.workspaceId!),
                ),
            });
            if (!pack) throw new NotFoundError("Evidence pack not found.");
            if (pack.status !== "APPROVED")
                throw new ValidationError(
                    "Evidence pack must be approved before submission.",
                );
            const items = await db.query.evidencePackItems.findMany({
                where: and(
                    eq(evidencePackItems.evidencePackId, pack.id),
                    eq(evidencePackItems.selected, "true"),
                ),
            });
            const requirements =
                await db.query.disputeEvidenceRequests.findMany({
                    where: eq(disputeEvidenceRequests.disputeId, disputeId),
                });
            const submissions: unknown[] = [];

            for (const requirement of requirements) {
                const type = requirement.providerEvidenceType;

                const item = items.find(
                    (i) =>
                        i.evidenceType === type ||
                        (type === "PROOF_OF_DELIVERY" &&
                            i.evidenceType === "PROOF_OF_FULFILLMENT") ||
                        (type === "COMMUNICATION" &&
                            i.evidenceType === "COMMUNICATION"),
                );

                if (!item) continue;

                const result = await submitEvidence({
                    disputeId: local.id,
                    providerDisputeId: local.providerDisputeId,
                    evidenceType: type,
                    evidenceRequestId: requirement.id,
                    notes: `${item.claim}\n\nSettle evidence pack: ${pack.id}`,
                });

                submissions.push(result);
            }
            if (!submissions.length)
                throw new ValidationError(
                    "No selected evidence matches a PayPal evidence requirement.",
                );
            const [updated] = await db
                .update(evidencePacks)
                .set({
                    status: "SUBMITTED",
                    submittedAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(evidencePacks.id, pack.id))
                .returning();
            await writeAudit({
                workspaceId: request.auth!.workspaceId,
                actorType: "user",
                actorId: request.auth!.userId,
                action: "evidence_pack.submitted",
                resourceType: "evidence_pack",
                resourceId: pack.id,
                requestId: request.id,
                after: updated,
                metadata: {
                    submission_count: submissions.length,
                    submission_ids: submissions
                        .map((submission) =>
                            typeof submission === "object" &&
                            submission !== null &&
                            "id" in submission
                                ? String((submission as { id: unknown }).id)
                                : null,
                        )
                        .filter((id): id is string => Boolean(id)),
                    evidence_types: submissions
                        .map((submission) =>
                            typeof submission === "object" &&
                            submission !== null &&
                            "evidenceType" in submission
                                ? String(
                                      (submission as {
                                          evidenceType: unknown;
                                      }).evidenceType,
                                  )
                                : null,
                        )
                        .filter((type): type is string => Boolean(type)),
                },
            });
            return { pack: updated, submissions };
        },
    );
}

import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { documents } from "../../db/schema/core.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { buildEvidencePack } from "./evidence.service.js";
import { evidenceMatchesRequirement, getEvidenceRequirementStatus } from "./evidence-matching.js";
import { evidencePackItems, evidencePacks } from "../../db/schema/ai.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { submitEvidence } from "../disputes/dispute.service.js";
import { workspacePayPalDisputes } from "../paypal/paypal.disputes.js";
import { getWorkspacePayPalClient } from "../paypal/paypal.workspace.js";
import { PayPalDisputeAdapter } from "../paypal/paypal.disputes.js";
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
        "/v1/disputes/:disputeId/evidence-pack/documents",
        { preHandler: requireRole("owner", "admin", "member") },
        async (request, reply) => {
            const { disputeId } = z
                .object({ disputeId: z.uuid() })
                .parse(request.params);
            const body = z
                .object({
                    document_id: z.uuid(),
                    evidence_type: z
                        .string()
                        .regex(/^[A-Za-z0-9_]{1,100}$/)
                        .default("PROOF_OF_FULFILLMENT"),
                    claim: z.string().min(5).max(5000).optional(),
                })
                .parse(request.body);
            const workspaceId = request.auth!.workspaceId!;
            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.id, disputeId),
                    eq(disputes.workspaceId, workspaceId),
                ),
            });
            if (!local) throw new NotFoundError("Dispute not found.");
            const document = await db.query.documents.findFirst({
                where: and(
                    eq(documents.id, body.document_id),
                    eq(documents.workspaceId, workspaceId),
                ),
            });
            if (!document)
                throw new NotFoundError(
                    "Document not found in this workspace.",
                );
            if (
                document.verificationStatus !== "verified" ||
                document.status !== "verified"
            ) {
                throw new ValidationError(
                    "Only documents that have completed verification can be attached as dispute evidence.",
                );
            }
            let pack = await db.query.evidencePacks.findFirst({
                where: and(
                    eq(evidencePacks.disputeId, disputeId),
                    eq(evidencePacks.workspaceId, workspaceId),
                ),
            });
            if (!pack) {
                await buildEvidencePack(disputeId, workspaceId);
                pack = await db.query.evidencePacks.findFirst({
                    where: and(
                        eq(evidencePacks.disputeId, disputeId),
                        eq(evidencePacks.workspaceId, workspaceId),
                    ),
                });
            }
            if (!pack)
                throw new NotFoundError("Evidence pack could not be prepared.");
            if (pack.status === "SUBMITTED")
                throw new ValidationError(
                    "Evidence has already been submitted to PayPal; create a follow-up submission if PayPal still permits it.",
                );
            const existing = await db.query.evidencePackItems.findMany({
                where: eq(evidencePackItems.evidencePackId, pack.id),
            });
            const duplicate = existing.find(
                (item) =>
                    item.sourceType === "document" &&
                    item.sourceId === document.id &&
                    item.evidenceType === body.evidence_type,
            );
            if (duplicate)
                return reply
                    .code(200)
                    .send({ item: duplicate, duplicate: true });
            const [item] = await db
                .insert(evidencePackItems)
                .values({
                    evidencePackId: pack.id,
                    evidenceType: body.evidence_type,
                    sourceType: "document",
                    sourceId: document.id,
                    claim:
                        body.claim ||
                        `Supporting document ${document.filename} (${document.contentType}, ${document.sizeBytes} bytes) was uploaded to Settle and verified. Review the document and confirm its contents support this claim before submission.`,
                    confidence: "0.80",
                    selected: "true",
                    metadata: {
                        filename: document.filename,
                        contentType: document.contentType,
                        sizeBytes: document.sizeBytes,
                        sha256: document.sha256,
                        objectKey: document.objectKey,
                        manual_attachment: true,
                    },
                })
                .returning();
            await db
                .update(evidencePacks)
                .set({
                    status: "READY_FOR_REVIEW",
                    reviewedAt: null,
                    reviewedBy: null,
                    updatedAt: new Date(),
                })
                .where(eq(evidencePacks.id, pack.id));
            await writeAudit({
                workspaceId,
                actorType: "user",
                actorId: request.auth!.userId,
                action: "dispute.evidence_document_attached",
                resourceType: "dispute",
                resourceId: local.id,
                requestId: request.id,
                metadata: {
                    document_id: document.id,
                    evidence_item_id: item.id,
                },
            });
            return reply.code(201).send({ item, duplicate: false });
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
            const allRequirements =
                await db.query.disputeEvidenceRequests.findMany({
                    where: eq(disputeEvidenceRequests.disputeId, disputeId),
                });
            // PayPal's response can include evidence submitted by the buyer as
            // well as evidence requested from the seller. Only seller-requested
            // evidence should drive this submission. Keep empty-source legacy
            // records for older synced disputes.
            const requirements = allRequirements.filter((r) =>
                !r.source || r.source === "REQUESTED_FROM_SELLER",
            );
            const submissions: unknown[] = [];
            const requirementStatus = getEvidenceRequirementStatus(requirements, items);
            const missingRequired = requirementStatus.filter((r) => r.required && !r.matched);
            if (!requirements.length) {
                throw new ValidationError(
                    "PayPal has not provided any seller evidence requirements for this dispute. Refresh the dispute details before submitting evidence.",
                );
            }
            if (missingRequired.length) {
                throw new ValidationError(
                    "Some required PayPal evidence types are still missing. No evidence was submitted. Add matching evidence before trying again.",
                    { missingRequirements: missingRequired.map((r) => r.evidenceType) },
                );
            }

            for (const requirement of requirements) {
                const type = requirement.providerEvidenceType;

                // Only submit evidence under the exact evidence_type requested by
                // PayPal. Similar-sounding categories are not interchangeable.
                const matchingItems = items.filter((i) =>
                    evidenceMatchesRequirement(i.evidenceType, type),
                );
                if (!matchingItems.length) continue;
                const attachedDocuments: Array<{
                    id: string;
                    workspaceId: string;
                }> = [];
                for (const item of matchingItems) {
                    if (item.sourceType === "document") {
                        const doc = await db.query.documents.findFirst({
                            where: and(
                                eq(documents.id, item.sourceId),
                                eq(
                                    documents.workspaceId,
                                    request.auth!.workspaceId!,
                                ),
                            ),
                        });
                        if (!doc || doc.verificationStatus !== "verified") {
                            throw new ValidationError(
                                `Evidence document ${item.sourceId} is missing or has not passed verification.`,
                            );
                        }
                        attachedDocuments.push({
                            id: doc.id,
                            workspaceId: request.auth!.workspaceId!,
                        });
                    }
                }
                const workspaceId = request.auth!.workspaceId!;
                const paypalClient =
                    await getWorkspacePayPalClient(workspaceId);
                const adapter = new PayPalDisputeAdapter(paypalClient);
                const result = await submitEvidence({
                    disputeId: local.id,
                    providerDisputeId: local.providerDisputeId,
                    evidenceType: type,
                    evidenceRequestId: requirement.id,
                    notes: `${matchingItems.map((item) => item.claim).join("\n\n")}\n\nSettle evidence pack: ${pack.id}`.slice(
                        0,
                        1900,
                    ),
                    documents: attachedDocuments,
                    adapter,
                });

                submissions.push(result);
            }
            if (!submissions.length) {
                throw new ValidationError(
                    "No selected evidence matches a PayPal evidence requirement. Select or attach evidence using one of the exact evidence types requested by PayPal.",
                    {
                        requiredEvidenceTypes: requirementStatus.filter((r) => r.required).map((r) => r.evidenceType),
                        selectedEvidenceTypes: [...new Set(items.map((item) => item.evidenceType))],
                        missingRequirements: missingRequired.map((r) => r.evidenceType),
                    },
                );
            }
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
                                      (
                                          submission as {
                                              evidenceType: unknown;
                                          }
                                      ).evidenceType,
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

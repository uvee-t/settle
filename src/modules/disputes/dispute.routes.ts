import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { workspacePayPalDisputes } from "../paypal/paypal.disputes.js";
import { getWorkspacePayPalClient } from "../paypal/paypal.workspace.js";
import { disputes } from "../../db/schema/disputes.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { db } from "../../db/client.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { submitEvidence, syncDispute } from "./dispute.service.js";
import { writeAudit } from "../../lib/audit.js";
import { generateDisputeCopilot } from "../ai/ai.service.js";

const idSchema = z.object({ disputeId: z.string().min(1) });

export async function disputeRoutes(app: FastifyInstance) {
    app.get(
        "/v1/disputes/by-transaction/:transactionId",
        { preHandler: requireWorkspace },
        async (request) => {
            const { transactionId } = z
                .object({
                    transactionId: z.string().regex(
                        /^[A-Za-z0-9]{17}$/,
                        "Enter the 17-character PayPal seller transaction ID, not an order, invoice, or dispute ID.",
                    ),
                })
                .parse(request.params);

            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));
            const result = await adapter.listByTransaction(transactionId);

            for (const item of result.items ?? []) {
                await syncDispute(item.dispute_id, request.auth!.workspaceId, adapter);
            }

            return result;
        },
    );

    app.get(
        "/v1/disputes",
        { preHandler: requireWorkspace },
        async (request) => {
            return db.query.disputes.findMany({
                where: eq(disputes.workspaceId, request.auth!.workspaceId!),
            });
        },
    );

    app.post(
        "/v1/disputes/sync",
        { preHandler: requireRole("owner", "admin", "member") },
        async (request) => {
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));
            const result = await adapter.listRecent();
            let synced = 0;
            for (const item of result.items ?? []) {
                if (!item.dispute_id) continue;
                await syncDispute(item.dispute_id, request.auth!.workspaceId!, adapter);
                synced++;
            }
            return { synced, imported: synced, items: result.items ?? [] };
        },
    );

    app.get(
        "/v1/disputes/:disputeId",
        { preHandler: requireWorkspace },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);

            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));
            const provider = await adapter.get(disputeId);

            await syncDispute(disputeId, request.auth!.workspaceId, adapter);

            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.providerDisputeId, disputeId),
                    eq(disputes.workspaceId, request.auth!.workspaceId!),
                ),
            });

            return { local, provider };
        },
    );

    app.post(
        "/v1/disputes/:disputeId/evidence",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);

            const body = z
                .object({
                    evidence_type: z.string().min(1),
                    notes: z.string().max(5000).optional(),
                })
                .parse(request.body);

            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.providerDisputeId, disputeId),
                    eq(disputes.workspaceId, request.auth!.workspaceId!),
                ),
            });

            if (!local) {
                throw new NotFoundError("Dispute not found in this workspace.");
            }

            const providerRequirements = await db.query.disputeEvidenceRequests.findMany({
                where: eq(disputeEvidenceRequests.disputeId, local.id),
            });
            const sellerRequirements = providerRequirements.filter(
                (item) => !item.source || item.source === "REQUESTED_FROM_SELLER",
            );
            if (!sellerRequirements.length) {
                throw new ValidationError(
                    "PayPal has not provided seller evidence requirements for this dispute. Evidence can be prepared in Settle, but direct provider submission is unavailable until PayPal supplies seller requirements.",
                    { disputeId: local.id, requirementsState: "not_provided", retryable: false },
                );
            }
            if (!sellerRequirements.some((item) => item.providerEvidenceType.trim().toUpperCase() === body.evidence_type.trim().toUpperCase())) {
                throw new ValidationError(
                    "The evidence type does not match a seller evidence requirement returned by PayPal.",
                    { requestedEvidenceType: body.evidence_type, allowedEvidenceTypes: sellerRequirements.map((item) => item.providerEvidenceType) },
                );
            }

            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));
            const result = await submitEvidence({
                disputeId: local.id,
                providerDisputeId: local.providerDisputeId,
                evidenceType: body.evidence_type,
                notes: body.notes,
                adapter,
            });

            await writeAudit({
                workspaceId: request.auth!.workspaceId,
                actorType: "user",
                actorId: request.auth!.userId,
                action: "dispute.evidence_submitted",
                resourceType: "dispute",
                resourceId: local.id,
                requestId: request.id,
                after: result,
            });

            return result;
        },
    );

    app.post(
        "/v1/disputes/:disputeId/ai-copilot",
        { preHandler: requireRole("owner", "admin", "member") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({
                where: and(
                    eq(disputes.providerDisputeId, disputeId),
                    eq(disputes.workspaceId, request.auth!.workspaceId!),
                ),
            });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));
            const provider = await adapter.get(disputeId);
            const messages = Array.isArray((provider as any).messages) ? (provider as any).messages : [];
            const result = await generateDisputeCopilot({
                workspaceId: request.auth!.workspaceId!,
                dispute: { local, provider },
                messages,
            });
            return { ...result, messages, provider };
        },
    );

    app.post(
        "/v1/disputes/:disputeId/message",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({ where: and(eq(disputes.providerDisputeId, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)) });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));

            const body = z
                .object({
                    content: z.string().min(1).max(5000),
                })
                .parse(request.body);

            return adapter.sendMessage(disputeId, body.content);
        },
    );

    app.post(
        "/v1/disputes/:disputeId/make-offer",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({ where: and(eq(disputes.providerDisputeId, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)) });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));

            return adapter.makeOffer(
                disputeId,
                request.body as Record<string, unknown>,
            );
        },
    );

    app.post(
        "/v1/disputes/:disputeId/accept-claim",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({ where: and(eq(disputes.providerDisputeId, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)) });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));

            return adapter.acceptClaim(
                disputeId,
                request.body as Record<string, unknown>,
            );
        },
    );

    app.post(
        "/v1/disputes/:disputeId/supporting-info",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({ where: and(eq(disputes.providerDisputeId, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)) });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));

            return adapter.provideSupportingInfo(
                disputeId,
                request.body as Record<string, unknown>,
            );
        },
    );

    app.post(
        "/v1/disputes/:disputeId/appeal",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({ where: and(eq(disputes.providerDisputeId, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)) });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));

            return adapter.appeal(
                disputeId,
                request.body as Record<string, unknown>,
            );
        },
    );

    app.post(
        "/v1/disputes/:disputeId/escalate",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);
            const local = await db.query.disputes.findFirst({ where: and(eq(disputes.providerDisputeId, disputeId), eq(disputes.workspaceId, request.auth!.workspaceId!)) });
            if (!local) throw new NotFoundError("Dispute not found in this workspace.");
            const adapter = workspacePayPalDisputes(await getWorkspacePayPalClient(request.auth!.workspaceId!));

            return adapter.escalate(disputeId);
        },
    );
}

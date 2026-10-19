import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { paypalDisputes } from "../paypal/paypal.disputes.js";
import { disputes } from "../../db/schema/disputes.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { db } from "../../db/client.js";
import { NotFoundError } from "../../lib/errors.js";
import { submitEvidence, syncDispute } from "./dispute.service.js";
import { writeAudit } from "../../lib/audit.js";

const idSchema = z.object({ disputeId: z.string().min(1) });

export async function disputeRoutes(app: FastifyInstance) {
    app.get(
        "/v1/disputes/by-transaction/:transactionId",
        { preHandler: requireWorkspace },
        async (request) => {
            const { transactionId } = z
                .object({ transactionId: z.string().min(1) })
                .parse(request.params);

            const result =
                await paypalDisputes.listByTransaction(transactionId);

            for (const item of result.items ?? []) {
                await syncDispute(item.dispute_id, request.auth!.workspaceId);
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
            const result = await paypalDisputes.listRecent();
            let synced = 0;
            for (const item of result.items ?? []) {
                if (!item.dispute_id) continue;
                await syncDispute(item.dispute_id, request.auth!.workspaceId!);
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

            const provider = await paypalDisputes.get(disputeId);

            await syncDispute(disputeId, request.auth!.workspaceId);

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

            const result = await submitEvidence({
                disputeId: local.id,
                providerDisputeId: local.providerDisputeId,
                evidenceType: body.evidence_type,
                notes: body.notes,
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
        "/v1/disputes/:disputeId/message",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);

            const body = z
                .object({
                    content: z.string().min(1).max(5000),
                })
                .parse(request.body);

            return paypalDisputes.sendMessage(disputeId, body.content);
        },
    );

    app.post(
        "/v1/disputes/:disputeId/make-offer",
        { preHandler: requireRole("owner", "admin") },
        async (request) => {
            const { disputeId } = idSchema.parse(request.params);

            return paypalDisputes.makeOffer(
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

            return paypalDisputes.acceptClaim(
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

            return paypalDisputes.provideSupportingInfo(
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

            return paypalDisputes.appeal(
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

            return paypalDisputes.escalate(disputeId);
        },
    );
}

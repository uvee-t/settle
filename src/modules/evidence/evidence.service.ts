import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { evidencePackItems, evidencePacks } from "../../db/schema/ai.js";
import { NotFoundError } from "../../lib/errors.js";
import { generateEvidencePack } from "./evidence-intelligence.service.js";
import { getEvidenceRequirementStatus } from "./evidence-matching.js";

export async function buildEvidencePack(
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
    const existingPack = await db.query.evidencePacks.findFirst({
        where: and(
            eq(evidencePacks.disputeId, disputeId),
            eq(evidencePacks.workspaceId, workspaceId),
        ),
    });
    if (
        existingPack &&
        ["READY_FOR_REVIEW", "APPROVED", "SUBMITTED"].includes(
            existingPack.status,
        )
    ) {
        const requirements = await db.query.disputeEvidenceRequests.findMany({
            where: eq(disputeEvidenceRequests.disputeId, disputeId),
        });
        const items = await db.query.evidencePackItems.findMany({
            where: eq(evidencePackItems.evidencePackId, existingPack.id),
        });
        const sellerRequirements = requirements.filter((r) => !r.source || r.source === "REQUESTED_FROM_SELLER");
        const coverage = getEvidenceRequirementStatus(sellerRequirements, items);
        return {
            generated_at: new Date().toISOString(),
            dispute,
            requirements,
            provider_requirements_available: sellerRequirements.length > 0,
            requirements_state: sellerRequirements.length > 0 ? "provided" : "not_provided",
            suggested_evidence_types: (existingPack.analysis as { suggested_evidence_types?: string[] } | null)?.suggested_evidence_types ?? [],
            evidence_pack: existingPack,
            items,
            missing_evidence: coverage.filter((r) => r.required && !r.matched).map((r) => r.evidenceType),
        };
    }
    const generated = await generateEvidencePack(disputeId, workspaceId);
    const requirements = await db.query.disputeEvidenceRequests.findMany({
        where: eq(disputeEvidenceRequests.disputeId, disputeId),
    });
    const pack = await db.query.evidencePacks.findFirst({
        where: eq(evidencePacks.id, generated.packId),
    });
    const items = await db.query.evidencePackItems.findMany({
        where: eq(evidencePackItems.evidencePackId, generated.packId),
    });
    return {
        generated_at: new Date().toISOString(),
        dispute,
        requirements,
        provider_requirements_available: generated.providerRequirementsAvailable,
        requirements_state: generated.providerRequirementsAvailable ? "provided" : "not_provided",
        suggested_evidence_types: generated.suggestedRequirements,
        evidence_pack: pack,
        items,
        missing_evidence: generated.missing,
    };
}

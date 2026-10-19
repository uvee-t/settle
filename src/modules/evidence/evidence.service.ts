import { and, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { disputes } from "../../db/schema/disputes.js";
import { disputeEvidenceRequests } from "../../db/schema/evidence.js";
import { evidencePackItems, evidencePacks } from "../../db/schema/ai.js";
import { NotFoundError } from "../../lib/errors.js";
import { generateEvidencePack } from "./evidence-intelligence.service.js";

export async function buildEvidencePack(disputeId: string, workspaceId: string) {
  const dispute = await db.query.disputes.findFirst({ where: and(eq(disputes.id, disputeId), eq(disputes.workspaceId, workspaceId)) });
  if (!dispute) throw new NotFoundError("Dispute not found.");
  const existingPack = await db.query.evidencePacks.findFirst({ where: and(eq(evidencePacks.disputeId, disputeId), eq(evidencePacks.workspaceId, workspaceId)) });
  if (existingPack && ["READY_FOR_REVIEW", "APPROVED", "SUBMITTED"].includes(existingPack.status)) {
    const requirements = await db.query.disputeEvidenceRequests.findMany({ where: eq(disputeEvidenceRequests.disputeId, disputeId) });
    const items = await db.query.evidencePackItems.findMany({ where: eq(evidencePackItems.evidencePackId, existingPack.id) });
    return { generated_at: new Date().toISOString(), dispute, requirements, evidence_pack: existingPack, items, missing_evidence: [] };
  }
  const generated = await generateEvidencePack(disputeId, workspaceId);
  const requirements = await db.query.disputeEvidenceRequests.findMany({ where: eq(disputeEvidenceRequests.disputeId, disputeId) });
  const pack = await db.query.evidencePacks.findFirst({ where: eq(evidencePacks.id, generated.packId) });
  const items = await db.query.evidencePackItems.findMany({ where: eq(evidencePackItems.evidencePackId, generated.packId) });
  return { generated_at: new Date().toISOString(), dispute, requirements, evidence_pack: pack, items, missing_evidence: generated.missing };
}

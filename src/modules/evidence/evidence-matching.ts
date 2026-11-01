/**
 * PayPal's evidence_type is a provider contract, not a loose category.
 * Only exact normalized matches are considered compatible. In particular,
 * CONTRACT/INVOICE/PROOF_OF_FULFILLMENT must not be silently relabelled OTHER.
 */
export function normalizeEvidenceType(value: unknown): string {
    return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function evidenceMatchesRequirement(
    itemType: unknown,
    requirementType: unknown,
): boolean {
    const item = normalizeEvidenceType(itemType);
    const requirement = normalizeEvidenceType(requirementType);
    return Boolean(item && requirement && item === requirement);
}

export function getEvidenceRequirementStatus(
    requirements: readonly { providerEvidenceType: string; required?: string | null }[],
    items: readonly { evidenceType: string; selected: string | null }[],
) {
    return requirements.map((requirement) => {
        const selected = items.filter(
            (item) => item.selected === "true" && evidenceMatchesRequirement(item.evidenceType, requirement.providerEvidenceType),
        );
        return {
            evidenceType: normalizeEvidenceType(requirement.providerEvidenceType),
            required: requirement.required !== "false",
            matchedCount: selected.length,
            matched: selected.length > 0,
        };
    });
}

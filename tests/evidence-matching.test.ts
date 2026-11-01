import { describe, expect, it } from "vitest";
import { evidenceMatchesRequirement, getEvidenceRequirementStatus } from "../src/modules/evidence/evidence-matching.js";

describe("PayPal evidence matching", () => {
  it("matches normalized exact PayPal evidence types", () => {
    expect(evidenceMatchesRequirement(" proof_of_fulfillment ", "PROOF_OF_FULFILLMENT")).toBe(true);
  });
  it("does not silently treat fulfillment as OTHER", () => {
    expect(evidenceMatchesRequirement("PROOF_OF_FULFILLMENT", "OTHER")).toBe(false);
  });
  it("reports unmatched and matched requirements separately", () => {
    const result = getEvidenceRequirementStatus(
      [{ providerEvidenceType: "OTHER", required: "true" }, { providerEvidenceType: "PROOF_OF_REFUND", required: "true" }],
      [{ evidenceType: "PROOF_OF_FULFILLMENT", selected: "true" }],
    );
    expect(result).toEqual([
      { evidenceType: "OTHER", required: true, matchedCount: 0, matched: false },
      { evidenceType: "PROOF_OF_REFUND", required: true, matchedCount: 0, matched: false },
    ]);
  });
});

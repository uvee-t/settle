import { describe, expect, it } from "vitest";
import { contractExtractionSchema } from "../src/modules/ai/contract-extraction.schema.js";

const baseExtraction = {
    document_type: "contract",
    title: "Website development",
    parties: [{ name: "ABC Technologies", role: "client" }],
    currency: "USD",
    total_amount: 5000,
    effective_date: null,
    governing_law: null,
    payment_terms: { due_days: 15, notes: "50% upfront" },
    milestones: [{ name: "Backend", amount: 2000, due_date: null, deliverables: ["API"] }],
    claims: [],
    summary: "A website development contract.",
};

describe("contract extraction monetary normalization", () => {
    it("normalizes numeric totals and milestone amounts to strings", () => {
        const parsed = contractExtractionSchema.parse(baseExtraction);
        expect(parsed.total_amount).toBe("5000");
        expect(parsed.milestones[0].amount).toBe("2000");
    });

    it("preserves monetary strings and null values", () => {
        const parsed = contractExtractionSchema.parse({
            ...baseExtraction,
            total_amount: "5000.00",
            milestones: [{ ...baseExtraction.milestones[0], amount: null }],
        });
        expect(parsed.total_amount).toBe("5000.00");
        expect(parsed.milestones[0].amount).toBeNull();
    });

    it("rejects non-finite monetary numbers", () => {
        expect(() => contractExtractionSchema.parse({ ...baseExtraction, total_amount: Number.NaN })).toThrow();
    });
});

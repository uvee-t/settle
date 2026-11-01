import { z } from "zod";

/**
 * LLMs may serialize monetary values as JSON numbers or strings.
 * Normalize both representations to strings at the provider boundary so the
 * rest of the application keeps one stable representation.
 */
const monetaryAmountSchema = z
    .union([z.string(), z.number().finite()])
    .transform((value) => String(value))
    .nullable();

export const contractExtractionSchema = z.object({
    document_type: z.string(),
    title: z.string().nullable(),
    parties: z.array(z.object({ name: z.string(), role: z.string() })),
    currency: z.string().nullable(),
    total_amount: monetaryAmountSchema,
    effective_date: z.string().nullable(),
    governing_law: z.string().nullable(),
    payment_terms: z.object({
        due_days: z.number().int().nonnegative().nullable(),
        notes: z.string().nullable(),
    }),
    milestones: z.array(
        z.object({
            name: z.string(),
            amount: monetaryAmountSchema,
            due_date: z.string().nullable(),
            deliverables: z.array(z.string()),
        }),
    ),
    claims: z.array(
        z.object({
            field: z.string(),
            value: z.unknown(),
            confidence: z.number().min(0).max(1),
            source_excerpt: z.string().max(1200),
        }),
    ),
    summary: z.string().max(5000),
});

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ExternalServiceError, ValidationError } from "../../lib/errors.js";
import { db } from "../../db/client.js";
import { aiRuns, evidenceFacts } from "../../db/schema/ai.js";
import { documents } from "../../db/schema/core.js";
import { and, eq } from "drizzle-orm";
import { downloadStoredObject } from "../documents/document.service.js";
import { withRedisLock } from "../../lib/distributed-lock.js";

async function pdfToText(buffer: Buffer) {
    const dir = await mkdtemp(join(tmpdir(), "settle-pdf-"));
    const input = join(dir, "input.pdf");
    const output = join(dir, "output.txt");
    try {
        await writeFile(input, buffer, { mode: 0o600 });
        await new Promise<void>((resolve, reject) => {
            const child = spawn("pdftotext", ["-layout", input, output], {
                stdio: ["ignore", "ignore", "pipe"],
            });
            let stderr = "";
            child.stderr.on("data", (data) => {
                stderr += data.toString("utf8");
            });
            child.on("error", () =>
                reject(
                    new ExternalServiceError(
                        "PDF_TEXT_EXTRACTION_UNAVAILABLE",
                        "pdftotext is required for PDF AI extraction.",
                        503,
                    ),
                ),
            );
            child.on("close", (code) =>
                code === 0
                    ? resolve()
                    : reject(
                          new ExternalServiceError(
                              "PDF_TEXT_EXTRACTION_FAILED",
                              stderr.slice(0, 500) ||
                                  "PDF text extraction failed.",
                              422,
                          ),
                      ),
            );
        });
        return (await readFile(output)).toString("utf8");
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}

export const contractExtractionSchema = z.object({
    document_type: z.string(),
    title: z.string().nullable(),
    parties: z.array(z.object({ name: z.string(), role: z.string() })),
    currency: z.string().nullable(),
    total_amount: z.string().nullable(),
    effective_date: z.string().nullable(),
    governing_law: z.string().nullable(),
    payment_terms: z.object({
        due_days: z.number().int().nonnegative().nullable(),
        notes: z.string().nullable(),
    }),
    milestones: z.array(
        z.object({
            name: z.string(),
            amount: z.string().nullable(),
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

const defenseSchema = z.object({
    strength_score: z.number().min(0).max(100),
    summary: z.string().max(4000),
    defense_draft: z.string().max(8000),
    claims: z.array(
        z.object({
            claim: z.string(),
            evidence_type: z.string(),
            confidence: z.number().min(0).max(1),
        }),
    ),
    missing_evidence: z.array(z.string()),
});

function parseJson(text: string): unknown {
    const cleaned = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start >= 0 && end > start)
            return JSON.parse(cleaned.slice(start, end + 1));
        throw new ValidationError("AI provider returned invalid JSON.");
    }
}

async function requestProvider(prompt: string) {
    if (!env.AI_ENABLED)
        throw new ExternalServiceError(
            "AI_DISABLED",
            "AI processing is disabled.",
            503,
        );
    if (!env.AI_API_KEY)
        throw new ExternalServiceError(
            "AI_NOT_CONFIGURED",
            "AI_API_KEY is not configured.",
            503,
        );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
    const started = Date.now();
    try {
        if (env.AI_PROVIDER === "gemini") {
            const base =
                env.AI_BASE_URL ??
                "https://generativelanguage.googleapis.com/v1beta";
            const response = await fetch(
                `${base}/models/${encodeURIComponent(env.AI_MODEL)}:generateContent?key=${encodeURIComponent(env.AI_API_KEY)}`,
                {
                    method: "POST",
                    signal: controller.signal,
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: prompt }] }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            temperature: 0.1,
                            maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
                        },
                    }),
                },
            );
            const body = (await response.json()) as Record<string, any>;
            if (!response.ok)
                throw new ExternalServiceError(
                    "AI_PROVIDER_ERROR",
                    `AI provider request failed (${response.status}).`,
                    502,
                );
            const text =
                body.candidates?.[0]?.content?.parts
                    ?.map((p: any) => p.text ?? "")
                    .join("") ?? "";
            return {
                parsed: parseJson(text),
                latencyMs: Date.now() - started,
                tokensIn: body.usageMetadata?.promptTokenCount,
                tokensOut: body.usageMetadata?.candidatesTokenCount,
            };
        }
        const base = env.AI_BASE_URL ?? "https://api.openai.com/v1";
        const response = await fetch(
            `${base.replace(/\/$/, "")}/chat/completions`,
            {
                method: "POST",
                signal: controller.signal,
                headers: {
                    authorization: `Bearer ${env.AI_API_KEY}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: env.AI_MODEL,
                    temperature: 0.1,
                    max_tokens: env.AI_MAX_OUTPUT_TOKENS,
                    response_format: { type: "json_object" },
                    messages: [
                        {
                            role: "system",
                            content:
                                "Return only valid JSON. Never invent facts. Use null when unknown.",
                        },
                        { role: "user", content: prompt },
                    ],
                }),
            },
        );
        const body = (await response.json()) as Record<string, any>;
        if (!response.ok)
            throw new ExternalServiceError(
                "AI_PROVIDER_ERROR",
                `AI provider request failed (${response.status}).`,
                502,
            );
        const text = body.choices?.[0]?.message?.content ?? "";
        return {
            parsed: parseJson(text),
            latencyMs: Date.now() - started,
            tokensIn: body.usage?.prompt_tokens,
            tokensOut: body.usage?.completion_tokens,
        };
    } catch (error) {
        if (
            error instanceof ExternalServiceError ||
            error instanceof ValidationError
        )
            throw error;
        if (error instanceof Error && error.name === "AbortError")
            throw new ExternalServiceError(
                "AI_TIMEOUT",
                "AI provider request timed out.",
                504,
            );
        throw new ExternalServiceError(
            "AI_PROVIDER_UNAVAILABLE",
            error instanceof Error ? error.message : "AI provider unavailable.",
            502,
        );
    } finally {
        clearTimeout(timeout);
    }
}

export async function extractDocumentText(
    document: typeof documents.$inferSelect,
) {
    const buffer = await downloadStoredObject(
        document.objectKey,
        document.workspaceId,
    );
    if (document.contentType === "application/pdf")
        return (await pdfToText(buffer)).slice(0, env.AI_MAX_INPUT_CHARS);
    if (
        ["text/plain", "text/csv", "application/json"].includes(
            document.contentType,
        )
    )
        return buffer.toString("utf8").slice(0, env.AI_MAX_INPUT_CHARS);
    throw new ValidationError(
        `AI text extraction is not supported for ${document.contentType}.`,
    );
}

export async function extractContractFacts(documentId: string) {
    return withRedisLock(
        `settle:ai:extract:${documentId}`,
        async () => {
            const document = await db.query.documents.findFirst({
                where: eq(documents.id, documentId),
            });
            if (!document || document.verificationStatus !== "verified") {
                throw new ValidationError(
                    "Only verified documents can be analyzed by AI.",
                );
            }

            const text = await extractDocumentText(document);
            const inputHash = createHash("sha256").update(text).digest("hex");
            const promptVersion = "contract-extraction-v1";
            const successfulRuns = await db.query.aiRuns.findMany({
                where: and(
                    eq(aiRuns.workspaceId, document.workspaceId),
                    eq(aiRuns.task, "document.contract_extraction"),
                    eq(aiRuns.provider, env.AI_PROVIDER),
                    eq(aiRuns.model, env.AI_MODEL),
                    eq(aiRuns.promptVersion, promptVersion),
                    eq(aiRuns.inputHash, inputHash),
                    eq(aiRuns.status, "SUCCEEDED"),
                ),
                orderBy: (run, { desc }) => [desc(run.createdAt)],
            });
            const existingRun = successfulRuns.find((run) => {
                const previous = run.result as { document_id?: string } | null;
                return previous?.document_id === document.id;
            });

            if (existingRun) {
                const previous = existingRun.result as {
                    document_id?: string;
                    extraction?: unknown;
                } | null;
                if (previous?.extraction) {
                    const extraction = contractExtractionSchema.parse(previous.extraction);
                    // Repair facts if a prior version persisted the successful run
                    // before its evidence-fact writes completed.
                    await db.transaction(async (tx) => {
                        await tx
                            .delete(evidenceFacts)
                            .where(
                                and(
                                    eq(evidenceFacts.sourceType, "document"),
                                    eq(evidenceFacts.sourceId, document.id),
                                ),
                            );
                        if (extraction.claims.length) {
                            await tx.insert(evidenceFacts).values(
                                extraction.claims.map((claim) => ({
                                    workspaceId: document.workspaceId,
                                    sourceType: "document",
                                    sourceId: document.id,
                                    factType: claim.field,
                                    value: claim.value,
                                    confidence: String(claim.confidence),
                                    sourceExcerpt: claim.source_excerpt,
                                    aiRunId: existingRun.id,
                                })),
                            );
                        }
                    });
                    return {
                        run: existingRun,
                        extraction,
                        sourceLength: text.length,
                        generatedAt: existingRun.createdAt.toISOString(),
                    };
                }
            }

            const prompt = `You are Settle's contract evidence extraction engine. Extract only facts explicitly supported by the source. Do not guess.\n\nSOURCE DOCUMENT: ${document.filename}\nCONTENT:\n${text}\n\nReturn JSON matching this shape exactly: {"document_type":"contract|invoice|receipt|other","title":null,"parties":[{"name":"","role":""}],"currency":null,"total_amount":null,"effective_date":null,"governing_law":null,"payment_terms":{"due_days":null,"notes":null},"milestones":[{"name":"","amount":null,"due_date":null,"deliverables":[]}],"claims":[{"field":"","value":null,"confidence":0.0,"source_excerpt":""}],"summary":""}. Source excerpts must be verbatim short excerpts from the provided content.`;
            const runStart = new Date();
            try {
                const result = await requestProvider(prompt);
                const parsed = contractExtractionSchema.parse(result.parsed);
                const run = await db.transaction(async (tx) => {
                    const [createdRun] = await tx
                        .insert(aiRuns)
                        .values({
                            workspaceId: document.workspaceId,
                            task: "document.contract_extraction",
                            provider: env.AI_PROVIDER,
                            model: env.AI_MODEL,
                            promptVersion,
                            inputHash,
                            status: "SUCCEEDED",
                            result: { document_id: document.id, extraction: parsed },
                            tokensIn: result.tokensIn == null ? undefined : String(result.tokensIn),
                            tokensOut: result.tokensOut == null ? undefined : String(result.tokensOut),
                            latencyMs: String(result.latencyMs),
                        })
                        .returning();

                    await tx
                        .delete(evidenceFacts)
                        .where(
                            and(
                                eq(evidenceFacts.sourceType, "document"),
                                eq(evidenceFacts.sourceId, document.id),
                            ),
                        );
                    if (parsed.claims.length) {
                        await tx.insert(evidenceFacts).values(
                            parsed.claims.map((claim) => ({
                                workspaceId: document.workspaceId,
                                sourceType: "document",
                                sourceId: document.id,
                                factType: claim.field,
                                value: claim.value,
                                confidence: String(claim.confidence),
                                sourceExcerpt: claim.source_excerpt,
                                aiRunId: createdRun.id,
                            })),
                        );
                    }
                    return createdRun;
                });

                return {
                    run,
                    extraction: parsed,
                    sourceLength: text.length,
                    generatedAt: runStart.toISOString(),
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await db.insert(aiRuns).values({
                    workspaceId: document.workspaceId,
                    task: "document.contract_extraction",
                    provider: env.AI_PROVIDER,
                    model: env.AI_MODEL,
                    promptVersion,
                    inputHash,
                    status: "FAILED",
                    result: { document_id: document.id },
                    error: message.slice(0, 1000),
                    latencyMs: String(Date.now() - runStart.getTime()),
                });
                throw error;
            }
        },
        { ttlMs: Math.max(env.AI_TIMEOUT_MS + 120_000, 180_000), waitMs: 10_000 },
    );
}

export async function generateDisputeDefense(input: {
  workspaceId: string;
  dispute: unknown;
  evidence: unknown;
}) {
  const serialized = JSON.stringify(input);
  const inputHash = createHash("sha256").update(serialized).digest("hex");

  return withRedisLock(
    `settle:ai:defense:${input.workspaceId}:${inputHash}`,
    async () => {
      const existingRun = await db.query.aiRuns.findFirst({
        where: and(
          eq(aiRuns.workspaceId, input.workspaceId),
          eq(aiRuns.task, "dispute.defense_draft"),
          eq(aiRuns.provider, env.AI_PROVIDER),
          eq(aiRuns.model, env.AI_MODEL),
          eq(aiRuns.promptVersion, "dispute-defense-v1"),
          eq(aiRuns.inputHash, inputHash),
          eq(aiRuns.status, "SUCCEEDED"),
        ),
      });

      if (existingRun) {
        return {
          run: existingRun,
          result: defenseSchema.parse(existingRun.result),
        };
      }

      const prompt = `You are Settle's dispute defense assistant. Build a factual defense using ONLY the evidence supplied. Never invent delivery, acceptance, dates, amounts, or communications. If evidence is missing, list it. Return JSON: {"strength_score":0,"summary":"","defense_draft":"","claims":[{"claim":"","evidence_type":"","confidence":0}],"missing_evidence":[]}.\n\nDISPUTE AND EVIDENCE:\n${serialized}`;

      const result = await requestProvider(prompt);
      const parsed = defenseSchema.parse(result.parsed);

      const [run] = await db
        .insert(aiRuns)
        .values({
          workspaceId: input.workspaceId,
          task: "dispute.defense_draft",
          provider: env.AI_PROVIDER,
          model: env.AI_MODEL,
          promptVersion: "dispute-defense-v1",
          inputHash,
          status: "SUCCEEDED",
          result: parsed,
          tokensIn:
            result.tokensIn == null ? undefined : String(result.tokensIn),
          tokensOut:
            result.tokensOut == null ? undefined : String(result.tokensOut),
          latencyMs: String(result.latencyMs),
        })
        .returning();

      return { run, result: parsed };
    },
    { ttlMs: Math.max(env.AI_TIMEOUT_MS + 15_000, 60_000), waitMs: 10_000 },
  );
}


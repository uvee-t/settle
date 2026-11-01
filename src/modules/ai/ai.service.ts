import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { contractExtractionSchema } from "./contract-extraction.schema.js";
export { contractExtractionSchema } from "./contract-extraction.schema.js";
import { env } from "../../config/env.js";
import { ExternalServiceError, ValidationError } from "../../lib/errors.js";
import { db } from "../../db/client.js";
import { aiRuns, evidenceFacts } from "../../db/schema/ai.js";
import { documents } from "../../db/schema/core.js";
import { and, eq } from "drizzle-orm";
import { downloadStoredObject } from "../documents/document.service.js";
import { withRedisLock } from "../../lib/distributed-lock.js";
import { redis } from "../../lib/redis.js";

async function runTesseract(buffer: Buffer, extension: string) {
    const dir = await mkdtemp(join(tmpdir(), "settle-ocr-"));
    const input = join(dir, `input.${extension}`);
    try {
        await writeFile(input, buffer, { mode: 0o600 });
        return await new Promise<string>((resolve, reject) => {
            const child = spawn("tesseract", [input, "stdout", "-l", "eng"], {
                stdio: ["ignore", "pipe", "pipe"],
            });
            let output = "";
            let stderr = "";
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
                output += chunk;
                if (output.length > env.AI_MAX_INPUT_CHARS * 2) child.kill("SIGKILL");
            });
            child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
            child.on("error", (error: NodeJS.ErrnoException) => reject(
                new ExternalServiceError(
                    "OCR_UNAVAILABLE",
                    error.code === "ENOENT" ? "Image OCR is unavailable on this worker. Install Tesseract OCR and English language data." : "Image OCR could not start.",
                    422,
                    { retryable: false },
                ),
            ));
            child.on("close", (code) => {
                if (code !== 0) {
                    reject(new ValidationError(`Image OCR failed: ${stderr.slice(0, 300) || `tesseract exited with ${code}`}`));
                    return;
                }
                const text = output.slice(0, env.AI_MAX_INPUT_CHARS).trim();
                if (!text) {
                    reject(new ValidationError("No readable text was detected in this image. You can still attach it as evidence, but AI extraction cannot analyze it."));
                    return;
                }
                resolve(text);
            });
        });
    } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}

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

type AiProvider = "gemini" | "openai" | "groq";

type ProviderConfig = {
    provider: AiProvider;
    apiKey: string;
    model: string;
    baseUrl?: string;
};

type ProviderResult = {
    parsed: unknown;
    latencyMs: number;
    tokensIn?: number;
    tokensOut?: number;
    provider: AiProvider;
    model: string;
};

const rateLimitScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
if count > tonumber(ARGV[2]) then return {0, math.max(ttl, 1)} end
return {1, 0}
`;

function primaryProviderConfig(): ProviderConfig {
    return {
        provider: env.AI_PROVIDER,
        apiKey: env.AI_API_KEY ?? "",
        model: env.AI_MODEL,
        baseUrl: env.AI_BASE_URL,
    };
}

function fallbackProviderConfig(): ProviderConfig | undefined {
    if (env.AI_FALLBACK_PROVIDER === "none" || !env.AI_FALLBACK_API_KEY || !env.AI_FALLBACK_MODEL.trim()) return undefined;
    return {
        provider: env.AI_FALLBACK_PROVIDER,
        apiKey: env.AI_FALLBACK_API_KEY,
        model: env.AI_FALLBACK_MODEL,
        baseUrl: env.AI_FALLBACK_BASE_URL,
    };
}

function isRetryableProviderError(error: unknown): boolean {
    if (!(error instanceof ExternalServiceError)) return false;
    const details = error.details as { retryable?: boolean } | undefined;
    return details?.retryable === true;
}

function isFallbackEligibleProviderError(error: unknown): boolean {
    if (!(error instanceof ExternalServiceError)) return false;
    const details = error.details as { retryable?: boolean; providerStatus?: number } | undefined;
    // A 404 is not retried against the same provider, but a configured second
    // provider can still serve the request when the primary model/endpoint is
    // unavailable or misconfigured. Authentication and malformed-request errors
    // remain fail-fast to avoid masking credential or payload problems.
    return details?.retryable === true || details?.providerStatus === 404;
}

async function reserveProviderCapacity(provider: AiProvider) {
    const key = `settle:ai:rate:${provider}:${Math.floor(Date.now() / env.AI_RATE_LIMIT_WINDOW_MS)}`;
    const result = await redis.eval(
        rateLimitScript,
        1,
        key,
        String(env.AI_RATE_LIMIT_WINDOW_MS * 2),
        String(env.AI_RATE_LIMIT_MAX),
    ) as [number, number];
    if (Number(result[0]) !== 1) {
        const retryAfterMs = Math.max(Number(result[1]) || env.AI_RATE_LIMIT_WINDOW_MS, 1000);
        throw new ExternalServiceError(
            "AI_RATE_LIMITED",
            `Local AI rate limit reached for ${provider}; retry after ${Math.ceil(retryAfterMs / 1000)} seconds.`,
            429,
            { provider, retryable: true, retryAfterMs },
        );
    }
}

function retryAfterMs(response: Response, body: Record<string, any>): number | undefined {
    const header = response.headers.get("retry-after");
    if (header) {
        const seconds = Number(header);
        const delay = Number.isFinite(seconds) && seconds > 0
            ? seconds * 1000
            : Date.parse(header) - Date.now();
        if (Number.isFinite(delay) && delay > 0) return Math.ceil(delay);
    }
    const details = body.error?.details;
    if (Array.isArray(details)) {
        const retry = details.find((item: any) => typeof item?.retryDelay === "string")?.retryDelay;
        const match = typeof retry === "string" ? retry.match(/^(\d+(?:\.\d+)?)s$/) : null;
        if (match) return Math.ceil(Number(match[1]) * 1000);
    }
    return undefined;
}

async function requestSingleProvider(prompt: string, config: ProviderConfig): Promise<ProviderResult> {
    if (!config.apiKey) {
        throw new ExternalServiceError(
            "AI_NOT_CONFIGURED",
            `API key for ${config.provider} is not configured.`,
            503,
            { provider: config.provider, retryable: false },
        );
    }

    await reserveProviderCapacity(config.provider);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
    const started = Date.now();

    try {
        let response: Response;
        let body: Record<string, any>;

        if (config.provider === "gemini") {
            const base = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
            response = await fetch(
                `${base.replace(/\/$/, "")}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
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
            body = await response.json().catch(() => ({})) as Record<string, any>;
            if (!response.ok) {
                const retryable = response.status === 429 || response.status >= 500;
                const retryDelay = retryAfterMs(response, body);
                throw new ExternalServiceError(
                    "AI_PROVIDER_ERROR",
                    `AI provider request failed (${response.status}).`,
                    502,
                    { provider: config.provider, providerStatus: response.status, retryable, retryAfterMs: retryDelay },
                );
            }
            const text = body.candidates?.[0]?.content?.parts?.map((part: any) => part.text ?? "").join("") ?? "";
            return {
                parsed: parseJson(text),
                latencyMs: Date.now() - started,
                tokensIn: body.usageMetadata?.promptTokenCount,
                tokensOut: body.usageMetadata?.candidatesTokenCount,
                provider: config.provider,
                model: config.model,
            };
        }

        const base = config.baseUrl ?? (config.provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1");
        response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            signal: controller.signal,
            headers: {
                authorization: `Bearer ${config.apiKey}`,
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: config.model,
                temperature: 0.1,
                max_tokens: env.AI_MAX_OUTPUT_TOKENS,
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: "Return only valid JSON. Never invent facts. Use null when unknown." },
                    { role: "user", content: prompt },
                ],
            }),
        });
        body = await response.json().catch(() => ({})) as Record<string, any>;
        if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500;
            const retryDelay = retryAfterMs(response, body);
            throw new ExternalServiceError(
                "AI_PROVIDER_ERROR",
                `AI provider request failed (${response.status}).`,
                502,
                { provider: config.provider, providerStatus: response.status, retryable, retryAfterMs: retryDelay },
            );
        }
        const text = body.choices?.[0]?.message?.content ?? "";
        return {
            parsed: parseJson(text),
            latencyMs: Date.now() - started,
            tokensIn: body.usage?.prompt_tokens,
            tokensOut: body.usage?.completion_tokens,
            provider: config.provider,
            model: config.model,
        };
    } catch (error) {
        if (error instanceof ExternalServiceError || error instanceof ValidationError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
            throw new ExternalServiceError(
                "AI_TIMEOUT",
                "AI provider request timed out.",
                504,
                { provider: config.provider, retryable: true },
            );
        }
        throw new ExternalServiceError(
            "AI_PROVIDER_UNAVAILABLE",
            "AI provider is temporarily unavailable.",
            502,
            { provider: config.provider, retryable: true },
        );
    } finally {
        clearTimeout(timeout);
    }
}

async function requestProvider(prompt: string): Promise<ProviderResult> {
    if (!env.AI_ENABLED) {
        throw new ExternalServiceError("AI_DISABLED", "AI processing is disabled.", 503);
    }

    const primary = primaryProviderConfig();
    try {
        return await requestSingleProvider(prompt, primary);
    } catch (primaryError) {
        const fallback = fallbackProviderConfig();
        if (!fallback || fallback.provider === primary.provider || !isFallbackEligibleProviderError(primaryError)) {
            throw primaryError;
        }

        // Fallback handles rate limits, timeouts, provider availability/server
        // failures, and primary model/endpoint 404s. It does not retry malformed
        // requests or authentication failures.
        try {
            return await requestSingleProvider(prompt, fallback);
        } catch (fallbackError) {
            if (fallbackError instanceof ExternalServiceError) {
                throw new ExternalServiceError(
                    "AI_ALL_PROVIDERS_FAILED",
                    `Primary provider ${primary.provider} and fallback provider ${fallback.provider} are unavailable.`,
                    503,
                    {
                        primaryProvider: primary.provider,
                        fallbackProvider: fallback.provider,
                        primaryError: primaryError instanceof Error ? primaryError.message : "Primary provider failed",
                        fallbackError: fallbackError.message,
                        retryable: isRetryableProviderError(fallbackError),
                        retryAfterMs: (fallbackError.details as { retryAfterMs?: number } | undefined)?.retryAfterMs,
                    },
                );
            }
            throw fallbackError;
        }
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
    if (document.contentType === "image/png")
        return runTesseract(buffer, "png");
    if (document.contentType === "image/jpeg")
        return runTesseract(buffer, "jpg");
    if (document.contentType === "image/gif")
        return runTesseract(buffer, "gif");
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
                            provider: result.provider,
                            model: result.model,
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
          provider: result.provider,
          model: result.model,
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



const disputeCopilotSchema = z.object({
    case_summary: z.string().max(5000),
    buyer_intent: z.string().max(3000),
    sentiment: z.string().max(1000),
    risk_level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    risk_reasons: z.array(z.string()).max(12),
    evidence_strengths: z.array(z.string()).max(15),
    evidence_gaps: z.array(z.string()).max(15),
    contradictions: z.array(z.string()).max(12),
    recommended_actions: z.array(z.object({
        priority: z.enum(["NOW", "HIGH", "MEDIUM", "LOW"]),
        action: z.string(),
        rationale: z.string(),
    })).max(12),
    suggested_reply: z.string().max(5000),
    defense_strategy: z.string().max(8000),
    confidence: z.number().min(0).max(1),
    caveats: z.array(z.string()).max(12),
});

export async function generateDisputeCopilot(input: {
    workspaceId: string;
    dispute: unknown;
    messages: unknown;
    evidence?: unknown;
}) {
    const serialized = JSON.stringify(input);
    const inputHash = createHash("sha256").update(serialized).digest("hex");
    return withRedisLock(
        `settle:ai:dispute-copilot:${input.workspaceId}:${inputHash}`,
        async () => {
            const existing = await db.query.aiRuns.findFirst({
                where: and(
                    eq(aiRuns.workspaceId, input.workspaceId),
                    eq(aiRuns.task, "dispute.copilot"),
                    eq(aiRuns.promptVersion, "dispute-copilot-v1"),
                    eq(aiRuns.inputHash, inputHash),
                    eq(aiRuns.status, "SUCCEEDED"),
                ),
            });
            if (existing) return { run: existing, result: disputeCopilotSchema.parse(existing.result) };

            const prompt = `You are Settle's evidence-grounded dispute resolution copilot. Analyze the supplied PayPal dispute, actual conversation messages, and evidence. Never invent facts, dates, delivery, acceptance, amounts, policies, or messages. Distinguish verified facts from inference. If data is absent, say so. Do not provide legal advice or guarantee outcomes. Draft replies must be professional, factual, non-threatening, and must not claim evidence that is not present. Return only JSON matching this schema: {"case_summary":"","buyer_intent":"","sentiment":"","risk_level":"LOW|MEDIUM|HIGH|CRITICAL","risk_reasons":[],"evidence_strengths":[],"evidence_gaps":[],"contradictions":[],"recommended_actions":[{"priority":"NOW|HIGH|MEDIUM|LOW","action":"","rationale":""}],"suggested_reply":"","defense_strategy":"","confidence":0.0,"caveats":[]}\n\nINPUT:\n${serialized}`;
            const result = await requestProvider(prompt);
            const parsed = disputeCopilotSchema.parse(result.parsed);
            const [run] = await db.insert(aiRuns).values({
                workspaceId: input.workspaceId,
                task: "dispute.copilot",
                provider: result.provider,
                model: result.model,
                promptVersion: "dispute-copilot-v1",
                inputHash,
                status: "SUCCEEDED",
                result: parsed,
                tokensIn: result.tokensIn == null ? undefined : String(result.tokensIn),
                tokensOut: result.tokensOut == null ? undefined : String(result.tokensOut),
                latencyMs: String(result.latencyMs),
            }).returning();
            return { run, result: parsed };
        },
        { ttlMs: Math.max(env.AI_TIMEOUT_MS + 15_000, 60_000), waitMs: 10_000 },
    );
}

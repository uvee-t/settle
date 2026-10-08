import { createHash } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { db } from "../db/client.js";
import { idempotencyKeys } from "../db/schema/idempotency.js";
import { AppError } from "./errors.js";

const PROCESSING_LEASE_MS = 5 * 60 * 1000;
const COMPLETED_RETENTION_MS = 24 * 60 * 60 * 1000;

export function requestHash(request: FastifyRequest) {
    return createHash("sha256")
        .update(JSON.stringify(request.body ?? null))
        .digest("hex");
}

export async function getIdempotentResponse(
    request: FastifyRequest,
    operation: string,
) {
    const key = request.headers["idempotency-key"]?.toString();

    if (!key) {
        return null;
    }

    const row = await db.query.idempotencyKeys.findFirst({
        where: (t, { and, eq }) =>
            and(eq(t.key, key), eq(t.operation, operation)),
    });

    if (!row) {
        return null;
    }

    const hash = requestHash(request);

    if (row.requestHash !== hash) {
        throw new AppError(
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency-Key was reused with a different request body.",
            409,
        );
    }

    const now = new Date();

    /*
     * Expired records are eligible for a new processing attempt.
     * beginIdempotency() will remove the expired record atomically
     * before creating the new PROCESSING record.
     */
    if (row.expiresAt && row.expiresAt <= now) {
        return null;
    }

    /*
     * A completed request returns exactly the response that was
     * produced by the original request.
     */
    if (row.status === "COMPLETED" && row.response) {
        return row.response;
    }

    /*
     * Another request is currently processing this idempotency key.
     */
    throw new AppError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical request is already being processed.",
        409,
    );
}

export async function beginIdempotency(
    request: FastifyRequest,
    operation: string,
) {
    const key = request.headers["idempotency-key"]?.toString();

    if (!key) {
        return null;
    }

    const hash = requestHash(request);
    const now = new Date();

    /*
     * PROCESSING records use expiresAt as a short lease.
     *
     * If the application crashed while processing a request,
     * the stale record becomes reclaimable after the lease expires.
     */
    await db
        .delete(idempotencyKeys)
        .where(
            and(
                eq(idempotencyKeys.key, key),
                eq(idempotencyKeys.operation, operation),
                lte(idempotencyKeys.expiresAt, now),
            ),
        );

    const expiresAt = new Date(now.getTime() + PROCESSING_LEASE_MS);

    /*
     * The unique (key, operation) index makes this race-safe.
     *
     * Only one concurrent request can successfully create the
     * PROCESSING record.
     */
    const [row] = await db
        .insert(idempotencyKeys)
        .values({
            key,
            operation,
            requestHash: hash,
            status: "PROCESSING",
            expiresAt,
        })
        .onConflictDoNothing()
        .returning();

    if (row) {
        return {
            id: row.id,
            key,
            operation,
        };
    }

    /*
     * Another request won the race.
     *
     * Re-read the existing record so we can return either:
     * - the completed response
     * - IDEMPOTENCY_IN_PROGRESS
     */
    const existing = await getIdempotentResponse(request, operation);

    if (existing) {
        return existing;
    }

    throw new AppError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical request is already being processed.",
        409,
    );
}

export async function completeIdempotency(id: string, response: unknown) {
    const expiresAt = new Date(Date.now() + COMPLETED_RETENTION_MS);

    await db
        .update(idempotencyKeys)
        .set({
            status: "COMPLETED",
            response,
            expiresAt,
        })
        .where(
            and(
                eq(idempotencyKeys.id, id),
                eq(idempotencyKeys.status, "PROCESSING"),
            ),
        );
}

export async function releaseIdempotency(id: string) {
    await db
        .delete(idempotencyKeys)
        .where(
            and(
                eq(idempotencyKeys.id, id),
                eq(idempotencyKeys.status, "PROCESSING"),
            ),
        );
}

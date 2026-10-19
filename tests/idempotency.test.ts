import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindFirst, mockDelete, mockInsert, mockUpdate } = vi.hoisted(
    () => ({
        mockFindFirst: vi.fn(),
        mockDelete: vi.fn(),
        mockInsert: vi.fn(),
        mockUpdate: vi.fn(),
    }),
);

vi.mock("../src/db/client.js", () => ({
    db: {
        query: {
            idempotencyKeys: {
                findFirst: mockFindFirst,
            },
        },
        delete: mockDelete,
        insert: mockInsert,
        update: mockUpdate,
    },
}));

import {
    beginIdempotency,
    completeIdempotency,
    getIdempotentResponse,
    releaseIdempotency,
} from "../src/lib/idempotency.js";
import { AppError } from "../src/lib/errors.js";
import type { FastifyRequest } from "fastify";

function makeRequest(body: unknown, key = "test-idempotency-key") {
    return {
        body,
        headers: key ? { "idempotency-key": key } : {},
    } as FastifyRequest;
}

describe("Idempotency service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns null when no idempotency key is supplied", async () => {
        const result = await getIdempotentResponse(
            makeRequest({ amount: 100 }, ""),
            "invoice.create",
        );

        expect(result).toBeNull();
        expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it("returns the stored response for a completed matching request", async () => {
        const request = makeRequest({ amount: 100 });

        mockFindFirst.mockResolvedValue({
            key: "test-idempotency-key",
            operation: "invoice.create",
            requestHash: (
                await import("../src/lib/idempotency.js")
            ).requestHash(request),
            status: "COMPLETED",
            response: { invoiceId: "invoice-123" },
            expiresAt: new Date(Date.now() + 60_000),
        });

        await expect(
            getIdempotentResponse(request, "invoice.create"),
        ).resolves.toEqual({ invoiceId: "invoice-123" });
    });

    it("rejects reuse of a key with a different request body", async () => {
        const request = makeRequest({ amount: 200 });

        mockFindFirst.mockResolvedValue({
            key: "test-idempotency-key",
            operation: "invoice.create",
            requestHash: "different-request-hash",
            status: "COMPLETED",
            response: { invoiceId: "invoice-123" },
            expiresAt: new Date(Date.now() + 60_000),
        });

        await expect(
            getIdempotentResponse(request, "invoice.create"),
        ).rejects.toMatchObject({
            code: "IDEMPOTENCY_KEY_REUSED",
            statusCode: 409,
        });
    });

    it("rejects a request while the same key is processing", async () => {
        const request = makeRequest({ amount: 100 });

        const { requestHash } = await import("../src/lib/idempotency.js");

        mockFindFirst.mockResolvedValue({
            key: "test-idempotency-key",
            operation: "invoice.create",
            requestHash: requestHash(request),
            status: "PROCESSING",
            response: null,
            expiresAt: new Date(Date.now() + 60_000),
        });

        await expect(
            getIdempotentResponse(request, "invoice.create"),
        ).rejects.toMatchObject({
            code: "IDEMPOTENCY_IN_PROGRESS",
            statusCode: 409,
        });
    });

    it("creates a processing claim when the key is new", async () => {
        const request = makeRequest({ amount: 100 });

        mockDelete.mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
        });

        mockInsert.mockReturnValue({
            values: vi.fn().mockReturnValue({
                onConflictDoNothing: vi.fn().mockReturnValue({
                    returning: vi
                        .fn()
                        .mockResolvedValue([{ id: "idempotency-row-123" }]),
                }),
            }),
        });

        await expect(
            beginIdempotency(request, "invoice.create"),
        ).resolves.toEqual({
            id: "idempotency-row-123",
            key: "test-idempotency-key",
            operation: "invoice.create",
        });
    });

    it("stores the completed response and retention expiry", async () => {
        const where = vi.fn().mockResolvedValue(undefined);

        mockUpdate.mockReturnValue({
            set: vi.fn().mockReturnValue({ where }),
        });

        await completeIdempotency("idempotency-row-123", {
            invoiceId: "invoice-123",
        });

        expect(mockUpdate).toHaveBeenCalled();
        expect(where).toHaveBeenCalled();
    });

    it("releases a processing claim", async () => {
        const where = vi.fn().mockResolvedValue(undefined);

        mockDelete.mockReturnValue({
            where,
        });

        await releaseIdempotency("idempotency-row-123");

        expect(mockDelete).toHaveBeenCalled();
        expect(where).toHaveBeenCalled();
    });
});

import { describe, expect, it, vi } from "vitest";
import { PayPalDisputeAdapter } from "../src/modules/paypal/paypal.disputes.js";

describe("PayPal dispute transaction lookup", () => {
    it("queries using a 17-character seller transaction ID", async () => {
        const request = vi.fn().mockResolvedValue({ items: [] });
        const adapter = new PayPalDisputeAdapter({ request } as never);

        await adapter.listByTransaction("1AB23456CD789012E");

        expect(request).toHaveBeenCalledWith(
            "/v1/customer/disputes?disputed_transaction_id=1AB23456CD789012E",
        );
    });

    it("rejects order-like IDs before calling PayPal", async () => {
        const request = vi.fn();
        const adapter = new PayPalDisputeAdapter({ request } as never);

        await expect(adapter.listByTransaction("PP-R-XBR-10195327")).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
            statusCode: 400,
        });
        expect(request).not.toHaveBeenCalled();
    });
});

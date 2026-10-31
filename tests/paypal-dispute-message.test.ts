import { describe, expect, it, vi } from "vitest";
import { PayPalDisputeAdapter } from "../src/modules/paypal/paypal.disputes.js";

describe("PayPal dispute messaging", () => {
    it("sends message as a string in the PayPal message property", async () => {
        const request = vi.fn().mockResolvedValue({ status: "success" });
        const adapter = new PayPalDisputeAdapter({ request } as never);

        await adapter.sendMessage("PP-R-EXAMPLE", "  Please review the attached evidence.  ");

        expect(request).toHaveBeenCalledWith(
            "/v1/customer/disputes/PP-R-EXAMPLE/send-message",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: "Please review the attached evidence.",
                }),
            },
        );
    });
});

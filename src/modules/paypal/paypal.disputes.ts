import { paypalClient, PayPalClient } from "./paypal.client.js";
import { ValidationError } from "../../lib/errors.js";

export type PayPalDispute = {
    dispute_id: string;
    reason?: string;
    status?: string;
    dispute_state?: string;
    dispute_life_cycle_stage?: string;
    dispute_amount?: { currency_code: string; value: string };
    seller_response_due_date?: string;
    disputed_transactions?: Array<{
        seller_transaction_id?: string;
        [key: string]: unknown;
    }>;
    dispute_channel?: string;
    seller_protection_eligible?: boolean;
    seller_protection_type?: string;
    evidences?: Array<Record<string, unknown>>;
    allowed_response_options?: Record<string, unknown>;
    links?: Array<Record<string, unknown>>;
    [key: string]: unknown;
};

export class PayPalDisputeAdapter {
    constructor(private readonly client: PayPalClient = paypalClient) {}
    async listByTransaction(transactionId: string) {
        // PayPal's disputed_transaction_id filter expects the seller's 17-character
        // alphanumeric transaction ID, not an order, invoice, dispute, or local ID.
        if (!/^[A-Za-z0-9]{17}$/.test(transactionId)) {
            throw new ValidationError(
                "Enter the 17-character PayPal seller transaction ID from the completed payment. Do not use an order, invoice, or dispute ID.",
                { field: "transactionId", expected: "17 alphanumeric characters" },
            );
        }
        return this.client.request<{ items: PayPalDispute[] }>(
            `/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(transactionId)}`,
        );
    }

    async listRecent() {
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const all: PayPalDispute[] = [];
        let token: string | undefined;

        // PayPal paginates dispute listings. Bound pages to protect request duration.
        for (let page = 0; page < 10; page++) {
            const params = new URLSearchParams({
                start_time: start.toISOString(),
                page_size: "20",
            });

            if (token) {
                params.set("next_page_token", token);
            }

            const result = await this.client.request<{
                items?: PayPalDispute[];
                next_page_token?: string;
            }>(`/v1/customer/disputes?${params.toString()}`);

            all.push(...(result.items ?? []));
            token = result.next_page_token;

            if (!token || !result.items?.length) {
                break;
            }
        }

        return { items: all };
    }

    async get(disputeId: string) {
        return this.client.request<PayPalDispute>(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}`,
        );
    }

    async provideEvidence(
        disputeId: string,
        evidence: { evidence_type: string; notes?: string },
        files: Array<{
            name: string;
            contentType: string;
            content: Buffer;
        }> = [],
    ) {
        const boundary = `----settle-${crypto.randomUUID()}`;
        const parts: Buffer[] = [];
        const json = JSON.stringify({
            evidences: [
                {
                    ...evidence,
                    ...(files.length
                        ? {
                              documents: files.map((file) => ({
                                  name: file.name,
                              })),
                          }
                        : {}),
                },
            ],
        });
        parts.push(
            Buffer.from(
                `--${boundary}\r\nContent-Disposition: form-data; name="input"\r\nContent-Type: application/json\r\n\r\n${json}\r\n`,
            ),
        );
        files.forEach((file, index) => {
            const safeName = file.name.replace(/[\"\r\n]/g, "_");
            parts.push(
                Buffer.from(
                    `--${boundary}\r\nContent-Disposition: form-data; name="file${index + 1}"; filename="${safeName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
                ),
            );
            parts.push(file.content);
            parts.push(Buffer.from("\r\n"));
        });
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`,
            {
                method: "POST",
                headers: {
                    "Content-Type": `multipart/form-data; boundary=${boundary}`,
                },
                body: Buffer.concat(parts),
            },
        );
    }

    async sendMessage(disputeId: string, content: string) {
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: content.trim() }),
            },
        );
    }

    async makeOffer(disputeId: string, offer: Record<string, unknown>) {
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/make-offer`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(offer),
            },
        );
    }

    async acceptClaim(disputeId: string, payload: Record<string, unknown>) {
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
        );
    }

    async provideSupportingInfo(
        disputeId: string,
        payload: Record<string, unknown>,
    ) {
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-supporting-info`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
        );
    }

    async appeal(disputeId: string, payload: Record<string, unknown>) {
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/appeal`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            },
        );
    }

    async escalate(disputeId: string) {
        return this.client.request(
            `/v1/customer/disputes/${encodeURIComponent(disputeId)}/escalate`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            },
        );
    }
}

export const paypalDisputes = new PayPalDisputeAdapter();
export function workspacePayPalDisputes(client: PayPalClient) { return new PayPalDisputeAdapter(client); }

import { paypalClient } from "./paypal.client.js";

export class PayPalInvoiceAdapter {
    async get(invoiceId: string) {
        return paypalClient.request(
            `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
        );
    }

    async list(params = "") {
        return paypalClient.request(
            `/v2/invoicing/invoices${params ? `?${params}` : ""}`,
        );
    }

    async create(payload: Record<string, unknown>, requestId: string) {
        return paypalClient.request("/v2/invoicing/invoices", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "PayPal-Request-Id": requestId,
            },
            body: JSON.stringify(payload),
        });
    }

    async send(invoiceId: string, payload: Record<string, unknown> = {}) {
        return paypalClient.request(
            `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        );
    }

    async search(payload: Record<string, unknown>) {
        return paypalClient.request("/v2/invoicing/search-invoices", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
    }

    async remind(invoiceId: string, payload: Record<string, unknown> = {}) {
        return paypalClient.request(
            `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/remind`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        );
    }

    async cancel(invoiceId: string, payload: Record<string, unknown> = {}) {
        return paypalClient.request(
            `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/cancel`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        );
    }
}

export const paypalInvoices = new PayPalInvoiceAdapter();

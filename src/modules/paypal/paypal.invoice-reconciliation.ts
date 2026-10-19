import { workspacePayPalInvoices } from "./paypal.invoices.js";
import { getWorkspacePayPalClient } from "./paypal.workspace.js";

type PayPalInvoice = Record<string, unknown>;

type ReconciliationInput = {
    workspaceId?: string;
    reference?: string;
    recipientEmail?: string;
    amount?: string;
    currency?: string;
};

export class PayPalInvoiceReconciliationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PayPalInvoiceReconciliationError";
    }
}

export async function findExistingPayPalInvoice(
    input: ReconciliationInput,
): Promise<PayPalInvoice | null> {
    if (!input.reference) {
        return null;
    }

    const searchPayload: Record<string, unknown> = {
        reference: input.reference,
    };

    if (!input.workspaceId) throw new PayPalInvoiceReconciliationError("Workspace is required for PayPal invoice reconciliation.");
    const adapter = workspacePayPalInvoices(await getWorkspacePayPalClient(input.workspaceId));
    const result = (await adapter.search(searchPayload)) as Record<
        string,
        unknown
    >;

    const items = Array.isArray(result.items)
        ? (result.items as PayPalInvoice[])
        : [];

    if (items.length === 0) {
        return null;
    }

    const matching = items.filter((invoice) => {
        const amount = invoice.amount as Record<string, unknown> | undefined;

        const invoiceAmount =
            typeof amount?.value === "string" ? amount.value : undefined;

        const invoiceCurrency =
            typeof amount?.currency_code === "string"
                ? amount.currency_code
                : undefined;

        return (
            (!input.amount || invoiceAmount === input.amount) &&
            (!input.currency ||
                invoiceCurrency?.toUpperCase() === input.currency.toUpperCase())
        );
    });

    if (matching.length === 1) {
        return matching[0];
    }

    if (matching.length > 1) {
        throw new PayPalInvoiceReconciliationError(
            `Multiple PayPal invoices matched reference "${input.reference}".`,
        );
    }

    return null;
}

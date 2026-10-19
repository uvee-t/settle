import type { PayPalClient } from "./paypal.client.js";

export class PayPalReportingAdapter {
  constructor(private readonly client: PayPalClient) {}

  transactions(input: { startDate: string; endDate: string; pageSize?: number; fields?: string; page?: number }) {
    const params = new URLSearchParams({
      start_date: input.startDate,
      end_date: input.endDate,
      page_size: String(input.pageSize ?? 100),
      fields: input.fields ?? "all",
      page: String(input.page ?? 1),
    });
    return this.client.request(`/v1/reporting/transactions?${params.toString()}`);
  }
}

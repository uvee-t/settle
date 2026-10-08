import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { invoices } from "../../db/schema/invoices.js";
import { payments } from "../../db/schema/core.js";

export async function buildCashFlowForecast(workspaceId: string, days: number) {
  const now = new Date();
  const horizon = new Date(now.getTime() + days * 86_400_000);

  const [invoiceRows, paymentRows] = await Promise.all([
    db.query.invoices.findMany({ where: eq(invoices.workspaceId, workspaceId) }),
    db.query.payments.findMany({ where: eq(payments.workspaceId, workspaceId) }),
  ]);

  const currencies = new Set([
    ...invoiceRows.map((invoice) => invoice.currency),
    ...paymentRows.map((payment) => payment.currency),
  ]);

  const forecast = [...currencies].sort().map((currency) => {
    const open = invoiceRows.filter((invoice) =>
      invoice.currency === currency &&
      !["paid", "cancelled", "refunded"].includes(invoice.status),
    );

    const due = open
      .filter((invoice) => invoice.dueAt && invoice.dueAt >= now && invoice.dueAt <= horizon)
      .reduce((sum, invoice) => sum + Number(invoice.amount), 0);

    const overdue = open
      .filter((invoice) => invoice.dueAt && invoice.dueAt < now)
      .reduce((sum, invoice) => sum + Number(invoice.amount), 0);

    const historyStart = new Date(now.getTime() - 30 * 86_400_000);
    const collected = paymentRows
      .filter((payment) => payment.currency === currency && payment.status === "succeeded" && payment.capturedAt && payment.capturedAt >= historyStart && payment.capturedAt <= now)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    return {
      currency,
      expected_inflow: due.toFixed(2),
      overdue_receivables: overdue.toFixed(2),
      collected_last_30_days: collected.toFixed(2),
      net_expected_inflow: due.toFixed(2),
    };
  });

  return {
    generated_at: now.toISOString(),
    horizon_days: days,
    horizon_ends_at: horizon.toISOString(),
    forecast,
  };
}

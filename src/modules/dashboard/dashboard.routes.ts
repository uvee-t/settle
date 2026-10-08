import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { invoices } from "../../db/schema/invoices.js";
import { disputes } from "../../db/schema/disputes.js";
import { contracts, milestones } from "../../db/schema/core.js";
import { requireWorkspace } from "../auth/auth.plugin.js";
import { buildCashFlowForecast } from "./cashflow.service.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/v1/dashboard/summary", { preHandler: requireWorkspace }, async (request) => {
    const workspaceId = request.auth!.workspaceId!;
    const [invoiceRows, disputeRows, workspaceContracts] = await Promise.all([
      db.query.invoices.findMany({ where: eq(invoices.workspaceId, workspaceId) }),
      db.query.disputes.findMany({ where: eq(disputes.workspaceId, workspaceId) }),
      db.query.contracts.findMany({ where: eq(contracts.workspaceId, workspaceId) }),
    ]);
    const contractIds = new Set(workspaceContracts.map((contract) => contract.id));
    const milestoneRows = (await db.query.milestones.findMany({ where: eq(milestones.status, "pending") }))
      .filter((milestone) => contractIds.has(milestone.contractId));

    const byCurrency = new Map<string, { outstanding: number; collected: number; total: number }>();
    for (const invoice of invoiceRows) {
      const current = byCurrency.get(invoice.currency) ?? { outstanding: 0, collected: 0, total: 0 };
      current.total += 1;
      if (!["paid", "cancelled", "refunded"].includes(invoice.status)) current.outstanding += Number(invoice.amount);
      if (invoice.status === "paid") current.collected += Number(invoice.amount);
      byCurrency.set(invoice.currency, current);
    }

    const currencies = [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b));
    const primary = currencies[0];

    return {
      currency: currencies.length === 1 ? primary?.[0] : null,
      invoices: {
        total: invoiceRows.length,
        outstanding_amount: primary ? primary[1].outstanding.toFixed(2) : "0.00",
        collected_amount: primary ? primary[1].collected.toFixed(2) : "0.00",
        by_currency: Object.fromEntries(currencies.map(([currency, value]) => [currency, {
          total: value.total,
          outstanding_amount: value.outstanding.toFixed(2),
          collected_amount: value.collected.toFixed(2),
        }])),
      },
      disputes: {
        total: disputeRows.length,
        open: disputeRows.filter((d) => !["RESOLVED", "CLOSED"].includes(d.status ?? "")).length,
      },
      milestones: { pending: milestoneRows.length },
    };
  });

  app.get("/v1/dashboard/cash-flow", { preHandler: requireWorkspace }, async (request) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) }).parse(request.query);
    return buildCashFlowForecast(request.auth!.workspaceId!, query.days);
  });
}

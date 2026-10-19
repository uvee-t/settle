import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireWorkspace } from "../auth/auth.plugin.js";
import { getWorkspacePayPalClient } from "./paypal.workspace.js";
import { PayPalReportingAdapter } from "./paypal.reporting.js";

const querySchema = z.object({
  start_date: z.iso.datetime({ offset: true }),
  end_date: z.iso.datetime({ offset: true }),
  page_size: z.coerce.number().int().min(1).max(500).default(100),
  page: z.coerce.number().int().min(1).default(1),
  fields: z.enum(["all", "transaction_info", "payer_info", "shipping_info", "auction_info", "cart_info", "incentive_info", "store_info", "instrument_info"]).default("all"),
}).refine((value) => new Date(value.start_date) < new Date(value.end_date), { message: "start_date must be before end_date", path: ["start_date"] });

export async function paypalReportingRoutes(app: FastifyInstance) {
  app.get("/v1/paypal/reports/transactions", { preHandler: requireWorkspace }, async (request) => {
    const query = querySchema.parse(request.query);
    const client = await getWorkspacePayPalClient(request.auth!.workspaceId!);
    return new PayPalReportingAdapter(client).transactions({
      startDate: query.start_date,
      endDate: query.end_date,
      pageSize: query.page_size,
      page: query.page,
      fields: query.fields,
    });
  });
}

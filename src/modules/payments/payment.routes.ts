import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { payments } from "../../db/schema/core.js";
import { invoices } from "../../db/schema/invoices.js";
import { requireRole, requireWorkspace } from "../auth/auth.plugin.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { writeAudit } from "../../lib/audit.js";

const createPaymentSchema = z.object({
  invoice_id: z.uuid(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/), currency: z.string().length(3),
  provider: z.string().default("paypal"), provider_payment_id: z.string().max(255).optional(),
  provider_order_id: z.string().max(255).optional(), method: z.string().max(50).optional(),
});
const statusSchema = z.object({ status: z.enum(["created", "processing", "succeeded", "failed", "refunded"]), failure_reason: z.string().max(500).optional() });

const paymentTransitions: Record<string, string[]> = {
  created: ["processing", "failed"],
  processing: ["succeeded", "failed"],
  succeeded: ["refunded"],
  failed: ["processing"],
  refunded: [],
};

export async function paymentRoutes(app: FastifyInstance) {
  app.get("/v1/payments", { preHandler: requireWorkspace }, async (request) => db.query.payments.findMany({ where: eq(payments.workspaceId, request.auth!.workspaceId!), orderBy: [desc(payments.createdAt)] }));

  app.get("/v1/payments/:id", { preHandler: requireWorkspace }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const payment = await db.query.payments.findFirst({ where: and(eq(payments.id, id), eq(payments.workspaceId, request.auth!.workspaceId!)) });
    if (!payment) throw new NotFoundError("Payment not found.");
    return payment;
  });

  app.post("/v1/payments", { preHandler: requireRole("owner", "admin", "member") }, async (request, reply) => {
    const body = createPaymentSchema.parse(request.body);
    const workspaceId = request.auth!.workspaceId!;
    const invoice = await db.query.invoices.findFirst({ where: and(eq(invoices.id, body.invoice_id), eq(invoices.workspaceId, workspaceId)) });
    if (!invoice) throw new NotFoundError("Invoice not found.");
    if (["cancelled", "refunded"].includes(invoice.status)) throw new ValidationError("A cancelled or refunded invoice cannot receive a payment.");
    if (body.currency.toUpperCase() !== invoice.currency) throw new ValidationError("Payment currency must match invoice currency.");

    const [payment] = await db.insert(payments).values({
      workspaceId, invoiceId: invoice.id, provider: body.provider, providerPaymentId: body.provider_payment_id,
      providerOrderId: body.provider_order_id, method: body.method, status: "created", amount: body.amount, currency: body.currency.toUpperCase(),
    }).returning();
    await writeAudit({ workspaceId, actorType: "user", actorId: request.auth!.userId, action: "payment.created", resourceType: "payment", resourceId: payment.id, requestId: request.id, after: payment });
    return reply.code(201).send(payment);
  });

  app.post("/v1/payments/:id/status", { preHandler: requireRole("owner", "admin") }, async (request) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = statusSchema.parse(request.body);
    const workspaceId = request.auth!.workspaceId!;
    const existing = await db.query.payments.findFirst({ where: and(eq(payments.id, id), eq(payments.workspaceId, workspaceId)) });
    if (!existing) throw new NotFoundError("Payment not found.");
    if (!paymentTransitions[existing.status]?.includes(body.status) && existing.status !== body.status) {
      throw new ValidationError(`Payment cannot transition from ${existing.status} to ${body.status}.`);
    }

    const [updated] = await db.transaction(async (tx) => {
      const now = new Date();
      const [payment] = await tx.update(payments).set({
        status: body.status, failureReason: body.failure_reason,
        capturedAt: body.status === "succeeded" ? (existing.capturedAt ?? now) : existing.capturedAt,
        refundedAt: body.status === "refunded" ? (existing.refundedAt ?? now) : existing.refundedAt, updatedAt: now,
      }).where(eq(payments.id, id)).returning();
      if (payment.invoiceId) {
        const invoiceStatus = body.status === "succeeded" ? "paid" : body.status === "refunded" ? "refunded" : undefined;
        if (invoiceStatus) await tx.update(invoices).set({ status: invoiceStatus, paidAt: invoiceStatus === "paid" ? now : undefined, updatedAt: now }).where(eq(invoices.id, payment.invoiceId));
      }
      return [payment] as const;
    });
    await writeAudit({ workspaceId, actorType: "user", actorId: request.auth!.userId, action: `payment.${body.status}`, resourceType: "payment", resourceId: id, requestId: request.id, before: existing, after: updated });
    return updated;
  });
}

import { num, toDate, startOfDay } from "./format.js";

/** Endpoints return either a bare array or an { items } envelope. */
export const asList = (d) =>
  Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : [];

const pick = (o, ...keys) => {
  for (const k of keys)
    if (o?.[k] !== undefined && o?.[k] !== null) return o[k];
  return undefined;
};

export const SUCCESSFUL_PAYMENT = new Set([
  "succeeded",
  "completed",
  "paid",
  "captured",
  "success",
  "settled",
  "reconciled",
  "processed",
]);
const CLOSED_INVOICE = new Set([
  "cancelled",
  "canceled",
  "void",
  "voided",
  "refunded",
]);

export function normClient(c) {
  return {
    id: c.id,
    name: c.name || pick(c, "companyName", "company_name") || "Unnamed client",
    company: pick(c, "companyName", "company_name") || "",
    email: c.email || "",
    country: pick(c, "countryCode", "country_code") || "",
    createdAt: pick(c, "createdAt", "created_at"),
    raw: c,
  };
}

export function normContract(c) {
  return {
    id: c.id,
    title: c.title || "Untitled contract",
    clientId: pick(c, "clientId", "client_id"),
    status: String(c.status || "draft").toLowerCase(),
    amount: num(pick(c, "totalAmount", "total_amount")),
    currency: c.currency || "USD",
    startsAt: pick(c, "startsAt", "starts_at"),
    endsAt: pick(c, "endsAt", "ends_at"),
    createdAt: pick(c, "createdAt", "created_at"),
    raw: c,
  };
}

export function normPayment(p) {
  const status = String(p.status || "unknown").toLowerCase();
  return {
    id: p.id,
    invoiceId: pick(p, "invoiceId", "invoice_id"),
    amount: num(p.amount),
    currency: p.currency || "USD",
    status,
    ok: SUCCESSFUL_PAYMENT.has(status),
    method: p.method || p.provider || "",
    reference:
      pick(p, "providerReference", "provider_reference", "reference") || "",
    at: toDate(
      pick(
        p,
        "paidAt",
        "paid_at",
        "receivedAt",
        "received_at",
        "createdAt",
        "created_at",
      ),
    ),
    createdAt: pick(p, "createdAt", "created_at"),
    raw: p,
  };
}

export function normInvoice(i) {
  return {
    id: i.id,
    number: pick(i, "invoiceNumber", "invoice_number") || "Invoice",
    reference: i.reference || "",
    clientId: pick(i, "clientId", "client_id"),
    amount: num(i.amount),
    currency: i.currency || "USD",
    rawStatus: String(i.status || "draft").toLowerCase(),
    dueAt: toDate(pick(i, "dueAt", "due_at")),
    createdAt: toDate(pick(i, "createdAt", "created_at")),
    sentAt: toDate(pick(i, "sentAt", "sent_at")),
    paidAt: toDate(pick(i, "paidAt", "paid_at")),
    updatedAt: toDate(pick(i, "updatedAt", "updated_at")),
    providerId: pick(i, "providerInvoiceId", "provider_invoice_id") || "",
    items: i.items || [],
    raw: i,
  };
}

/**
 * Joins invoices with payments and clients and derives balance and a single display status.
 * Status categories are mutually exclusive: cancelled, draft, paid, overdue, partial, open.
 */
export function buildLedger(
  { invoices = [], payments = [], clients = [], contracts = [] },
  now = new Date(),
) {
  const today = startOfDay(now);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const payByInvoice = new Map();
  for (const p of payments) {
    if (!p.ok || !p.invoiceId) continue;
    if (!payByInvoice.has(p.invoiceId)) payByInvoice.set(p.invoiceId, []);
    payByInvoice.get(p.invoiceId).push(p);
  }

  const rows = invoices.map((inv) => {
    const pays = payByInvoice.get(inv.id) || [];
    const recorded = pays.reduce((s, p) => s + p.amount, 0);
    const markedPaid = inv.rawStatus === "paid";
    const paid = Math.min(
      inv.amount,
      markedPaid ? Math.max(recorded, inv.amount) : recorded,
    );
    const closed = CLOSED_INVOICE.has(inv.rawStatus);
    const isDraft = inv.rawStatus === "draft";
    const balance = closed || isDraft ? 0 : Math.max(0, inv.amount - paid);
    let status;
    if (closed) status = "cancelled";
    else if (isDraft) status = "draft";
    else if (balance <= 0) status = "paid";
    else if (inv.dueAt && startOfDay(inv.dueAt) < today) status = "overdue";
    else if (paid > 0) status = "partial";
    else status = "sent";
    // Payment events used for collections charts. Falls back to the invoice itself when no payment rows exist.
    const events = pays.length
      ? pays
          .filter((p) => p.at)
          .map((p) => ({
            at: p.at,
            amount: p.amount,
            currency: p.currency,
            invoiceId: inv.id,
            source: "payment",
          }))
      : markedPaid
        ? [
            {
              at: inv.paidAt || inv.updatedAt || inv.createdAt,
              amount: inv.amount,
              currency: inv.currency,
              invoiceId: inv.id,
              source: "invoice",
            },
          ].filter((e) => e.at)
        : [];
    return {
      ...inv,
      status,
      paid,
      balance,
      open: balance > 0,
      events,
      payments: pays,
      client: clientById.get(inv.clientId) || null,
    };
  });

  const openStandalone = payments.filter(
    (p) => p.ok && (!p.invoiceId || !rows.some((r) => r.id === p.invoiceId)),
  );
  const events = [
    ...rows.flatMap((r) => r.events),
    ...openStandalone
      .filter((p) => p.at)
      .map((p) => ({
        at: p.at,
        amount: p.amount,
        currency: p.currency,
        invoiceId: p.invoiceId,
        source: "payment",
      })),
  ];
  return { invoices: rows, events, clients, contracts, payments };
}

import test from "node:test";
import assert from "node:assert/strict";
import { buildLedger, normInvoice, normPayment, normClient } from "./models.js";
import {
  agingBuckets,
  cashFlowSeries,
  statusDistribution,
  currenciesOf,
  clientDelays,
} from "./analytics.js";
import { toCsv, dueLabel } from "./format.js";

const NOW = new Date("2026-10-30T10:00:00Z");
const day = (n) => new Date(NOW.getTime() + n * 864e5).toISOString();
const inv = (id, over) =>
  normInvoice({
    id,
    invoiceNumber: id,
    clientId: "c1",
    amount: "1000",
    currency: "USD",
    status: "sent",
    dueAt: day(10),
    createdAt: day(-20),
    sentAt: day(-20),
    ...over,
  });
const pay = (invoiceId, amount, over) =>
  normPayment({
    id: `${invoiceId}-${amount}`,
    invoiceId,
    amount: String(amount),
    currency: "USD",
    status: "completed",
    createdAt: day(-2),
    ...over,
  });
const ledger = (invoices, payments = []) =>
  buildLedger(
    { invoices, payments, clients: [normClient({ id: "c1", name: "Acme" })] },
    NOW,
  );

test("partial payment reduces balance and status is partial", () => {
  const [r] = ledger([inv("a")], [pay("a", 400)]).invoices;
  assert.equal(r.paid, 400);
  assert.equal(r.balance, 600);
  assert.equal(r.status, "partial");
});

test("past due with a balance is overdue even when part-paid (no double counting)", () => {
  const [r] = ledger([inv("a", { dueAt: day(-5) })], [pay("a", 100)]).invoices;
  assert.equal(r.status, "overdue");
  assert.equal(r.balance, 900);
});

test("drafts and cancelled invoices carry no balance", () => {
  const rows = ledger([
    inv("d", { status: "draft" }),
    inv("x", { status: "cancelled" }),
  ]).invoices;
  assert.deepEqual(
    rows.map((r) => r.balance),
    [0, 0],
  );
  assert.deepEqual(
    rows.map((r) => r.status),
    ["draft", "cancelled"],
  );
});

test("failed payments are not counted as paid", () => {
  const [r] = ledger(
    [inv("a")],
    [pay("a", 1000, { status: "failed" })],
  ).invoices;
  assert.equal(r.paid, 0);
  assert.equal(r.balance, 1000);
});

test("invoice marked paid without payment rows is treated as paid in full", () => {
  const l = ledger([inv("a", { status: "paid", paidAt: day(-1) })]);
  assert.equal(l.invoices[0].balance, 0);
  assert.equal(l.events.length, 1);
});

test("overpayment never produces a negative balance", () => {
  const [r] = ledger([inv("a")], [pay("a", 1500)]).invoices;
  assert.equal(r.balance, 0);
  assert.equal(r.status, "paid");
});

test("status distribution counts each invoice once and excludes cancelled", () => {
  const rows = ledger(
    [inv("a"), inv("b", { dueAt: day(-3) }), inv("c", { status: "cancelled" })],
    [],
  ).invoices;
  const d = statusDistribution(rows);
  assert.equal(
    d.reduce((s, x) => s + x.count, 0),
    2,
  );
  assert.equal(d.find((x) => x.key === "overdue").count, 1);
});

test("aging buckets total equals open balance", () => {
  const rows = ledger([
    inv("a", { dueAt: day(5) }),
    inv("b", { dueAt: day(-10) }),
    inv("c", { dueAt: day(-45) }),
    inv("d", { dueAt: day(-90) }),
  ]).invoices;
  const b = agingBuckets(rows, NOW);
  assert.deepEqual(
    b.map((x) => x.count),
    [1, 1, 1, 1],
  );
  assert.equal(
    b.reduce((s, x) => s + x.total, 0),
    4000,
  );
});

test("forecast puts overdue in the current week, never as expected, and totals reconcile", () => {
  const rows = ledger([
    inv("a", { dueAt: day(-5) }),
    inv("b", { dueAt: day(15) }),
  ]).invoices;
  const s = cashFlowSeries(rows, [], { past: 2, future: 6 }, NOW);
  const cur = s.find((r) => r.k === 0);
  assert.equal(cur.overdue, 1000);
  assert.equal(
    s.reduce((t, r) => t + (r.expected || 0), 0),
    1000,
  );
  assert.equal(
    s.filter((r) => r.k < 0).every((r) => r.expected === null),
    true,
  );
});

test("client delay needs two paid samples and uses the median", () => {
  const paid = (id, late) =>
    inv(id, { status: "paid", dueAt: day(-30), paidAt: day(-30 + late) });
  const rows = ledger([paid("a", 4), paid("b", 10), paid("c", 6)]).invoices;
  assert.equal(clientDelays(rows).get("c1"), 6);
  assert.equal(clientDelays(ledger([paid("a", 4)]).invoices).size, 0);
});

test("currencies are never merged", () => {
  const rows = ledger([
    inv("a"),
    inv("b", { currency: "EUR" }),
    inv("c", { currency: "EUR" }),
  ]).invoices;
  assert.deepEqual(currenciesOf(rows), ["EUR", "USD"]);
});

test("CSV escapes quotes, commas, newlines and neutralizes formulas", () => {
  const csv = toCsv(
    [{ a: 'He said "hi", ok', b: "=SUM(A1)", c: "line1\nline2" }],
    [
      { label: "A", value: (r) => r.a },
      { label: "B", value: (r) => r.b },
      { label: "C", value: (r) => r.c },
    ],
  );
  assert.equal(csv, 'A,B,C\r\n"He said ""hi"", ok",\'=SUM(A1),"line1\nline2"');
});

test("dueLabel wording", () => {
  assert.equal(dueLabel(day(-3), NOW), "3 days late");
  assert.equal(dueLabel(day(1), NOW), "In 1 day");
});

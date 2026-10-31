import { startOfDay, daysBetween } from "./format.js";

const DAY = 864e5;

/** The workspace's working currency: the API's summary currency, else the most frequent invoice currency. */
export function currenciesOf(invoices) {
  const count = {};
  for (const i of invoices) count[i.currency] = (count[i.currency] || 0) + 1;
  return Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
}

export const inCurrency = (list, currency) =>
  list.filter((x) => x.currency === currency);

export function rangeStart(days, now = new Date()) {
  return new Date(startOfDay(now).getTime() - days * DAY);
}

export const sumEvents = (events, from, to) =>
  events
    .filter((e) => e.at > from && e.at <= to)
    .reduce((s, e) => s + e.amount, 0);

/** Sums the open balance as it stood at a past date. Only possible for invoices with a known creation date. */
export function outstandingAt(invoices, at) {
  let total = 0;
  for (const i of invoices) {
    if (i.status === "draft" || i.status === "cancelled") continue;
    const issued = i.sentAt || i.createdAt;
    if (!issued || issued > at) continue;
    const paidBy = i.events
      .filter((e) => e.at <= at)
      .reduce((s, e) => s + e.amount, 0);
    total += Math.max(0, i.amount - paidBy);
  }
  return total;
}

export function agingBuckets(invoices, now = new Date()) {
  const b = [
    {
      key: "current",
      label: "Not yet due",
      total: 0,
      count: 0,
      color: "var(--cyan)",
    },
    {
      key: "d30",
      label: "1–30 days late",
      total: 0,
      count: 0,
      color: "var(--orange)",
    },
    {
      key: "d60",
      label: "31–60 days late",
      total: 0,
      count: 0,
      color: "var(--pink)",
    },
    {
      key: "d61",
      label: "61+ days late",
      total: 0,
      count: 0,
      color: "var(--danger)",
    },
  ];
  for (const i of invoices) {
    if (!i.open) continue;
    const late = i.dueAt ? daysBetween(now, i.dueAt) : 0;
    const k = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : 3;
    b[k].total += i.balance;
    b[k].count += 1;
  }
  return b;
}

export const STATUS_META = [
  { key: "overdue", label: "Overdue", color: "var(--danger)" },
  { key: "partial", label: "Partially paid", color: "var(--violet)" },
  { key: "sent", label: "Sent, not yet due", color: "var(--cyan)" },
  { key: "paid", label: "Paid", color: "var(--success)" },
  { key: "draft", label: "Draft", color: "var(--border-strong)" },
];

export function statusDistribution(invoices) {
  const acc = Object.fromEntries(
    STATUS_META.map((s) => [s.key, { count: 0, total: 0 }]),
  );
  for (const i of invoices) {
    if (!acc[i.status]) continue; // cancelled invoices are excluded from the distribution
    acc[i.status].count += 1;
    acc[i.status].total += i.amount;
  }
  return STATUS_META.map((s) => ({ ...s, ...acc[s.key] }));
}

/** Weekly or monthly buckets ending now: invoiced vs collected. */
export function collectionBuckets(
  invoices,
  events,
  { range, mode },
  now = new Date(),
) {
  const end = startOfDay(now).getTime() + DAY;
  const out = [];
  if (mode === "monthly") {
    const n = Math.max(3, Math.ceil(range / 30));
    const d = new Date(now);
    for (let i = n - 1; i >= 0; i--) {
      const s = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const e = new Date(d.getFullYear(), d.getMonth() - i + 1, 1);
      out.push({
        from: s,
        to: e,
        label:
          s.toLocaleDateString(undefined, { month: "short" }) +
          (i === 0 ? "*" : ""),
      });
    }
  } else {
    const n = Math.min(13, Math.ceil(range / 7));
    for (let i = n - 1; i >= 0; i--) {
      const e = new Date(end - i * 7 * DAY);
      const s = new Date(e.getTime() - 7 * DAY);
      out.push({
        from: s,
        to: e,
        label: e.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        }),
      });
    }
  }
  return out.map((b) => ({
    ...b,
    invoiced: invoices
      .filter(
        (i) =>
          i.status !== "draft" &&
          i.status !== "cancelled" &&
          (i.sentAt || i.createdAt) >= b.from &&
          (i.sentAt || i.createdAt) < b.to,
      )
      .reduce((s, i) => s + i.amount, 0),
    collected: events
      .filter((e) => e.at >= b.from && e.at < b.to)
      .reduce((s, e) => s + e.amount, 0),
  }));
}

/**
 * Deterministic cash-flow model, shown to the user as such.
 *  - Past weeks: actual collections.
 *  - Future weeks: each open balance lands in the week of its due date.
 *  - Balances already past due are carried into week 1 as "overdue", not as expected.
 * An optional per-client delay (median days late of that client's paid invoices) shifts the expected date.
 */
export function cashFlowSeries(
  invoices,
  events,
  { past = 8, future = 8, useDelay = true },
  now = new Date(),
) {
  const today = startOfDay(now).getTime();
  const weekStart = (k) => today + k * 7 * DAY; // k = 0 is the current week starting today
  const delay = useDelay ? clientDelays(invoices) : new Map();
  const rows = [];
  for (let k = -past; k < future; k++) {
    const from = weekStart(k);
    const to = from + 7 * DAY;
    const actual =
      k < 0
        ? events
            .filter((e) => e.at.getTime() >= from && e.at.getTime() < to)
            .reduce((s, e) => s + e.amount, 0)
        : k === 0
          ? events
              .filter((e) => e.at.getTime() >= from && e.at.getTime() < to)
              .reduce((s, e) => s + e.amount, 0)
          : null;
    rows.push({
      k,
      from: new Date(from),
      to: new Date(to),
      actual,
      expected: k >= 0 ? 0 : null,
      overdue: k >= 0 ? 0 : null,
      expectedCount: 0,
      overdueCount: 0,
    });
  }
  for (const i of invoices) {
    if (!i.open) continue;
    const late = i.dueAt && startOfDay(i.dueAt).getTime() < today;
    if (late) {
      const r = rows.find((x) => x.k === 0);
      r.overdue += i.balance;
      r.overdueCount += 1;
      continue;
    }
    const due = i.dueAt
      ? startOfDay(i.dueAt).getTime() + (delay.get(i.clientId) || 0) * DAY
      : today;
    const k = Math.floor((due - today) / (7 * DAY));
    const r = rows.find((x) => x.k === Math.max(0, k));
    if (r) {
      r.expected += i.balance;
      r.expectedCount += 1;
    }
  }
  return rows;
}

/** Median days between due date and payment, per client, from invoices paid in full. Requires 2+ samples. */
export function clientDelays(invoices) {
  const samples = new Map();
  for (const i of invoices) {
    if (i.status !== "paid" || !i.dueAt || !i.events.length) continue;
    const paidAt = i.events.reduce(
      (m, e) => (e.at > m ? e.at : m),
      i.events[0].at,
    );
    const d = daysBetween(paidAt, i.dueAt);
    if (!samples.has(i.clientId)) samples.set(i.clientId, []);
    samples.get(i.clientId).push(d);
  }
  const out = new Map();
  for (const [id, arr] of samples) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const med = arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    out.set(id, Math.max(0, Math.round(med)));
  }
  return out;
}

export function clientBalances(invoices) {
  const m = new Map();
  for (const i of invoices) {
    if (!i.open) continue;
    const k = i.clientId || "unknown";
    const cur = m.get(k) || {
      id: k,
      name: i.client?.name || "Unknown client",
      total: 0,
      overdue: 0,
      count: 0,
    };
    cur.total += i.balance;
    cur.count += 1;
    if (i.status === "overdue") cur.overdue += i.balance;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

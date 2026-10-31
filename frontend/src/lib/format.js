const cache = new Map();
function nf(currency, opts) {
  const key = currency + JSON.stringify(opts);
  if (!cache.has(key))
    cache.set(
      key,
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        ...opts,
      }),
    );
  return cache.get(key);
}

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Currency-aware formatting. Never mixes currencies: always pass the record's own currency. */
export function money(v, currency = "USD", opts = {}) {
  try {
    return nf(currency || "USD", opts).format(num(v));
  } catch {
    return `${currency} ${num(v).toFixed(2)}`;
  }
}

/** Axis label, e.g. $12k. */
export function moneyShort(v, currency = "USD") {
  try {
    return nf(currency || "USD", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(num(v));
  } catch {
    return String(Math.round(num(v)));
  }
}

const dFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dShort = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const dtFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const fmtDate = (v) => (toDate(v) ? dFmt.format(toDate(v)) : "—");
export const fmtDateShort = (v) => (toDate(v) ? dShort.format(toDate(v)) : "—");
export const fmtDateTime = (v) => (toDate(v) ? dtFmt.format(toDate(v)) : "—");

const DAY = 864e5;
export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const daysBetween = (a, b) =>
  Math.round((startOfDay(a) - startOfDay(b)) / DAY);

/** "3 days late", "Due today", "In 5 days". */
export function dueLabel(due, now = new Date()) {
  const d = toDate(due);
  if (!d) return "No due date";
  const diff = daysBetween(d, now);
  if (diff < 0) return `${-diff} day${diff === -1 ? "" : "s"} late`;
  if (diff === 0) return "Due today";
  return `In ${diff} day${diff === 1 ? "" : "s"}`;
}

export function timeAgo(v, now = new Date()) {
  const d = toDate(v);
  if (!d) return "";
  const s = Math.round((now - d) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  return days < 14 ? `${days} day${days === 1 ? "" : "s"} ago` : fmtDate(d);
}

export const titleCase = (s) =>
  String(s || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** RFC 4180 CSV with formula-injection protection. */
export function toCsv(rows, columns) {
  const cell = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    columns.map((c) => cell(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => cell(c.value(r))).join(",")),
  ].join("\r\n");
}

export function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api.js";
import {
  buildLedger,
  normClient,
  normContract,
  normInvoice,
  normPayment,
  asList,
} from "./models.js";

// Requests made within TTL are shared, so a page and the topbar search never fetch the same list twice.
const TTL = 15000;
const inflight = new Map();
export function fetchShared(path, force) {
  const hit = inflight.get(path);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = api(path);
  inflight.set(path, { at: Date.now(), promise });
  promise.catch(() => inflight.delete(path));
  return promise;
}
export const invalidate = (prefix = "") => {
  for (const k of inflight.keys()) if (k.startsWith(prefix)) inflight.delete(k);
};

/** GET helper. `path` may be null to skip. Refreshes on the global "settle-refresh" event. */
export function useData(path) {
  const [state, setState] = useState({
    data: null,
    error: "",
    busy: Boolean(path),
  });
  const alive = useRef(true);
  const seq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!path) return;
      const mine = ++seq.current;
      setState((s) => ({ ...s, busy: true }));
      try {
        const data = await fetchShared(path, force);
        if (alive.current && mine === seq.current)
          setState({ data, error: "", busy: false });
      } catch (e) {
        if (alive.current && mine === seq.current)
          setState((s) => ({
            ...s,
            error: e.message || "Request failed",
            busy: false,
          }));
      }
    },
    [path],
  );

  useEffect(() => {
    alive.current = true;
    load();
    const onRefresh = () => load(true);
    window.addEventListener("settle-refresh", onRefresh);
    return () => {
      alive.current = false;
      window.removeEventListener("settle-refresh", onRefresh);
    };
  }, [load]);

  const reload = useCallback(() => {
    invalidate();
    return load(true);
  }, [load]);

  return {
    ...state,
    reload,
    setData: (data) => setState((s) => ({ ...s, data })),
  };
}

/** Normalized, joined records for dashboards and reports. */
export function useLedger() {
  const invoices = useData("/v1/invoices");
  const payments = useData("/v1/payments");
  const clients = useData("/v1/clients");
  const contracts = useData("/v1/contracts");

  const ledger = useMemo(() => {
    const inv = asList(invoices.data).map(normInvoice);
    const pay = asList(payments.data).map(normPayment);
    const cli = asList(clients.data).map(normClient);
    const con = asList(contracts.data).map(normContract);
    return buildLedger({
      invoices: inv,
      payments: pay,
      clients: cli,
      contracts: con,
    });
  }, [invoices.data, payments.data, clients.data, contracts.data]);

  const sources = { invoices, payments, clients, contracts };
  const busy = invoices.busy || clients.busy;
  // Payments and contracts are optional: the dashboard still works if those lists fail.
  const error = invoices.error || clients.error;
  const reload = () =>
    Promise.all(Object.values(sources).map((s) => s.reload()));
  return { ...ledger, busy, error, reload, paymentsError: payments.error };
}

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Settle` : "Settle";
  }, [title]);
}

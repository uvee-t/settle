import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, DataTable, EmptyState, ErrorState, Metric, PanelSkeleton, Pager, Seg, StatusBadge, usePaged } from '../../components/ui.jsx';
import { useLedger, usePageTitle } from '../../lib/hooks.js';
import { fmtDateTime, money } from '../../lib/format.js';

export default function Payments() {
  usePageTitle('Payments');
  const navigate = useNavigate();
  const ledger = useLedger();
  const [filter, setFilter] = useState('all');
  const invById = useMemo(() => new Map(ledger.invoices.map((i) => [i.id, i])), [ledger.invoices]);
  const rows = useMemo(() => [...ledger.payments].filter((p) => (filter === 'all' ? true : filter === 'ok' ? p.ok : !p.ok)).sort((a, b) => (b.at || 0) - (a.at || 0)), [ledger.payments, filter]);
  const paged = usePaged(rows, 12);
  const totals = useMemo(() => {
    const t = {};
    for (const p of ledger.payments) if (p.ok) t[p.currency] = (t[p.currency] || 0) + p.amount;
    return Object.entries(t);
  }, [ledger.payments]);

  return (
    <>
      <div className="page-head"><div><h1>Payments</h1><p>Payment records reconciled against your invoices.</p></div></div>
      {ledger.paymentsError && <ErrorState message={ledger.paymentsError} onRetry={ledger.reload} />}
      {!ledger.paymentsError && (ledger.busy && !ledger.payments.length ? <Card><PanelSkeleton rows={5} /></Card> : (
        <>
          {totals.length > 0 && (
            <div className="metrics three" style={{ marginBottom: 16 }}>
              {totals.slice(0, 3).map(([c, v]) => <Metric key={c} label={`Received, ${c}`} value={money(v, c)} detail={`${ledger.payments.filter((p) => p.ok && p.currency === c).length} successful payments`} />)}
            </div>
          )}
          <div className="toolbar"><Seg label="Payment status" value={filter} onChange={setFilter} options={[['all', 'All'], ['ok', 'Successful'], ['other', 'Pending or failed']]} /><span className="count">{rows.length} payment{rows.length === 1 ? '' : 's'}</span></div>
          <Card flush>
            {!ledger.payments.length ? <EmptyState title="No payments yet">Payments appear here after PayPal reports them for a sent invoice.</EmptyState> : (
              <>
                <DataTable label="Payments" rows={paged.slice} empty="No payments match this filter." onRowClick={(r) => r.invoiceId && navigate(`/invoices/${r.invoiceId}`)}
                  columns={[
                    { key: 'd', label: 'Date', render: (r) => fmtDateTime(r.at) },
                    { key: 'i', label: 'Invoice', render: (r) => (invById.get(r.invoiceId) ? <Link className="rec" to={`/invoices/${r.invoiceId}`} onClick={(e) => e.stopPropagation()}>{invById.get(r.invoiceId).number}</Link> : '—') },
                    { key: 'c', label: 'Client', render: (r) => invById.get(r.invoiceId)?.client?.name || '—' },
                    { key: 'a', label: 'Amount', align: 'right', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> },
                    { key: 'm', label: 'Provider', render: (r) => r.method || '—' },
                    { key: 'r', label: 'Reference', mono: true, render: (r) => r.reference || String(r.id).slice(0, 8) },
                    { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
                  ]} />
                <Pager p={paged} />
              </>
            )}
          </Card>
        </>
      ))}
    </>
  );
}

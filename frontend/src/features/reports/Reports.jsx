import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Button, Card, DataTable, ErrorState, Field, PanelSkeleton, Seg, SelectField, StatusBadge, TextField } from '../../components/ui.jsx';
import { AgingBars, CollectionsChart, HorizontalBars } from '../../components/charts.jsx';
import { useLedger, usePageTitle } from '../../lib/hooks.js';
import { agingBuckets, clientBalances, collectionBuckets, currenciesOf, inCurrency } from '../../lib/analytics.js';
import { downloadText, fmtDate, money, toCsv } from '../../lib/format.js';

const COLS = [
  { label: 'Invoice number', value: (r) => r.number },
  { label: 'Client', value: (r) => r.client?.name || '' },
  { label: 'Currency', value: (r) => r.currency },
  { label: 'Total', value: (r) => r.amount.toFixed(2) },
  { label: 'Paid', value: (r) => r.paid.toFixed(2) },
  { label: 'Balance', value: (r) => r.balance.toFixed(2) },
  { label: 'Status', value: (r) => r.status },
  { label: 'Issued (UTC)', value: (r) => (r.sentAt || r.createdAt)?.toISOString().slice(0, 10) || '' },
  { label: 'Due (UTC)', value: (r) => r.dueAt?.toISOString().slice(0, 10) || '' },
  { label: 'Provider invoice ID', value: (r) => r.providerId },
];

export default function Reports() {
  usePageTitle('Reports');
  const navigate = useNavigate();
  const ledger = useLedger();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('all');
  const [mode, setMode] = useState('monthly');
  const [pickCur, setPickCur] = useState('');
  const now = useMemo(() => new Date(), [ledger.invoices]);
  const currencies = useMemo(() => currenciesOf(ledger.invoices), [ledger.invoices]);
  const currency = pickCur || currencies[0] || 'USD';

  const invoices = useMemo(() => inCurrency(ledger.invoices, currency).filter((i) => {
    const d = i.sentAt || i.createdAt;
    if (from && (!d || d < new Date(`${from}T00:00:00`))) return false;
    if (to && (!d || d > new Date(`${to}T23:59:59`))) return false;
    if (status === 'open') return i.open;
    return status === 'all' || i.status === status;
  }), [ledger.invoices, currency, from, to, status]);
  const events = useMemo(() => inCurrency(ledger.events, currency).filter((e) => (!from || e.at >= new Date(`${from}T00:00:00`)) && (!to || e.at <= new Date(`${to}T23:59:59`))), [ledger.events, currency, from, to]);

  const buckets = useMemo(() => collectionBuckets(invoices, events, { range: 180, mode }, now), [invoices, events, mode, now]);
  const aging = useMemo(() => agingBuckets(invoices, now), [invoices, now]);
  const balances = useMemo(() => clientBalances(invoices).slice(0, 8), [invoices]);
  const totals = useMemo(() => invoices.reduce((t, i) => ({ amount: t.amount + (i.status === 'cancelled' ? 0 : i.amount), paid: t.paid + i.paid, balance: t.balance + i.balance }), { amount: 0, paid: 0, balance: 0 }), [invoices]);

  function exportCsv() {
    downloadText(`settle-invoices-${currency}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(invoices, COLS));
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p>Receivables, collections and client balances, with CSV export.</p></div>
        <div className="page-actions"><Button icon={Download} onClick={exportCsv} disabled={!invoices.length}>Export CSV</Button></div>
      </div>
      <div className="toolbar" style={{ alignItems: 'flex-end' }}>
        {currencies.length > 1 && <Seg small label="Currency" value={currency} onChange={setPickCur} options={currencies.map((c) => [c, c])} />}
        <div style={{ width: 160 }}><TextField label="Issued from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} /></div>
        <div style={{ width: 160 }}><TextField label="Issued to" type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} /></div>
        <div style={{ width: 180 }}><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[['all', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['partial', 'Partially paid'], ['paid', 'Paid'], ['draft', 'Draft'], ['cancelled', 'Cancelled']]} /></div>
        {(from || to || status !== 'all') && <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); setStatus('all'); }}>Clear filters</Button>}
      </div>
      {ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} /> : ledger.busy && !ledger.invoices.length ? <Card><PanelSkeleton rows={6} /></Card> : (
        <div className="grid">
          <Card className="c-7" title="Collections over time" sub={`Invoiced and collected in ${currency}`} actions={<Seg small label="Aggregation" value={mode} onChange={setMode} options={[['weekly', 'Weekly'], ['monthly', 'Monthly']]} />}>
            <CollectionsChart data={buckets} currency={currency} />
            <p className="note">Shows up to the last {mode === 'weekly' ? '13 weeks' : '6 months'}. Date filters narrow which records are counted.</p>
          </Card>
          <Card className="c-5" title="Invoice aging" sub="Open balance by days past due"><AgingBars buckets={aging} currency={currency} /></Card>
          <Card className="c-5" title="Balances by client" sub="Top open balances"><HorizontalBars data={balances} currency={currency} /></Card>
          <Card className="c-7" title="Summary" sub={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'} in this view`}>
            <dl className="dl"><dt>Invoiced</dt><dd className="num">{money(totals.amount, currency)}</dd><dt>Collected</dt><dd className="num">{money(totals.paid, currency)}</dd><dt>Outstanding</dt><dd className="num">{money(totals.balance, currency)}</dd></dl>
            <p className="note">Totals exclude cancelled invoices. Aging and outstanding use today’s date.</p>
          </Card>
          <Card className="c-12" title="Invoices in this report" flush>
            <DataTable label="Report invoices" rows={invoices.slice(0, 50)} onRowClick={(r) => navigate(`/invoices/${r.id}`)} empty="No invoices match these filters."
              columns={[
                { key: 'n', label: 'Invoice', render: (r) => <Link className="rec" to={`/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link> },
                { key: 'c', label: 'Client', render: (r) => r.client?.name || '—' },
                { key: 'i', label: 'Issued', render: (r) => fmtDate(r.sentAt || r.createdAt) },
                { key: 'd', label: 'Due', render: (r) => fmtDate(r.dueAt) },
                { key: 't', label: 'Total', align: 'right', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> },
                { key: 'b', label: 'Balance', align: 'right', render: (r) => <span className="num">{money(r.balance, r.currency)}</span> },
                { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
              ]} />
            {invoices.length > 50 && <p className="note" style={{ padding: '0 20px 16px' }}>Showing 50 of {invoices.length}. The CSV export contains all of them.</p>}
          </Card>
        </div>
      )}
    </>
  );
}

export { Field };

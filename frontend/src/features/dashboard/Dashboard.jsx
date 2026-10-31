import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, Metric, Notice, PanelSkeleton, Seg, StatusBadge, usePaged, Pager } from '../../components/ui.jsx';
import { AgingBars, CashFlowChart, CollectionsChart, StatusDonut } from '../../components/charts.jsx';
import { ClientForm } from '../clients/ClientForm.jsx';
import { InvoiceForm } from '../invoices/InvoiceForm.jsx';
import { useData, useLedger, usePageTitle } from '../../lib/hooks.js';
import { agingBuckets, cashFlowSeries, collectionBuckets, currenciesOf, inCurrency, outstandingAt, rangeStart, statusDistribution, sumEvents } from '../../lib/analytics.js';
import { daysBetween, dueLabel, fmtDate, greeting, money, timeAgo, startOfDay } from '../../lib/format.js';
import { session } from '../../services/api.js';

function Spark({ values, color }) {
  if (values.filter((v) => v > 0).length < 3) return null; // not enough history to draw a trend
  const w = 84, h = 30, p = 3;
  const max = Math.max(...values), min = Math.min(...values), r = max - min || 1;
  const pts = values.map((v, i) => [p + (i * (w - 2 * p)) / (values.length - 1), h - p - ((v - min) / r) * (h - 2 * p)]);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('');
  const last = pts.at(-1);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flex: 'none' }}>
      <path d={`${d}L${last[0]} ${h}L${pts[0][0]} ${h}Z`} fill={color} opacity=".12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={color} />
    </svg>
  );
}

function Delta({ cur, prev, badWhenUp, label }) {
  if (!prev) return <span className="delta">No earlier period to compare</span>;
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.5) return <span className="delta">Flat {label}</span>;
  const up = pct > 0;
  const bad = badWhenUp ? up : !up;
  return <span className={`delta ${bad ? 'bad' : 'good'}`}>{up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% {label}</span>;
}

export default function Dashboard() {
  usePageTitle('Overview');
  const navigate = useNavigate();
  const s = session();
  const ledger = useLedger();
  const summary = useData('/v1/dashboard/summary');
  const cash = useData('/v1/dashboard/cash-flow?days=90');
  const [range, setRange] = useState(30);
  const [agg, setAgg] = useState('weekly');
  const [horizon, setHorizon] = useState(8);
  const [filter, setFilter] = useState('all');
  const [currencyPick, setCurrencyPick] = useState('');
  const [modal, setModal] = useState(null);

  const now = useMemo(() => new Date(), [ledger.invoices]);
  const currencies = useMemo(() => currenciesOf(ledger.invoices), [ledger.invoices]);
  const currency = currencyPick || (currencies.includes(summary.data?.currency) ? summary.data.currency : currencies[0]) || summary.data?.currency || 'USD';
  const invoices = useMemo(() => inCurrency(ledger.invoices, currency), [ledger.invoices, currency]);
  const events = useMemo(() => inCurrency(ledger.events, currency), [ledger.events, currency]);

  const m = useMemo(() => {
    const from = rangeStart(range, now);
    const prevFrom = rangeStart(range * 2, now);
    const to = new Date(startOfDay(now).getTime() + 864e5);
    const open = invoices.filter((i) => i.open);
    const overdue = open.filter((i) => i.status === 'overdue');
    const collected = sumEvents(events, from, to);
    const collectedPrev = sumEvents(events, prevFrom, from);
    const outstanding = open.reduce((t, i) => t + i.balance, 0);
    const horizon30 = new Date(startOfDay(now).getTime() + 30 * 864e5);
    const expected = open.filter((i) => i.status !== 'overdue' && (!i.dueAt || i.dueAt <= horizon30)).reduce((t, i) => t + i.balance, 0);
    const expectedN = open.filter((i) => i.status !== 'overdue' && (!i.dueAt || i.dueAt <= horizon30)).length;
    const steps = 8;
    const sparkOut = Array.from({ length: steps }, (_, k) => outstandingAt(invoices, new Date(from.getTime() + ((to - from) * k) / (steps - 1))));
    const sparkCol = Array.from({ length: steps }, (_, k) => sumEvents(events, new Date(from.getTime() + ((to - from) * k) / steps), new Date(from.getTime() + ((to - from) * (k + 1)) / steps)));
    return { from, open, overdue, collected, collectedPrev, outstanding, outstandingPrev: outstandingAt(invoices, from), overdueTotal: overdue.reduce((t, i) => t + i.balance, 0), expected, expectedN, sparkOut, sparkCol };
  }, [invoices, events, range, now]);

  const serverOutstanding = summary.data?.invoices && summary.data.currency === currency ? Number(summary.data.invoices.outstanding_amount) : null;
  const outstanding = Number.isFinite(serverOutstanding) ? serverOutstanding : m.outstanding;

  const series = useMemo(() => cashFlowSeries(invoices, events, { past: 8, future: horizon }, now), [invoices, events, horizon, now]);
  const buckets = useMemo(() => collectionBuckets(invoices, events, { range, mode: agg }, now), [invoices, events, range, agg, now]);
  const dist = useMemo(() => statusDistribution(invoices.filter((i) => (i.createdAt || i.dueAt || now) >= m.from)), [invoices, m.from, now]);
  const aging = useMemo(() => agingBuckets(invoices, now), [invoices, now]);

  const attention = useMemo(() => m.open
    .filter((i) => (filter === 'overdue' ? i.status === 'overdue' : filter === 'soon' ? i.dueAt && daysBetween(i.dueAt, now) >= 0 && daysBetween(i.dueAt, now) <= 14 : true))
    .sort((a, b) => (a.dueAt || 8.64e15) - (b.dueAt || 8.64e15)), [m.open, filter, now]);
  const paged = usePaged(attention, 6);

  const feed = useMemo(() => {
    const ev = [];
    for (const i of ledger.invoices) {
      if (i.createdAt) ev.push({ at: i.createdAt, tone: 'var(--text-3)', text: <>Draft <Link to={`/invoices/${i.id}`}><b>{i.number}</b></Link> created for {i.client?.name || 'a client'}</> });
      if (i.sentAt) ev.push({ at: i.sentAt, tone: 'var(--primary)', text: <>Invoice <Link to={`/invoices/${i.id}`}><b>{i.number}</b></Link> sent to {i.client?.name || 'a client'}</> });
      for (const e of i.events) ev.push({ at: e.at, tone: 'var(--success)', text: <><b>{money(e.amount, e.currency)}</b> received on <Link to={`/invoices/${i.id}`}>{i.number}</Link></> });
    }
    for (const c of ledger.contracts) if (c.createdAt) ev.push({ at: new Date(c.createdAt), tone: 'var(--violet)', text: <>Contract <Link to={`/contracts/${c.id}`}><b>{c.title}</b></Link> created</> });
    return ev.filter((e) => e.at && !Number.isNaN(+e.at) && e.at <= now).sort((a, b) => b.at - a.at).slice(0, 8);
  }, [ledger.invoices, ledger.contracts, now]);

  const first = (s.user?.name || '').split(' ')[0];
  const empty = !ledger.busy && !ledger.error && ledger.invoices.length === 0;
  const server = cash.data?.forecast?.find?.((f) => (f.currency || 'USD') === currency);
  const rangeLabel = range === 180 ? '6 months' : `${range} days`;

  const refresh = () => { ledger.reload(); summary.reload(); cash.reload(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
          <p>{s.workspace?.name || 'Your workspace'}. Receivables, collections and expected cash{currencies.length ? ` in ${currency}` : ''}.</p>
        </div>
        <div className="page-actions">
          {currencies.length > 1 && <Seg small label="Currency" value={currency} onChange={setCurrencyPick} options={currencies.map((c) => [c, c])} />}
          <Seg label="Date range" value={range} onChange={setRange} options={[[30, '30 days'], [90, '90 days'], [180, '6 months']]} />
          <Button icon={RefreshCw} onClick={refresh} aria-label="Refresh dashboard">Refresh</Button>
          <Button icon={Plus} onClick={() => setModal('client')}>Add client</Button>
          <Button variant="primary" icon={Plus} onClick={() => setModal('invoice')}>Create invoice</Button>
        </div>
      </div>

      {ledger.error && <ErrorState message={ledger.error} onRetry={ledger.reload} />}
      {ledger.paymentsError && !ledger.error && <Notice kind="info">Payment records could not be loaded, so collections are estimated from invoices marked paid.</Notice>}
      {ledger.busy && !ledger.invoices.length && !ledger.error && <PanelSkeleton rows={6} />}

      {empty && (
        <Card><EmptyState title="No invoices yet" action={<Button variant="primary" icon={Plus} onClick={() => setModal('invoice')}>Create your first invoice</Button>}>
          Add a client, then create an invoice or a contract with milestones. Your balances, forecast and charts appear here as records arrive.
        </EmptyState></Card>
      )}

      {!empty && !ledger.error && ledger.invoices.length > 0 && (
        <>
          <section className="metrics" aria-label="Key figures">
            <Metric label="Outstanding" value={money(outstanding, currency, { maximumFractionDigits: 0 })} trend={<Delta cur={m.outstanding} prev={m.outstandingPrev} badWhenUp label={`vs ${rangeLabel} ago`} />} detail={`${m.open.length} unpaid invoice${m.open.length === 1 ? '' : 's'}, net of partial payments`} to="/invoices?status=open">
              <Spark values={m.sparkOut} color="var(--primary)" />
            </Metric>
            <Metric label={`Collected, ${rangeLabel}`} value={money(m.collected, currency, { maximumFractionDigits: 0 })} trend={<Delta cur={m.collected} prev={m.collectedPrev} label="vs prior period" />} detail="By payment date" to="/payments">
              <Spark values={m.sparkCol} color="var(--success)" />
            </Metric>
            <Metric label="Overdue" value={money(m.overdueTotal, currency, { maximumFractionDigits: 0 })} tone={m.overdueTotal ? 'danger' : undefined} detail={m.overdue.length ? `${m.overdue.length} invoice${m.overdue.length === 1 ? '' : 's'} past due. Review them` : 'Nothing is past due'} onClick={() => navigate('/invoices?status=overdue')} />
            <Metric label="Expected inflow, 30 days" value={money(m.expected, currency, { maximumFractionDigits: 0 })} detail={`${m.expectedN} invoice${m.expectedN === 1 ? '' : 's'} due, not yet paid. Not confirmed${server ? `. Server forecast: ${money(server.expected_inflow ?? server.expectedInflow ?? 0, currency)}` : ''}`} to="/cashflow" />
          </section>

          <div className="grid">
            <Card className="c-8" title="Cash flow" sub="Weekly collections, then invoices scheduled by due date" actions={<Seg small label="Forecast horizon" value={horizon} onChange={setHorizon} options={[[4, '4 weeks'], [8, '8 weeks'], [12, '12 weeks']]} />}>
              <CashFlowChart data={series} currency={currency} />
              <div className="legend">
                <span><i style={{ background: 'var(--primary)' }} />Collected (actual)</span>
                <span><i style={{ background: 'var(--cyan)', opacity: 0.75 }} />Scheduled by due date</span>
                <span><i style={{ background: 'var(--danger)', opacity: 0.8 }} />Overdue, carried into this week</span>
              </div>
              <p className="note"><b>Projection, not a promise.</b> Each open balance is placed in the week of its due date, shifted by that client’s median payment delay when at least two paid invoices exist. Overdue balances are shown separately because their payment date is unknown.</p>
            </Card>
            <Card className="c-4" title="Invoice status" sub={`Invoices created in the last ${rangeLabel}`}>
              <StatusDonut data={dist} currency={currency} />
              <p className="note">Each invoice is counted once. Cancelled invoices are excluded.</p>
            </Card>

            <Card className="c-7" title="Invoiced and collected" sub={agg === 'weekly' ? 'Per week' : 'Per calendar month, * month to date'} actions={<Seg small label="Aggregation" value={agg} onChange={setAgg} options={[['weekly', 'Weekly'], ['monthly', 'Monthly']]} />}>
              <CollectionsChart data={buckets} currency={currency} />
              <div className="legend"><span><i style={{ background: 'var(--border-strong)' }} />Invoiced (by issue date)</span><span><i style={{ background: 'var(--primary)' }} />Collected (by payment date)</span></div>
            </Card>
            <Card className="c-5" title="Receivables aging" sub="Open balance by days past due, today">
              <AgingBars buckets={aging} currency={currency} />
            </Card>

            <Card className="c-8" title="Needs attention" sub="Open balances in order of due date" flush
              actions={<Seg small label="Filter invoices" value={filter} onChange={setFilter} options={[['all', 'All open'], ['overdue', 'Overdue'], ['soon', 'Due in 14 days']]} />}>
              <DataTable label="Open invoices" rows={paged.slice} onRowClick={(r) => navigate(`/invoices/${r.id}`)} empty={filter === 'all' ? 'Nothing is waiting on payment.' : 'No invoices match this filter.'}
                columns={[
                  { key: 'client', label: 'Client', render: (r) => (r.client ? <Link className="rec" to={`/clients/${r.clientId}`} onClick={(e) => e.stopPropagation()}>{r.client.name}</Link> : '—') },
                  { key: 'no', label: 'Invoice', mono: true, render: (r) => r.number },
                  { key: 'bal', label: 'Balance', align: 'right', render: (r) => <span className="num">{money(r.balance, r.currency)}{r.paid > 0 && <span className="sub">of {money(r.amount, r.currency)}</span>}</span> },
                  { key: 'due', label: 'Due', render: (r) => <>{fmtDate(r.dueAt)}<span className="sub">{dueLabel(r.dueAt, now)}</span></> },
                  { key: 'st', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
                ]} />
              <Pager p={paged} />
            </Card>
            <Card className="c-4" title="Recent activity" sub="From invoice, payment and contract records">
              {feed.length ? (
                <ul className="feed">{feed.map((e, i) => <li key={i}><span className="dot" style={{ color: e.tone }} /><div><div className="t">{e.text}</div><div className="d">{timeAgo(e.at, now)}</div></div></li>)}</ul>
              ) : <EmptyState title="No activity yet">Events appear as you create and send invoices.</EmptyState>}
            </Card>
          </div>
          {currencies.length > 1 && <p className="note">Figures are shown for {currency} only. Amounts in other currencies are never combined. Use the currency switch to view them.</p>}
        </>
      )}

      {modal === 'client' && <ClientForm onClose={() => setModal(null)} onSaved={() => { setModal(null); ledger.reload(); }} />}
      {modal === 'invoice' && <InvoiceForm clients={ledger.clients} onClose={() => setModal(null)} onSaved={(inv) => { setModal(null); ledger.reload(); if (inv?.id) navigate(`/invoices/${inv.id}`); }} />}
    </>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, DataTable, ErrorState, Metric, Notice, PanelSkeleton, Seg } from '../../components/ui.jsx';
import { CashFlowChart } from '../../components/charts.jsx';
import { useData, useLedger, usePageTitle } from '../../lib/hooks.js';
import { cashFlowSeries, clientDelays, currenciesOf, inCurrency } from '../../lib/analytics.js';
import { fmtDateShort, money, num } from '../../lib/format.js';

const pick = (r, a, b) => num(r[a] ?? r[b]);
const rowsOf = (d) => (Array.isArray(d?.forecast) ? d.forecast : Array.isArray(d?.forecasts) ? d.forecasts : []).map((r) => ({
  currency: r.currency || 'USD',
  expected: pick(r, 'expected_inflow', 'expectedInflow'),
  overdue: pick(r, 'overdue_receivables', 'overdueReceivables'),
  collected: pick(r, 'collected_last_30_days', 'collectedLast30Days'),
  net: pick(r, 'net_expected_inflow', 'netExpectedInflow'),
}));

export default function Cashflow() {
  usePageTitle('Cash flow');
  const [days, setDays] = useState(90);
  const [pickCur, setPickCur] = useState('');
  const [weeks, setWeeks] = useState(12);
  const ledger = useLedger();
  const api = useData(`/v1/dashboard/cash-flow?days=${days}`);
  const server = useMemo(() => rowsOf(api.data), [api.data]);

  const currencies = useMemo(() => [...new Set([...currenciesOf(ledger.invoices), ...server.map((r) => r.currency)])], [ledger.invoices, server]);
  const currency = pickCur || currencies[0] || 'USD';
  const invoices = useMemo(() => inCurrency(ledger.invoices, currency), [ledger.invoices, currency]);
  const events = useMemo(() => inCurrency(ledger.events, currency), [ledger.events, currency]);
  const now = useMemo(() => new Date(), [ledger.invoices]);

  const base = useMemo(() => cashFlowSeries(invoices, events, { past: 8, future: weeks }, now), [invoices, events, weeks, now]);
  const onTime = useMemo(() => cashFlowSeries(invoices, events, { past: 8, future: weeks, useDelay: false }, now), [invoices, events, weeks, now]);
  const delays = useMemo(() => clientDelays(invoices), [invoices]);
  const fut = base.filter((r) => r.k >= 0);
  const sum = (arr, k) => arr.filter((r) => r.k >= 0).reduce((s, r) => s + (r[k] || 0), 0);
  const sRow = server.find((r) => r.currency === currency);
  const weeklyRows = fut.map((r, i) => ({ ...r, onTime: onTime.filter((x) => x.k >= 0)[i]?.expected || 0 }));

  return (
    <>
      <div className="page-head">
        <div><h1>Cash flow</h1><p>What has been collected, what is scheduled, and what is already late.</p></div>
        <div className="page-actions">
          {currencies.length > 1 && <Seg small label="Currency" value={currency} onChange={setPickCur} options={currencies.map((c) => [c, c])} />}
          <Seg label="Server forecast horizon" value={days} onChange={setDays} options={[[30, '30 days'], [60, '60 days'], [90, '90 days']]} />
        </div>
      </div>
      {ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} /> : ledger.busy && !ledger.invoices.length ? <Card><PanelSkeleton rows={6} /></Card> : (
        <>
          <div className="metrics">
            <Metric label="Expected inflow" value={money(sRow ? sRow.expected : sum(base, 'expected'), currency, { maximumFractionDigits: 0 })} detail={sRow ? `Server forecast, next ${days} days` : `Next ${weeks} weeks, from open invoices`} />
            <Metric label="Overdue receivables" value={money(sRow ? sRow.overdue : sum(base, 'overdue'), currency)} tone="danger" detail="Past due, payment date unknown" to="/invoices?status=overdue" />
            <Metric label="Collected, last 30 days" value={money(sRow ? sRow.collected : events.filter((e) => e.at >= new Date(now - 30 * 864e5)).reduce((s, e) => s + e.amount, 0), currency)} detail="Actual payments" />
            <Metric label="Net expected" value={money(sRow ? sRow.net : sum(base, 'expected') + sum(base, 'overdue'), currency)} detail="Expected plus overdue, if all paid" />
          </div>

          <div className="grid">
            <Card className="c-12" title="Actual and scheduled" sub="Eight weeks of collections, then scheduled inflow by week" actions={<Seg small label="Weeks ahead" value={weeks} onChange={setWeeks} options={[[4, '4'], [8, '8'], [12, '12'], [26, '26']]} />}>
              <CashFlowChart data={base} currency={currency} height={320} />
              <div className="legend">
                <span><i style={{ background: 'var(--primary)' }} />Collected (actual)</span>
                <span><i style={{ background: 'var(--cyan)', opacity: 0.75 }} />Scheduled by due date and client delay</span>
                <span><i style={{ background: 'var(--danger)', opacity: 0.8 }} />Overdue, carried into this week</span>
              </div>
            </Card>

            <Card className="c-8" title="Scenario comparison" sub="Scheduled inflow per week under two assumptions" flush>
              <DataTable label="Weekly scenarios" rows={weeklyRows.slice(0, 12)} rowKey={(r) => r.k} empty="No open invoices to schedule."
                columns={[
                  { key: 'w', label: 'Week of', render: (r) => fmtDateShort(r.from) },
                  { key: 'a', label: 'All paid on due date', align: 'right', render: (r) => <span className="num">{money(r.onTime, currency)}</span> },
                  { key: 'b', label: 'With client delay', align: 'right', render: (r) => <span className="num">{money(r.expected, currency)}</span> },
                  { key: 'c', label: 'Invoices', align: 'right', render: (r) => <span className="num">{r.expectedCount}</span> },
                ]} />
            </Card>
            <Card className="c-4" title="Assumptions and limits">
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
                <li>Every open balance is placed in the week of its due date.</li>
                <li>Where a client has two or more fully paid invoices, their median days late shifts the date. {delays.size ? `${delays.size} client${delays.size === 1 ? ' has' : 's have'} enough history.` : 'No client has enough history yet, so both scenarios match.'}</li>
                <li>Overdue balances are not given a date. They are shown in the current week as a separate series.</li>
                <li>Partial payments reduce the open balance. Cancelled and draft invoices are excluded.</li>
                <li>Amounts in different currencies are never combined.</li>
                <li>This is arithmetic on your own records, not a statistical or machine-learning prediction. Expected is not confirmed.</li>
              </ul>
            </Card>

            <Card className="c-12" title="Server forecast by currency" sub="Exact figures returned by the Settle API" flush>
              {api.error ? <div style={{ padding: '0 20px 20px' }}><Notice>{api.error}</Notice><Button onClick={api.reload}>Try again</Button></div> : (
                <DataTable label="Forecast by currency" rows={server} rowKey={(r) => r.currency} empty={api.busy ? 'Loading…' : 'The API returned no forecast rows yet.'}
                  columns={[
                    { key: 'c', label: 'Currency', render: (r) => r.currency },
                    { key: 'e', label: 'Expected inflow', align: 'right', render: (r) => <span className="num">{money(r.expected, r.currency)}</span> },
                    { key: 'o', label: 'Overdue', align: 'right', render: (r) => <span className="num">{money(r.overdue, r.currency)}</span> },
                    { key: 'l', label: 'Collected, 30 days', align: 'right', render: (r) => <span className="num">{money(r.collected, r.currency)}</span> },
                    { key: 'n', label: 'Net expected', align: 'right', render: (r) => <span className="num">{money(r.net, r.currency)}</span> },
                  ]} />
              )}
            </Card>
          </div>
          <p className="note">Need to chase something? <Link to="/invoices?status=overdue" style={{ color: 'var(--primary)' }}>Review overdue invoices</Link>.</p>
        </>
      )}
    </>
  );
}

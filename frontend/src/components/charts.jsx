import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, moneyShort, fmtDateShort } from '../lib/format.js';

const AXIS = { stroke: 'var(--border-strong)', tick: { fill: 'var(--text-3)', fontSize: 11, fontFamily: 'var(--mono)' }, tickLine: false };
const GRID = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />;

export function ChartEmpty({ children = 'No data for this period.' }) {
  return <div className="chart-empty">{children}</div>;
}

function Tip({ active, payload, title, currency, rows }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tm">{title(p)}</div>
      {rows(p).map(([k, v]) => (
        <div className="tr" key={k}><span>{k}</span><b>{typeof v === 'number' ? money(v, currency) : v}</b></div>
      ))}
    </div>
  );
}

/** Actual collections (area) and scheduled inflow (bars) in one weekly series. Past and future are visually distinct. */
export function CashFlowChart({ data, currency, height = 300 }) {
  const has = data.some((d) => (d.actual || 0) + (d.expected || 0) + (d.overdue || 0) > 0);
  if (!has) return <ChartEmpty>No collections or open invoices yet. Send an invoice to start the forecast.</ChartEmpty>;
  const rows = data.map((d) => ({ ...d, label: fmtDateShort(d.from) }));
  const summary = `Weekly cash flow in ${currency}. Total collected in shown past weeks ${money(data.reduce((s, d) => s + (d.k <= 0 ? d.actual || 0 : 0), 0), currency)}. Total scheduled ${money(data.reduce((s, d) => s + (d.expected || 0) + (d.overdue || 0), 0), currency)}.`;
  return (
    <div className="chart" style={{ height }} role="img" aria-label={summary}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => moneyShort(v, currency)} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={(p) => (
              <Tip {...p} currency={currency}
                title={(d) => `${fmtDateShort(d.from)} to ${fmtDateShort(new Date(d.to - 864e5))}${d.k > 0 ? ' (projected)' : d.k === 0 ? ' (this week)' : ''}`}
                rows={(d) => [
                  ...(d.actual !== null ? [['Collected', d.actual]] : []),
                  ...(d.expected ? [[`Due (${d.expectedCount})`, d.expected]] : []),
                  ...(d.overdue ? [[`Overdue (${d.overdueCount})`, d.overdue]] : []),
                ]}
              />
            )}
          />
          <Area type="linear" dataKey="actual" stroke="var(--primary)" strokeWidth={2} fill="var(--primary)" fillOpacity={0.12} connectNulls={false} dot={false} isAnimationActive={false} />
          <Bar dataKey="expected" stackId="f" fill="var(--cyan)" fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="overdue" stackId="f" fill="var(--danger)" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <ReferenceLine x={rows.find((r) => r.k === 0)?.label} stroke="var(--border-strong)" strokeDasharray="3 3" label={{ value: 'Today', fill: 'var(--text-3)', fontSize: 11, position: 'insideTopLeft' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CollectionsChart({ data, currency, height = 260 }) {
  if (!data.some((d) => d.invoiced || d.collected)) return <ChartEmpty>No invoices or payments in this period.</ChartEmpty>;
  return (
    <div className="chart" style={{ height }} role="img" aria-label={`Invoiced and collected amounts in ${currency}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          {GRID}
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={18} />
          <YAxis {...AXIS} axisLine={false} width={52} tickFormatter={(v) => moneyShort(v, currency)} />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={(p) => <Tip {...p} currency={currency} title={(d) => d.label.replace('*', ' (to date)')} rows={(d) => [['Invoiced', d.invoiced], ['Collected', d.collected]]} />} />
          <Bar dataKey="invoiced" fill="var(--border-strong)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          <Bar dataKey="collected" fill="var(--primary)" radius={[2, 2, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusDonut({ data, currency }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  const count = data.reduce((s, d) => s + d.count, 0);
  if (!count) return <ChartEmpty>No invoices were issued in this period.</ChartEmpty>;
  return (
    <div className="donut-wrap">
      <div style={{ width: 150, height: 150, position: 'relative', flex: 'none' }} role="img" aria-label={`Invoice status by amount, ${count} invoices`}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data.filter((d) => d.total > 0)} dataKey="total" innerRadius={46} outerRadius={70} paddingAngle={1} stroke="var(--bg)" strokeWidth={2} isAnimationActive={false}>
              {data.filter((d) => d.total > 0).map((d) => <Cell key={d.key} fill={d.color} />)}
            </Pie>
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return <div className="tip"><div className="tm">{d.label}</div><div className="tr"><span>Invoices</span><b>{d.count}</b></div><div className="tr"><span>Amount</span><b>{money(d.total, currency)}</b></div><div className="tr"><span>Share</span><b>{Math.round((d.total / total) * 100)}%</b></div></div>;
            }} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center', lineHeight: 1.1 }}>
          <div><b style={{ fontSize: 22, fontWeight: 500 }}>{count}</b><div className="tiny">invoices</div></div>
        </div>
      </div>
      <div className="stat-list">
        {data.map((d) => (
          <div className="stat-row" key={d.key}>
            <i style={{ background: d.color }} />{d.label}
            <span className="n num">{d.count}</span>
            <span className="a num">{money(d.total, currency, { maximumFractionDigits: 0 })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgingBars({ buckets, currency }) {
  const max = Math.max(...buckets.map((b) => b.total), 1);
  const total = buckets.reduce((s, b) => s + b.total, 0);
  if (!total) return <ChartEmpty>Nothing is outstanding.</ChartEmpty>;
  return (
    <div className="aging">
      {buckets.map((b) => (
        <div className="ag" key={b.key} title={`${b.count} invoice${b.count === 1 ? '' : 's'}`}>
          <span>{b.label}</span>
          <div className="bar"><b style={{ width: `${(b.total / max) * 100}%`, background: b.color }} /></div>
          <span className="v num">{money(b.total, currency, { maximumFractionDigits: 0 })}</span>
        </div>
      ))}
    </div>
  );
}

export function HorizontalBars({ data, currency, height }) {
  if (!data.length) return <ChartEmpty>No open balances.</ChartEmpty>;
  return (
    <div className="chart" style={{ height: height || data.length * 36 + 30 }} role="img" aria-label={`Open balance by client in ${currency}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis type="number" {...AXIS} axisLine={false} tickFormatter={(v) => moneyShort(v, currency)} />
          <YAxis type="category" dataKey="name" {...AXIS} axisLine={false} width={112} tickFormatter={(v) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={(p) => <Tip {...p} currency={currency} title={(d) => d.name} rows={(d) => [['Open', d.total], ['Overdue', d.overdue], ['Invoices', d.count]]} />} />
          <Bar dataKey="total" fill="var(--primary)" radius={[0, 2, 2, 0]} barSize={14} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { Legend };

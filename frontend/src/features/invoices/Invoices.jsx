import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, PanelSkeleton, Pager, SelectField, StatusBadge, usePaged, Field } from '../../components/ui.jsx';
import { InvoiceForm } from './InvoiceForm.jsx';
import { useLedger, usePageTitle } from '../../lib/hooks.js';
import { fmtDate, money, dueLabel } from '../../lib/format.js';

const TABS = [['all', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['draft', 'Draft'], ['paid', 'Paid'], ['cancelled', 'Cancelled']];
const SORTS = [['due', 'Due date, soonest'], ['new', 'Newest first'], ['amount', 'Amount, high to low']];

export default function Invoices({ openNew = false }) {
  usePageTitle('Invoices');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t[0] === params.get('status')) ? params.get('status') : 'all';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('due');
  const [show, setShow] = useState(openNew);
  const ledger = useLedger();

  const counts = useMemo(() => Object.fromEntries(TABS.map(([k]) => [k, ledger.invoices.filter((i) => match(i, k)).length])), [ledger.invoices]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ledger.invoices
      .filter((i) => match(i, tab) && (!needle || `${i.number} ${i.reference} ${i.client?.name || ''}`.toLowerCase().includes(needle)))
      .sort((a, b) => (sort === 'amount' ? b.amount - a.amount : sort === 'new' ? (b.createdAt || 0) - (a.createdAt || 0) : (a.dueAt || 8.64e15) - (b.dueAt || 8.64e15)));
  }, [ledger.invoices, tab, q, sort]);
  const paged = usePaged(rows, 12);

  return (
    <>
      <div className="page-head">
        <div><h1>Invoices</h1><p>Every amount due, with what has been paid and what remains.</p></div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setShow(true)}>New invoice</Button></div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Invoice status">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setParams(k === 'all' ? {} : { status: k })}>{label} <span className="tiny" style={{ color: 'inherit', opacity: 0.7 }}>{counts[k]}</span></button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <div className="grow-in"><Field label={<span className="sr-only">Search invoices</span>}>{(a) => <input {...a} type="search" placeholder="Search by number, reference or client" value={q} onChange={(e) => setQ(e.target.value)} />}</Field></div>
        <div style={{ width: 200 }}><SelectField label={<span className="sr-only">Sort</span>} value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS} /></div>
        <span className="count">{rows.length} invoice{rows.length === 1 ? '' : 's'}</span>
      </div>

      {ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} /> : ledger.busy && !ledger.invoices.length ? <Card><PanelSkeleton rows={6} /></Card> : (
        <Card flush>
          {ledger.invoices.length === 0 ? (
            <EmptyState title="No invoices yet" action={<Button variant="primary" icon={Plus} onClick={() => setShow(true)}>Create invoice</Button>}>Create a draft, then send it through PayPal when you are ready.</EmptyState>
          ) : (
            <>
              <DataTable label="Invoices" rows={paged.slice} onRowClick={(r) => navigate(`/invoices/${r.id}`)} empty="No invoices match these filters."
                columns={[
                  { key: 'n', label: 'Invoice', render: (r) => <><Link className="rec" to={`/invoices/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.number}</Link>{r.reference && <span className="sub">{r.reference}</span>}</> },
                  { key: 'c', label: 'Client', render: (r) => r.client?.name || '—' },
                  { key: 'i', label: 'Issued', render: (r) => fmtDate(r.sentAt || r.createdAt) },
                  { key: 'd', label: 'Due', render: (r) => <>{fmtDate(r.dueAt)}{r.open && <span className="sub">{dueLabel(r.dueAt)}</span>}</> },
                  { key: 't', label: 'Total', align: 'right', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> },
                  { key: 'p', label: 'Paid', align: 'right', render: (r) => <span className="num">{money(r.paid, r.currency)}</span> },
                  { key: 'b', label: 'Balance', align: 'right', render: (r) => <b className="num" style={{ fontWeight: 500 }}>{money(r.balance, r.currency)}</b> },
                  { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
                ]} />
              <Pager p={paged} />
            </>
          )}
        </Card>
      )}
      {show && <InvoiceForm clients={ledger.clients} onClose={() => { setShow(false); if (openNew) navigate('/invoices', { replace: true }); }} onSaved={(inv) => { setShow(false); ledger.reload(); navigate(inv?.id ? `/invoices/${inv.id}` : '/invoices'); }} />}
    </>
  );
}

function match(i, tab) {
  if (tab === 'all') return true;
  if (tab === 'open') return i.open;
  return i.status === tab;
}

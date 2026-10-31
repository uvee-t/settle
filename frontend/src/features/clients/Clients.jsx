import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, Field, Metric, PanelSkeleton, Pager, SelectField, StatusBadge, usePaged } from '../../components/ui.jsx';
import { ClientForm } from './ClientForm.jsx';
import { InvoiceForm } from '../invoices/InvoiceForm.jsx';
import { useLedger, usePageTitle } from '../../lib/hooks.js';
import { dueLabel, fmtDate, money, timeAgo } from '../../lib/format.js';

/** Balances per currency, never summed across currencies. */
function balances(invoices) {
  const m = {};
  for (const i of invoices) if (i.open) m[i.currency] = (m[i.currency] || 0) + i.balance;
  return m;
}
const BalanceText = ({ map }) => {
  const e = Object.entries(map);
  return e.length ? e.map(([c, v]) => <div key={c} className="num">{money(v, c)}</div>) : <span className="muted">—</span>;
};

function enrich(ledger) {
  return ledger.clients.map((c) => {
    const inv = ledger.invoices.filter((i) => i.clientId === c.id);
    const con = ledger.contracts.filter((x) => x.clientId === c.id);
    const stamps = [...inv.flatMap((i) => [i.createdAt, i.sentAt, ...i.events.map((e) => e.at)]), ...con.map((x) => x.createdAt && new Date(x.createdAt)), c.createdAt && new Date(c.createdAt)].filter((d) => d && !Number.isNaN(+d));
    return { ...c, invoices: inv, contracts: con, balance: balances(inv), activeContracts: con.filter((x) => !['completed', 'cancelled', 'archived'].includes(x.status)).length, last: stamps.length ? new Date(Math.max(...stamps)) : null, totalOpen: inv.filter((i) => i.open).reduce((s, i) => s + i.balance, 0) };
  });
}

export function Clients({ openNew = false }) {
  usePageTitle('Clients');
  const navigate = useNavigate();
  const ledger = useLedger();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const [form, setForm] = useState(openNew ? { client: null } : null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return enrich(ledger).filter((c) => !needle || `${c.name} ${c.company} ${c.email}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort === 'balance' ? b.totalOpen - a.totalOpen : sort === 'recent' ? (b.last || 0) - (a.last || 0) : a.name.localeCompare(b.name)));
  }, [ledger, q, sort]);
  const paged = usePaged(rows, 12);
  const close = () => { setForm(null); if (openNew) navigate('/clients', { replace: true }); };

  return (
    <>
      <div className="page-head">
        <div><h1>Clients</h1><p>Contacts you contract with and invoice, with what each one owes.</p></div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setForm({ client: null })}>New client</Button></div>
      </div>
      <div className="toolbar">
        <div className="grow-in"><Field label={<span className="sr-only">Search clients</span>}>{(a) => <input {...a} type="search" placeholder="Search name, company or email" value={q} onChange={(e) => setQ(e.target.value)} />}</Field></div>
        <div style={{ width: 210 }}><SelectField label={<span className="sr-only">Sort</span>} value={sort} onChange={(e) => setSort(e.target.value)} options={[['name', 'Name, A to Z'], ['balance', 'Outstanding, high to low'], ['recent', 'Recent activity']]} /></div>
        <span className="count">{rows.length} client{rows.length === 1 ? '' : 's'}</span>
      </div>
      {ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} /> : ledger.busy && !ledger.clients.length ? <Card><PanelSkeleton rows={6} /></Card> : (
        <Card flush>
          {!ledger.clients.length ? (
            <EmptyState title="No clients yet" action={<Button variant="primary" icon={Plus} onClick={() => setForm({ client: null })}>Add your first client</Button>}>Clients link your contracts, invoices and payments together.</EmptyState>
          ) : (
            <>
              <DataTable label="Clients" rows={paged.slice} onRowClick={(r) => navigate(`/clients/${r.id}`)} empty="No clients match your search."
                columns={[
                  { key: 'n', label: 'Client', render: (r) => <><Link className="rec" to={`/clients/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.name}</Link>{r.company && <span className="sub">{r.company}</span>}</> },
                  { key: 'e', label: 'Email', render: (r) => r.email || '—' },
                  { key: 'b', label: 'Outstanding', align: 'right', render: (r) => <BalanceText map={r.balance} /> },
                  { key: 'c', label: 'Active contracts', align: 'right', render: (r) => <span className="num">{r.activeContracts}</span> },
                  { key: 'l', label: 'Last activity', render: (r) => (r.last ? timeAgo(r.last) : '—') },
                  { key: 'a', label: '', align: 'right', render: (r) => <Button size="sm" icon={Pencil} onClick={(e) => { e.stopPropagation(); setForm({ client: r }); }} aria-label={`Edit ${r.name}`}>Edit</Button> },
                ]} />
              <Pager p={paged} />
            </>
          )}
        </Card>
      )}
      {form && <ClientForm client={form.client} onClose={close} onSaved={() => { close(); ledger.reload(); }} />}
    </>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ledger = useLedger();
  const [edit, setEdit] = useState(false);
  const [inv, setInv] = useState(false);
  const client = useMemo(() => enrich(ledger).find((c) => c.id === id), [ledger, id]);
  usePageTitle(client?.name || 'Client');
  const payments = useMemo(() => (client ? ledger.payments.filter((p) => client.invoices.some((i) => i.id === p.invoiceId)) : []), [ledger.payments, client]);

  if (ledger.error) return <ErrorState message={ledger.error} onRetry={ledger.reload} />;
  if (ledger.busy && !ledger.clients.length) return <PanelSkeleton rows={6} />;
  if (!client) return <EmptyState title="Client not found">This client does not exist in the current workspace. <Link to="/clients" style={{ color: 'var(--primary)' }}>Back to clients</Link></EmptyState>;

  return (
    <>
      <div className="page-head">
        <div><Link to="/clients" className="back-link">← Clients</Link><h1>{client.name}</h1><p>{[client.company, client.email, client.country].filter(Boolean).join(' · ') || 'No contact details yet.'}</p></div>
        <div className="page-actions"><Button icon={Pencil} onClick={() => setEdit(true)}>Edit</Button><Button variant="primary" icon={Plus} onClick={() => setInv(true)}>New invoice</Button></div>
      </div>
      <div className="metrics three">
        <Metric label="Outstanding" value={Object.keys(client.balance).length ? <BalanceText map={client.balance} /> : money(0)} detail={`${client.invoices.filter((i) => i.open).length} open invoices`} />
        <Metric label="Active contracts" value={client.activeContracts} detail={`${client.contracts.length} total`} />
        <Metric label="Last activity" value={client.last ? timeAgo(client.last) : '—'} detail={client.last ? fmtDate(client.last) : 'No records yet'} />
      </div>
      <div className="stack" style={{ marginTop: 16 }}>
        <Card title="Contracts" flush>
          <DataTable label="Client contracts" rows={client.contracts} onRowClick={(r) => navigate(`/contracts/${r.id}`)} empty="No contracts for this client."
            columns={[{ key: 't', label: 'Contract', render: (r) => <Link className="rec" to={`/contracts/${r.id}`}>{r.title}</Link> }, { key: 'v', label: 'Value', align: 'right', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> }, { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> }]} />
        </Card>
        <Card title="Invoices" flush>
          <DataTable label="Client invoices" rows={client.invoices} onRowClick={(r) => navigate(`/invoices/${r.id}`)} empty="No invoices for this client."
            columns={[
              { key: 'n', label: 'Invoice', render: (r) => <Link className="rec" to={`/invoices/${r.id}`}>{r.number}</Link> },
              { key: 'd', label: 'Due', render: (r) => <>{fmtDate(r.dueAt)}{r.open && <span className="sub">{dueLabel(r.dueAt)}</span>}</> },
              { key: 't', label: 'Total', align: 'right', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> },
              { key: 'b', label: 'Balance', align: 'right', render: (r) => <span className="num">{money(r.balance, r.currency)}</span> },
              { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
            ]} />
        </Card>
        <Card title="Payments" flush>
          <DataTable label="Client payments" rows={payments} empty="No payments recorded."
            columns={[{ key: 'a', label: 'Amount', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> }, { key: 'm', label: 'Method', render: (r) => r.method || '—' }, { key: 'd', label: 'Date', render: (r) => fmtDate(r.at) }, { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> }]} />
        </Card>
      </div>
      {edit && <ClientForm client={client} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); ledger.reload(); }} />}
      {inv && <InvoiceForm clients={ledger.clients} defaultClientId={client.id} onClose={() => setInv(false)} onSaved={(x) => { setInv(false); ledger.reload(); if (x?.id) navigate(`/invoices/${x.id}`); }} />}
    </>
  );
}

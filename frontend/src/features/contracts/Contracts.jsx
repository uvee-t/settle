import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Async, Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, Modal, Notice, PanelSkeleton, SelectField, StatusBadge, TextArea, TextField, useToast } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate, useData, useLedger, usePageTitle } from '../../lib/hooks.js';
import { asList, normContract } from '../../lib/models.js';
import { fmtDate, money, num, toDate } from '../../lib/format.js';

const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP'];
const iso = (d) => (d ? new Date(d).toISOString() : undefined);

function ContractForm({ clients, onClose, onSaved }) {
  const [v, setV] = useState({ client_id: '', title: '', currency: 'USD', total_amount: '', starts_at: '', ends_at: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const err = {};
  if (!v.client_id) err.client_id = 'Choose a client.';
  if (!v.title.trim()) err.title = 'Enter a title.';
  if (v.total_amount !== '' && !(Number(v.total_amount) >= 0)) err.total_amount = 'Enter a valid amount.';
  if (v.starts_at && v.ends_at && v.ends_at < v.starts_at) err.ends_at = 'End date must be after the start date.';
  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(err).length) return;
    setBusy(true); setError('');
    try {
      const saved = await api('/v1/contracts', { method: 'POST', body: JSON.stringify({ client_id: v.client_id, title: v.title.trim(), currency: v.currency, total_amount: v.total_amount || undefined, starts_at: iso(v.starts_at), ends_at: iso(v.ends_at) }) });
      invalidate('/v1/contracts');
      onSaved(saved);
    } catch (ex) { setError(ex.message); } finally { setBusy(false); }
  }
  const e = (k) => (touched ? err[k] : undefined);
  return (
    <Modal title="New contract" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Notice>{error}</Notice>
        <SelectField label="Client" required value={v.client_id} onChange={set('client_id')} placeholder="Select client" error={e('client_id')} options={clients.map((c) => [c.id, c.name])} data-autofocus />
        <TextField label="Contract title" required value={v.title} onChange={set('title')} error={e('title')} />
        <div className="form-grid">
          <TextField label="Contract value" type="number" min="0" step="0.01" inputMode="decimal" value={v.total_amount} onChange={set('total_amount')} error={e('total_amount')} />
          <SelectField label="Currency" value={v.currency} onChange={set('currency')} options={CURRENCIES} />
          <TextField label="Start date" type="date" value={v.starts_at} onChange={set('starts_at')} />
          <TextField label="End date" type="date" value={v.ends_at} onChange={set('ends_at')} error={e('ends_at')} />
        </div>
        <div className="form-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" loading={busy}>{busy ? 'Creating…' : 'Create contract'}</Button></div>
      </form>
    </Modal>
  );
}

export function Contracts({ openNew = false }) {
  usePageTitle('Contracts');
  const navigate = useNavigate();
  const ledger = useLedger();
  const [show, setShow] = useState(openNew);
  const clientName = (id) => ledger.clients.find((c) => c.id === id)?.name || '—';
  return (
    <>
      <div className="page-head">
        <div><h1>Contracts</h1><p>Agreements, their milestones, and the work still to bill.</p></div>
        <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setShow(true)}>New contract</Button></div>
      </div>
      {ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} /> : ledger.busy && !ledger.contracts.length ? <Card><PanelSkeleton rows={5} /></Card> : (
        <Card flush>
          {!ledger.contracts.length ? <EmptyState title="No contracts yet" action={<Button variant="primary" icon={Plus} onClick={() => setShow(true)}>Create a contract</Button>}>Add a contract, then break it into milestones that turn into invoices.</EmptyState> : (
            <DataTable label="Contracts" rows={ledger.contracts} onRowClick={(r) => navigate(`/contracts/${r.id}`)}
              columns={[
                { key: 't', label: 'Contract', render: (r) => <><Link className="rec" to={`/contracts/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.title}</Link><span className="sub">Created {fmtDate(r.createdAt)}</span></> },
                { key: 'c', label: 'Client', render: (r) => clientName(r.clientId) },
                { key: 'v', label: 'Value', align: 'right', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> },
                { key: 'p', label: 'Period', render: (r) => (r.startsAt || r.endsAt ? `${fmtDate(r.startsAt)} to ${fmtDate(r.endsAt)}` : '—') },
                { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status} /> },
              ]} />
          )}
        </Card>
      )}
      {show && <ContractForm clients={ledger.clients} onClose={() => { setShow(false); if (openNew) navigate('/contracts', { replace: true }); }} onSaved={(c) => { setShow(false); ledger.reload(); navigate(c?.id ? `/contracts/${c.id}` : '/contracts'); }} />}
    </>
  );
}

function MilestoneForm({ contractId, currency, onClose, onSaved }) {
  const [v, setV] = useState({ name: '', description: '', amount: '', due_at: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const err = {};
  if (!v.name.trim()) err.name = 'Enter a milestone name.';
  if (v.amount !== '' && !(Number(v.amount) >= 0)) err.amount = 'Enter a valid amount.';
  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(err).length) return;
    setBusy(true); setError('');
    try {
      await api(`/v1/contracts/${contractId}/milestones`, { method: 'POST', body: JSON.stringify({ name: v.name.trim(), description: v.description.trim() || undefined, amount: v.amount || undefined, due_at: iso(v.due_at) }) });
      onSaved();
    } catch (ex) { setError(ex.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Add milestone" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Notice>{error}</Notice>
        <TextField label="Milestone name" required value={v.name} onChange={set('name')} error={touched ? err.name : undefined} data-autofocus />
        <TextArea label="Description" value={v.description} onChange={set('description')} rows={3} />
        <div className="form-grid">
          <TextField label={`Amount (${currency})`} type="number" min="0" step="0.01" inputMode="decimal" value={v.amount} onChange={set('amount')} error={touched ? err.amount : undefined} />
          <TextField label="Due date" type="date" value={v.due_at} onChange={set('due_at')} />
        </div>
        <div className="form-actions"><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" type="submit" loading={busy}>{busy ? 'Saving…' : 'Create milestone'}</Button></div>
      </form>
    </Modal>
  );
}

/** Horizontal timeline of milestone due dates against today. */
function MilestoneTimeline({ items }) {
  const dated = items.filter((m) => toDate(m.dueAt || m.due_at));
  if (dated.length < 1) return <p className="muted" style={{ fontSize: 13 }}>Add due dates to milestones to see them on a timeline.</p>;
  const t = (m) => +toDate(m.dueAt || m.due_at);
  const today = Date.now();
  const lo = Math.min(...dated.map(t), today), hi = Math.max(...dated.map(t), today);
  const span = Math.max(hi - lo, 864e5 * 7);
  const pos = (x) => `${((x - lo) / span) * 94 + 1}%`;
  return (
    <div className="timeline-h" role="img" aria-label="Milestone due dates on a timeline">
      {dated.sort((a, b) => t(a) - t(b)).map((m) => (
        <div className="tl-row" key={m.id}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
          <div className="tl-track">
            <div className={`tl-bar ${m.status === 'completed' ? 'done' : ''}`} style={{ left: pos(t(m)), width: 10, borderRadius: 5 }} title={fmtDate(m.dueAt || m.due_at)} />
            <div className="tl-today" style={{ left: pos(today) }} />
          </div>
        </div>
      ))}
      <p className="tiny">Red line marks today. Green dots are completed milestones.</p>
    </div>
  );
}

export function ContractDetail() {
  const { id } = useParams();
  const toast = useToast();
  const state = useData(`/v1/contracts/${id}`);
  const clients = useData('/v1/clients');
  const [show, setShow] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const contract = useMemo(() => (state.data ? normContract(state.data) : null), [state.data]);
  const milestones = state.data?.milestones || [];
  const client = asList(clients.data).find((c) => c.id === contract?.clientId);
  usePageTitle(contract?.title || 'Contract');
  const planned = milestones.reduce((s, m) => s + num(m.amount), 0);

  async function complete(m) {
    setBusy(true); setMessage(null);
    try {
      await api(`/v1/milestones/${m.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
      invalidate('/v1/');
      setMessage({ kind: 'success', text: 'Milestone completed. Settle ran its billing step. Check Invoices for the draft.' });
      await state.reload();
    } catch (e) { setMessage({ kind: 'error', text: e.message }); } finally { setBusy(false); setConfirm(null); }
  }
  async function bill(m) {
    setBusy(true); setMessage(null);
    try {
      const r = await api(`/v1/milestones/${m.id}/bill`, { method: 'POST', body: JSON.stringify({}) });
      invalidate('/v1/');
      setMessage({ kind: 'success', text: `Invoice ${r?.invoice?.invoiceNumber || r?.invoice?.id || ''} created or already linked.`, invoiceId: r?.invoice?.id });
      await state.reload();
    } catch (e) { setMessage({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div><Link to="/contracts" className="back-link">← Contracts</Link><h1>{contract?.title || 'Contract'}</h1>{contract && <p>{client?.name || 'Client not found'}</p>}</div>
        {contract && <div className="page-actions"><Button variant="primary" icon={Plus} onClick={() => setShow(true)}>Add milestone</Button></div>}
      </div>
      <Async state={state} rows={5}>
        {contract && (
          <div className="stack">
            {message && <Notice kind={message.kind} onClose={() => setMessage(null)}>{message.text} {message.invoiceId && <Link to={`/invoices/${message.invoiceId}`} style={{ textDecoration: 'underline' }}>Open invoice</Link>}</Notice>}
            <div className="detail-grid">
              <Card title="Contract details" actions={<StatusBadge value={contract.status} />}>
                <dl className="dl">
                  <dt>Client</dt><dd>{client ? <Link className="rec" to={`/clients/${client.id}`} style={{ color: 'var(--primary)' }}>{client.name}</Link> : '—'}</dd>
                  <dt>Contract value</dt><dd className="num">{money(contract.amount, contract.currency)}</dd>
                  <dt>Planned in milestones</dt><dd className="num">{money(planned, contract.currency)}{contract.amount > 0 && planned !== contract.amount && <span className="tiny"> ({money(contract.amount - planned, contract.currency)} unallocated)</span>}</dd>
                  <dt>Start</dt><dd>{fmtDate(contract.startsAt)}</dd><dt>End</dt><dd>{fmtDate(contract.endsAt)}</dd>
                </dl>
              </Card>
              <Card title="Timeline" sub="Milestone due dates"><MilestoneTimeline items={milestones} /></Card>
            </div>
            <Card title="Milestones" sub="Completing a milestone creates or links a draft invoice. Sent invoices are never changed by editing a milestone." flush>
              <DataTable label="Milestones" rows={milestones} empty="No milestones yet. Add the first one to start billing."
                columns={[
                  { key: 'n', label: 'Milestone', render: (m) => <>{m.name}{m.description && <span className="sub">{m.description}</span>}</> },
                  { key: 'd', label: 'Due', render: (m) => fmtDate(m.dueAt || m.due_at) },
                  { key: 'a', label: 'Amount', align: 'right', render: (m) => <span className="num">{money(m.amount, contract.currency)}</span> },
                  { key: 's', label: 'Status', render: (m) => <StatusBadge value={m.status} /> },
                  { key: 'x', label: '', align: 'right', render: (m) => (m.status !== 'completed' ? <Button size="sm" disabled={busy} onClick={() => setConfirm(m)}>Complete and draft invoice</Button> : <Button size="sm" disabled={busy} onClick={() => bill(m)}>Open invoice</Button>) },
                ]} />
            </Card>
          </div>
        )}
      </Async>
      {show && <MilestoneForm contractId={id} currency={contract?.currency || 'USD'} onClose={() => setShow(false)} onSaved={() => { setShow(false); toast('Milestone added.'); state.reload(); }} />}
      {confirm && <ConfirmDialog title="Mark milestone complete?" confirmLabel="Complete milestone" busy={busy} onClose={() => setConfirm(null)} onConfirm={() => complete(confirm)}>“{confirm.name}” will be marked completed and Settle will create or link a draft invoice for {money(confirm.amount, contract.currency)}. Nothing is sent to the client until you send the invoice.</ConfirmDialog>}
    </>
  );
}

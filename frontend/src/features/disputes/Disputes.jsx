import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { Async, Button, Card, DataTable, EmptyState, Notice, StatusBadge, TextField } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate, useData, usePageTitle } from '../../lib/hooks.js';
import { asList } from '../../lib/models.js';
import { fmtDate, money, titleCase } from '../../lib/format.js';

export function Disputes() {
  usePageTitle('Disputes');
  const state = useData('/v1/disputes');
  const [txn, setTxn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const rows = asList(state.data);

  async function syncAll() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api('/v1/disputes/sync', { method: 'POST', body: JSON.stringify({}) });
      invalidate('/v1/disputes');
      await state.reload();
      setNotice(`PayPal sync completed: ${r?.synced || 0} dispute(s) synchronized.`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function byTxn(e) {
    e.preventDefault();
    if (!txn.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api(`/v1/disputes/by-transaction/${encodeURIComponent(txn.trim())}`);
      invalidate('/v1/disputes');
      await state.reload();
      setNotice(`${(r?.items || []).length} PayPal dispute(s) found for this transaction.`);
    } catch (ex) { setError(ex.message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Disputes</h1><p>Review PayPal disputes, organize evidence, and respond.</p></div>
        <div className="page-actions"><Button icon={RefreshCw} onClick={state.reload}>Refresh</Button><Button variant="primary" icon={RefreshCw} loading={busy} onClick={syncAll}>Sync PayPal disputes</Button></div>
      </div>
      <Notice>{error}</Notice>
      <Notice kind="success">{notice}</Notice>
      <Card title="Look up a transaction" sub="Use the 17-character seller transaction ID from a completed PayPal payment. Order, invoice, and dispute IDs are not accepted.">
        <form className="form" onSubmit={byTxn} style={{ gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'end' }}>
          <TextField label="PayPal seller transaction ID" value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="17-character PayPal transaction ID" />
          <Button variant="primary" type="submit" loading={busy} disabled={!txn.trim()}>Find disputes</Button>
        </form>
      </Card>
      <Card title="All disputes" sub={`${rows.length} case${rows.length === 1 ? '' : 's'}`} flush>
        <Async state={state} rows={4}>
          {rows.length ? (
            <DataTable label="Disputes" rows={rows}
              columns={[
                { key: 'd', label: 'Dispute', render: (r) => <><Link className="rec mono" to={`/disputes/${r.id}`}>{r.providerDisputeId || r.provider_dispute_id || r.id}</Link><span className="sub">{r.providerTransactionId || r.provider_transaction_id || 'Transaction not linked'}</span></> },
                { key: 's', label: 'Status', render: (r) => <StatusBadge value={r.status || r.disputeState || r.dispute_state} /> },
                { key: 'r', label: 'Reason', render: (r) => titleCase(r.reason || '—') },
                { key: 'a', label: 'Amount', align: 'right', render: (r) => (r.amount ? <span className="num">{money(r.amount, r.currency)}</span> : '—') },
                { key: 'due', label: 'Respond by', render: (r) => fmtDate(r.sellerResponseDueAt || r.seller_response_due_at) },
                { key: 'u', label: 'Updated', render: (r) => fmtDate(r.updatedAt || r.updated_at) },
                { key: 'o', label: '', align: 'right', render: (r) => <Link className="btn sm" to={`/disputes/${r.id}`}>Open case <ChevronRight size={13} /></Link> },
              ]} />
          ) : <EmptyState title="No disputes">Sync PayPal disputes, or look up a completed transaction after a buyer opens a case.</EmptyState>}
        </Async>
      </Card>
    </>
  );
}

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, Printer, Send } from 'lucide-react';
import { Async, Button, Card, ConfirmDialog, DataTable, Notice, StatusBadge, useToast } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate, useData, usePageTitle } from '../../lib/hooks.js';
import { asList, buildLedger, normClient, normInvoice, normPayment } from '../../lib/models.js';
import { dueLabel, fmtDate, fmtDateTime, money, num } from '../../lib/format.js';
import { session } from '../../services/api.js';

const LINK_KEYS = ['paymentUrl', 'payment_url', 'recipientViewUrl', 'recipient_view_url', 'providerUrl', 'provider_url', 'invoiceUrl', 'invoice_url'];

export default function InvoiceDetail() {
  const { id } = useParams();
  const toast = useToast();
  const inv = useData(`/v1/invoices/${id}`);
  const clients = useData('/v1/clients');
  const payments = useData('/v1/payments');
  const [confirm, setConfirm] = useState(null);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState(null);

  const row = useMemo(() => {
    if (!inv.data) return null;
    const ledger = buildLedger({ invoices: [normInvoice(inv.data)], payments: asList(payments.data).map(normPayment), clients: asList(clients.data).map(normClient) });
    return ledger.invoices[0];
  }, [inv.data, clients.data, payments.data]);
  usePageTitle(row?.number || 'Invoice');

  const link = inv.data && LINK_KEYS.map((k) => inv.data[k]).find(Boolean);

  async function run(action) {
    setWorking(true);
    setResult(null);
    try {
      await api(`/v1/invoices/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      invalidate('/v1/');
      await inv.reload();
      const msg = action === 'send' ? 'The payment provider accepted the invoice and it is now sent.' : action === 'remind' ? 'The reminder request was accepted by the payment provider.' : 'The invoice was cancelled.';
      setResult({ kind: 'success', text: msg });
      toast(msg);
    } catch (e) {
      setResult({ kind: 'error', text: e.message });
    } finally {
      setWorking(false);
      setConfirm(null);
    }
  }

  const isDraft = row?.rawStatus === 'draft';
  const canRemind = row && row.open && !isDraft;
  const ws = session().workspace?.name || 'Your workspace';

  const timeline = row && [
    row.createdAt && { at: row.createdAt, label: 'Draft created', tone: 'var(--text-3)' },
    row.sentAt && { at: row.sentAt, label: 'Sent through PayPal', tone: 'var(--primary)' },
    ...row.events.map((e) => ({ at: e.at, label: `Payment of ${money(e.amount, e.currency)} received`, tone: 'var(--success)' })),
    row.dueAt && { at: row.dueAt, dateOnly: true, label: row.open && row.dueAt < new Date() ? 'Became overdue' : 'Due date', tone: row.open && row.dueAt < new Date() ? 'var(--danger)' : 'var(--text-3)' },
  ].filter(Boolean).sort((a, b) => a.at - b.at);

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/invoices" className="back-link">← Invoices</Link>
          <h1>{row?.number || 'Invoice'}</h1>
          {row && <p>{row.client?.name || 'Client not found'}{row.open ? `. ${dueLabel(row.dueAt)}` : ''}</p>}
        </div>
        {row && (
          <div className="page-actions">
            <Button icon={Printer} onClick={() => window.print()}>Print</Button>
            {link && <Button icon={Copy} onClick={() => navigator.clipboard?.writeText(link).then(() => toast('Payment link copied.'), () => toast('Copy failed. Select the link and copy it manually.', 'error'))}>Copy payment link</Button>}
            {canRemind && <Button disabled={working} onClick={() => setConfirm('remind')}>Send reminder</Button>}
            {isDraft && <Button disabled={working} onClick={() => setConfirm('cancel')}>Cancel invoice</Button>}
            {isDraft && <Button variant="primary" icon={Send} disabled={working} onClick={() => setConfirm('send')}>Send via PayPal</Button>}
          </div>
        )}
      </div>

      <Async state={inv} rows={5}>
        {row && (
          <>
            {result && <Notice kind={result.kind} onClose={() => setResult(null)}>{result.text}</Notice>}
            <div className="detail-grid">
              <div className="inv-doc" aria-label="Invoice preview">
                <div className="inv-top">
                  <div><div className="tiny mono" style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>Invoice</div><h2 className="mono">{row.number}</h2></div>
                  <div style={{ textAlign: 'right' }}><StatusBadge value={row.status} /><div className="tiny" style={{ marginTop: 6 }}>{ws}</div></div>
                </div>
                <div className="inv-meta">
                  <div><small>Billed to</small><b>{row.client?.name || '—'}</b><div className="tiny">{row.client?.email}</div></div>
                  <div><small>Issued</small>{fmtDate(row.sentAt || row.createdAt)}</div>
                  <div><small>Due</small>{fmtDate(row.dueAt)}</div>
                </div>
                <DataTable label="Line items" rows={row.items} rowKey={(x, i) => x.id || i} empty="No line items."
                  columns={[
                    { key: 'd', label: 'Description', render: (x) => x.description },
                    { key: 'q', label: 'Qty', align: 'right', render: (x) => <span className="num">{x.quantity}</span> },
                    { key: 'u', label: 'Unit', align: 'right', render: (x) => <span className="num">{money(x.unitAmount ?? x.unit_amount, row.currency)}</span> },
                    { key: 't', label: 'Total', align: 'right', render: (x) => <span className="num">{money(num(x.quantity) * num(x.unitAmount ?? x.unit_amount), row.currency)}</span> },
                  ]} />
                <div className="inv-total">
                  <div><span>Total</span><span className="num">{money(row.amount, row.currency)}</span></div>
                  <div><span>Paid</span><span className="num">{money(row.paid, row.currency)}</span></div>
                  <div className="grand"><span>Balance due</span><b className="num">{money(row.balance, row.currency)}</b></div>
                </div>
                {row.reference && <p className="tiny" style={{ marginTop: 16 }}>Reference: {row.reference}</p>}
              </div>

              <div className="stack">
                <Card title="Payment provider">
                  <dl className="dl">
                    <dt>Provider invoice ID</dt><dd className="mono">{row.providerId || 'Not created yet'}</dd>
                    <dt>Currency</dt><dd>{row.currency}</dd>
                    <dt>Payment link</dt><dd>{link ? <a className="rec" href={link} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--primary)' }}>Open payment page</a> : 'Available after sending'}</dd>
                  </dl>
                  <p className="note">Settle reports a send as successful only when the payment provider confirms it. If PayPal rejects the request, the error is shown here and the invoice stays a draft.</p>
                </Card>
                <Card title="Payments">
                  <Async state={{ ...payments, data: payments.data || [] }} rows={2}>
                    {row.payments.length ? (
                      <ul className="feed">{row.payments.map((p) => <li key={p.id}><span className="dot" style={{ color: 'var(--success)' }} /><div><div className="t"><b>{money(p.amount, p.currency)}</b> {p.method && <>via {p.method}</>}</div><div className="d">{fmtDateTime(p.at)} {p.reference && `· ${p.reference}`}</div></div></li>)}</ul>
                    ) : <p className="muted" style={{ fontSize: 13 }}>{row.rawStatus === 'paid' ? 'Marked paid. No separate payment record was returned.' : 'No payments recorded yet.'}</p>}
                  </Async>
                </Card>
                <Card title="Timeline">
                  <ul className="feed">{timeline.map((e, i) => <li key={i}><span className="dot" style={{ color: e.tone }} /><div><div className="t">{e.label}</div><div className="d">{e.dateOnly ? fmtDate(e.at) : fmtDateTime(e.at)}</div></div></li>)}</ul>
                </Card>
              </div>
            </div>
          </>
        )}
      </Async>

      {confirm === 'send' && <ConfirmDialog title="Send this invoice?" confirmLabel="Send via PayPal" busy={working} onClose={() => setConfirm(null)} onConfirm={() => run('send')}>It will be created and sent through your connected PayPal account to {row.client?.email || 'the client'}. This is a real request to PayPal and cannot be unsent.</ConfirmDialog>}
      {confirm === 'remind' && <ConfirmDialog title="Send a reminder?" confirmLabel="Send reminder" busy={working} onClose={() => setConfirm(null)} onConfirm={() => run('remind')}>A payment reminder for {row.number} will be requested from PayPal.</ConfirmDialog>}
      {confirm === 'cancel' && <ConfirmDialog title="Cancel this invoice?" confirmLabel="Cancel invoice" danger busy={working} onClose={() => setConfirm(null)} onConfirm={() => run('cancel')}>The draft will be cancelled and removed from your open balances.</ConfirmDialog>}
    </>
  );
}

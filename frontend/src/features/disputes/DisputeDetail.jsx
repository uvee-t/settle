import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, FileText, RefreshCw, Send } from 'lucide-react';
import { Button, Card, ConfirmDialog, EmptyState, Notice, PanelSkeleton, ErrorState, SelectField, StatusBadge, TextArea, DataTable } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { useData, usePageTitle } from '../../lib/hooks.js';
import { asList } from '../../lib/models.js';
import { fmtDate, fmtDateTime, money, titleCase } from '../../lib/format.js';
import { ACCEPT, uploadDocument } from '../../lib/upload.js';

const LOCKED = ['APPROVED', 'SUBMITTED'];
const TYPES = [['OTHER', 'Other supporting evidence'], ['PROOF_OF_FULFILLMENT', 'Proof of fulfillment'], ['PROOF_OF_REFUND', 'Proof of refund'], ['PROOF_OF_DELIVERY_SIGNATURE', 'Proof of delivery signature'], ['PROOF_OF_RECEIPT_COPY', 'Proof of receipt / invoice'], ['COPY_OF_CONTRACT', 'Copy of contract'], ['ITEM_DESCRIPTION', 'Item description'], ['COMMUNICATION', 'Communication']];
const isSel = (i) => i.selected === true || i.selected === 'true';

export function DisputeDetail() {
  const { id } = useParams();
  usePageTitle('Dispute');
  const docs = useData('/v1/documents');
  const [record, setRecord] = useState(null);
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [message, setMessage] = useState('');
  const [proof, setProof] = useState(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [proofType, setProofType] = useState('PROOF_OF_FULFILLMENT');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [copilot, setCopilot] = useState(null);
  const [copilotBusy, setCopilotBusy] = useState(false);

  async function load() {
    setLoading(true); setLoadError('');
    try {
      const local = asList(await api('/v1/disputes')).find((d) => d.id === id);
      if (!local) throw new Error('Dispute not found in this workspace. Refresh the list or sync the transaction again.');
      const providerId = local.providerDisputeId || local.provider_dispute_id;
      const detail = await api(`/v1/disputes/${encodeURIComponent(providerId)}`);
      setRecord({ ...detail.local, ...(detail.provider || {}), id: local.id, providerDisputeId: providerId, local });
      // Loading dispute details syncs the latest PayPal state on the backend.
      // Refresh an already-open evidence pack afterwards so its requirement
      // state cannot remain stale after the provider refresh.
      if (pack) {
        const refreshedPack = await api(`/v1/disputes/${id}/evidence-pack`);
        setPack(refreshedPack);
      }
    } catch (e) { setLoadError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn) => { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const loadPack = () => act(async () => { const next = await api(`/v1/disputes/${id}/evidence-pack`); setPack(next); const nextRequested = (next.requirements || []).find((r) => (!r.source || r.source === 'REQUESTED_FROM_SELLER') && r.status !== 'COMPLETED'); if (nextRequested?.providerEvidenceType) setProofType(nextRequested.providerEvidenceType); });
  const attach = (documentId) => act(async () => {
    const currentPack = pack || await api(`/v1/disputes/${id}/evidence-pack`);
    const requested = (currentPack.requirements || []).find((r) => (!r.source || r.source === 'REQUESTED_FROM_SELLER') && r.status !== 'COMPLETED');
    const requestedType = requested?.providerEvidenceType;
    const validRequestedTypes = (currentPack.requirements || []).filter((r) => !r.source || r.source === 'REQUESTED_FROM_SELLER').map((r) => String(r.providerEvidenceType || '').toUpperCase());
    const typeToAttach = requestedType && !validRequestedTypes.includes(String(proofType).toUpperCase()) ? requestedType : proofType;
    await api(`/v1/disputes/${id}/evidence-pack/documents`, { method: 'POST', body: JSON.stringify({ document_id: documentId, evidence_type: typeToAttach }) });
    const next = await api(`/v1/disputes/${id}/evidence-pack`); setPack(next);
    const nextRequested = (next.requirements || []).find((r) => (!r.source || r.source === 'REQUESTED_FROM_SELLER') && r.status !== 'COMPLETED'); if (nextRequested?.providerEvidenceType) setProofType(nextRequested.providerEvidenceType);
    setNotice('Verified document attached to the evidence pack. Review its claim before approval.');
  });
  const review = (action) => act(async () => {
    const selected = (pack?.items || []).filter(isSel).map((i) => i.id);
    const r = await api(`/v1/disputes/${id}/evidence-pack/review`, { method: 'POST', body: JSON.stringify({ action, selected_item_ids: selected }) });
    setPack((p) => ({ ...p, evidence_pack: r.pack, items: r.items }));
    setNotice(action === 'approve' ? 'Evidence pack approved. You can now submit it to PayPal.' : 'Evidence pack rejected. Regenerate or review it before approval.');
  });
  const submit = () => act(async () => {
    const r = await api(`/v1/disputes/${id}/evidence-pack/submit`, { method: 'POST', body: JSON.stringify({}) });
    setPack((p) => ({ ...p, evidence_pack: r.pack, submissions: r.submissions }));
    setNotice(`PayPal submission request completed (${(r.submissions || []).length} evidence item(s)).`);
    setConfirmSubmit(false);
    await load();
  }).finally(() => setConfirmSubmit(false));
  const send = (e) => { e.preventDefault(); act(async () => { await api(`/v1/disputes/${encodeURIComponent(record.providerDisputeId)}/message`, { method: 'POST', body: JSON.stringify({ content: message }) }); setMessage(''); setNotice('Message sent to PayPal. Refreshing conversation…'); await load(); }); };
  const runCopilot = () => {
    setCopilotBusy(true); setError(''); setNotice('');
    api(`/v1/disputes/${encodeURIComponent(record.providerDisputeId)}/ai-copilot`, { method: 'POST', body: JSON.stringify({}) })
      .then((r) => { setCopilot(r.result); setNotice('Gemini dispute analysis completed. Review all recommendations before acting.'); })
      .catch((e) => setError(e.message))
      .finally(() => setCopilotBusy(false));
  };
  async function uploadProof(e) {
    e.preventDefault();
    if (!proof) return;
    setProofBusy(true); setError(''); setNotice('');
    try {
      await uploadDocument(proof, { purpose: 'dispute-evidence', dispute_id: id });
      setProof(null);
      await docs.reload();
      setNotice('File uploaded to workspace Documents. When verification finishes, attach it below to include it in this pack.');
    } catch (ex) { setError(ex.message); } finally { setProofBusy(false); }
  }

  const v = (...keys) => keys.map((k) => record?.[k]).find((x) => x !== undefined && x !== null && x !== '') ?? '—';
  const locked = LOCKED.includes(pack?.evidence_pack?.status);
  const status = pack?.evidence_pack?.status;
  const requestedRequirements = (pack?.requirements || []).filter((r) => !r.source || r.source === 'REQUESTED_FROM_SELLER');
  const requirementRows = requestedRequirements.map((r) => { const type = String(r.providerEvidenceType || '').toUpperCase(); const matches = (pack?.items || []).filter((i) => isSel(i) && String(i.evidenceType || i.evidence_type || '').toUpperCase() === type); return { type, required: r.required !== 'false', matches: matches.length }; });
  const dynamicTypeOptions = [...new Map([...TYPES, ...requestedRequirements.map((r) => [String(r.providerEvidenceType || '').toUpperCase(), titleCase(String(r.providerEvidenceType || '').replaceAll('_', ' '))])].filter((x) => x[0]).map((x) => [x[0], x])).values()];
  const amount = record?.dispute_amount?.value ? money(record.dispute_amount.value, record.dispute_amount.currency_code) : record?.amount ? money(record.amount, record.currency) : '—';

  return (
    <>
      <div className="page-head">
        <div><Link to="/disputes" className="back-link">← Disputes</Link><h1>Dispute {record?.providerDisputeId || ''}</h1><p>Review the case, assemble evidence, and respond through PayPal.</p></div>
      </div>
      {loading && !record ? <PanelSkeleton rows={6} /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : record && (
        <div className="stack">
          <Notice>{error}</Notice>
          <Notice kind="success">{notice}</Notice>
          <div className="detail-grid">
            <Card title="Case summary" actions={<StatusBadge value={v('status', 'disputeState', 'dispute_state')} />}>
              <dl className="dl">
                <dt>PayPal dispute ID</dt><dd className="mono">{record.providerDisputeId}</dd>
                <dt>Reason</dt><dd>{titleCase(String(v('reason')))}</dd>
                <dt>Dispute state</dt><dd>{titleCase(String(v('dispute_state', 'disputeState')))}</dd>
                <dt>Lifecycle stage</dt><dd>{titleCase(String(v('dispute_life_cycle_stage', 'lifecycleStage', 'lifecycle_stage')))}</dd>
                <dt>Amount</dt><dd className="amount-big num">{amount}</dd>
                <dt>Respond by</dt><dd>{fmtDate(v('seller_response_due_date', 'sellerResponseDueAt', 'seller_response_due_at'))}</dd>
                <dt>Transaction ID</dt><dd className="mono">{record.providerTransactionId || record.provider_transaction_id || record.disputed_transactions?.[0]?.seller_transaction_id || '—'}</dd>
                <dt>Seller protection</dt><dd>{String(v('seller_protection_eligible', 'sellerProtectionEligible', 'seller_protection_type'))}</dd>
              </dl>
            </Card>
            <Card title="PayPal case details" sub="Latest provider state" actions={<Button size="sm" icon={RefreshCw} onClick={load}>Refresh</Button>}>
              <dl className="dl">
                <dt>Channel</dt><dd>{String(v('dispute_channel', 'channel'))}</dd>
                <dt>Opened</dt><dd>{fmtDateTime(v('create_time', 'createTime'))}</dd>
                <dt>Updated</dt><dd>{fmtDateTime(v('update_time', 'updateTime', 'updatedAt'))}</dd>
                <dt>Allowed actions</dt><dd>{Array.isArray(record.allowed_response_options?.items) ? record.allowed_response_options.items.map((x) => x.name || x.type || 'Action').join(', ') : record.allowed_response_options ? JSON.stringify(record.allowed_response_options) : '—'}</dd>
              </dl>
              <div className="actions-row"><Button icon={FileText} onClick={loadPack} loading={busy && !pack}>{pack ? 'Refresh evidence pack' : 'Generate evidence pack'}</Button></div>
            </Card>
          </div>

          <Card title="Evidence pack" sub="Built from your invoices, payments, contracts, completed milestones, communications and verified documents. Every item shows where it came from." actions={<StatusBadge value={status || 'not generated'} />}>
            <div className="form" style={{ marginBottom: 16 }}>
              <b style={{ fontWeight: 500 }}>Add supporting documents</b>
              <p className="muted" style={{ fontSize: 13 }}>Upload a file to your workspace, then attach it once it is verified. PayPal submission depends on the provider’s supported evidence attachment API.</p>
              <form className="form-grid" onSubmit={uploadProof} style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr) auto', alignItems: 'end' }}>
                <SelectField label="Evidence type" value={proofType} onChange={(e) => setProofType(e.target.value)} options={dynamicTypeOptions} />
                <div className="field"><label htmlFor="proof">File</label><input id="proof" type="file" accept={ACCEPT} onChange={(e) => setProof(e.target.files?.[0] || null)} /></div>
                <Button type="submit" loading={proofBusy} disabled={!proof}>Upload proof</Button>
              </form>
              {asList(docs.data).length > 0 && (
                <div>{asList(docs.data).map((d) => {
                  const ver = d.verificationStatus || d.verification_status || 'pending';
                  return <div className="doc-row" key={d.id}><span><b>{d.filename || d.name}</b><small>{titleCase(ver)} · {d.contentType || d.content_type}</small></span><Button size="sm" disabled={busy || ver !== 'verified' || locked} onClick={() => attach(d.id)}>Attach</Button></div>;
                })}</div>
              )}
            </div>

            {!pack ? <EmptyState title="No evidence pack yet">Generate one to collect the relevant records and prepare your response.</EmptyState> : (
              <>
                {requirementRows.length > 0 ? <div className="stack" style={{ marginBottom: 16 }}><h3>PayPal evidence requirements</h3><div className="evidence-summary">{requirementRows.map((r) => <div key={r.type}><span>{titleCase(r.type.replaceAll('_', ' '))}{r.required ? ' · Required' : ' · Optional'}</span><b style={{ color: r.matches ? 'var(--success)' : 'var(--danger)' }}>{r.matches ? `${r.matches} matched` : 'Missing'}</b></div>)}</div><p className="note">Evidence is matched only to the exact type requested by PayPal. For example, proof of fulfillment does not automatically satisfy OTHER.</p></div> : <Notice kind="info">PayPal has not provided seller evidence requirements for this dispute. You can prepare and analyze supporting evidence in Settle, but submission to PayPal remains unavailable until the provider supplies requirements and the case supports evidence submission. Suggested evidence types are guidance only, not PayPal requirements: {(pack.suggested_evidence_types || []).map((x) => titleCase(String(x).replaceAll('_', ' '))).join(', ') || 'none available'}.</Notice>}
                <div className="evidence-summary">
                  <div><span>Evidence items</span><b>{pack.items?.length || 0}</b></div>
                  <div><span>Missing evidence</span><b>{requirementRows.length ? (pack.missing_evidence?.length || 0) : '—'}</b></div>
                  <div><span>Strength score</span><b>{pack.evidence_pack?.strengthScore ?? pack.evidence_pack?.strength_score ?? '—'}</b></div>
                </div>
                {pack.missing_evidence?.length > 0 && <Notice>Missing evidence: {pack.missing_evidence.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ')}</Notice>}
                <DataTable label="Evidence items" rows={pack.items || []} empty="No items."
                  columns={[
                    { key: 'i', label: 'Include', render: (it) => <input type="checkbox" aria-label={`Include ${it.claim}`} checked={isSel(it)} disabled={locked} onChange={(e) => setPack((p) => ({ ...p, items: p.items.map((x) => (x.id === it.id ? { ...x, selected: e.target.checked ? 'true' : 'false' } : x)) }))} /> },
                    { key: 't', label: 'Type', render: (it) => titleCase(it.evidenceType || it.evidence_type) },
                    { key: 's', label: 'Source', render: (it) => <>{titleCase(it.sourceType || it.source_type)}<span className="sub mono">{it.sourceId || it.source_id}</span></> },
                    { key: 'c', label: 'Claim', render: (it) => <span style={{ whiteSpace: 'normal', display: 'block', minWidth: 240 }}>{it.claim}</span> },
                    { key: 'f', label: 'Confidence', render: (it) => it.confidence || '—' },
                    { key: 'a', label: 'Added', render: (it) => fmtDateTime(it.createdAt || it.created_at) },
                  ]} />
                <p className="note">An evidence pack organizes your records. It does not guarantee any dispute outcome.</p>
                <div className="actions-row">
                  <Button disabled={busy || locked} onClick={() => review('reject')}>Reject draft</Button>
                  <Button variant="primary" icon={CheckCircle2} disabled={busy || locked || !pack.items?.some(isSel)} onClick={() => review('approve')}>Approve selected evidence</Button>
                  <Button variant="primary" icon={Send} disabled={busy || status !== 'APPROVED' || requirementRows.length === 0 || requirementRows.some((r) => r.required && !r.matches)} onClick={() => setConfirmSubmit(true)}>Submit to PayPal</Button>
                </div>
              </>
            )}
          </Card>

          <Card title="Dispute conversation" sub="Messages returned by PayPal for this case. Only provider-returned messages are shown as actual conversation history.">
            {Array.isArray(record.messages) && record.messages.length ? (
              <div className="stack" style={{ gap: 12 }}>
                {[...record.messages].sort((a, b) => new Date(a.create_time || a.createTime || 0) - new Date(b.create_time || b.createTime || 0)).map((m, i) => {
                  const sender = String(m?.posted_by || m?.sender || m?.sender_type || m?.author || 'Participant');
                  const mine = /seller|merchant/i.test(sender);
                  const body = m?.content || m?.message || m?.text || m?.message_content || 'Message content unavailable';
                  return <div key={m.message_id || m.id || i} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <div style={{ maxWidth: '82%', padding: 14, borderRadius: 12, background: mine ? 'var(--primary)' : 'var(--surface-muted)', border: mine ? '1px solid var(--primary)' : '1px solid var(--border)' }}>
                      <b style={{ color: mine ? 'var(--on-primary)' : 'var(--fg)' }}>{mine ? 'Merchant' : sender}</b>
                      <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0', color: mine ? 'var(--on-primary)' : 'var(--fg)' }}>{typeof body === 'string' ? body : JSON.stringify(body)}</p>
                      <small style={{ color: mine ? 'var(--on-primary)' : 'var(--text-3)', opacity: mine ? 0.78 : 1 }}>{fmtDateTime(m.create_time || m.createTime || m.time_posted)}</small>
                    </div>
                  </div>;
                })}
              </div>
            ) : <EmptyState title="No PayPal messages returned">PayPal has not returned message history for this case, or this dispute type does not expose it. Messages sent from Settle will appear here after PayPal includes them in its dispute response.</EmptyState>}
            <form className="dispute-chat-composer" onSubmit={send}>
              <TextArea label="" required maxLength={5000} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Write a message…" hint={`${message.length}/5000`} />
              <Button variant="primary" icon={Send} type="submit" loading={busy} disabled={!message.trim()}>Send</Button>
            </form>
          </Card>
          <Card title="Gemini dispute copilot" sub="Evidence-grounded case analysis, buyer intent, risk, contradictions, next actions and a suggested reply." actions={<Button variant="primary" onClick={runCopilot} loading={copilotBusy}>Analyze with AI</Button>}>
            {!copilot ? <EmptyState title="Ready to analyze this dispute">Run Gemini against the latest PayPal case and available conversation messages. AI suggestions are drafts, not verified facts.</EmptyState> : (
              <div className="stack">
                <div className="evidence-summary">
                  <div><span>Risk</span><b>{copilot.risk_level}</b></div>
                  <div><span>AI confidence</span><b>{Math.round((copilot.confidence || 0) * 100)}%</b></div>
                  <div><span>Messages analyzed</span><b>{record.messages?.length || 0}</b></div>
                </div>
                <h3>Case summary</h3><p>{copilot.case_summary}</p>
                <h3>Buyer intent & sentiment</h3><p>{copilot.buyer_intent}</p><p>{copilot.sentiment}</p>
                <h3>Risk factors</h3>{(copilot.risk_reasons || []).map((x, i) => <p key={i}>• {x}</p>)}
                <h3>Evidence strengths</h3>{(copilot.evidence_strengths || []).map((x, i) => <p key={i}>• {x}</p>)}
                <h3>Evidence gaps</h3>{(copilot.evidence_gaps || []).map((x, i) => <p key={i}>• {x}</p>)}
                <h3>Contradictions</h3>{(copilot.contradictions || []).map((x, i) => <p key={i}>• {x}</p>)}
                <h3>Recommended actions</h3>{(copilot.recommended_actions || []).map((x, i) => <div key={i}><b>{x.priority} · {x.action}</b><p>{x.rationale}</p></div>)}
                <h3>Suggested reply</h3><TextArea rows={5} value={copilot.suggested_reply || ''} onChange={(e) => setCopilot((p) => ({ ...p, suggested_reply: e.target.value }))} />
                <Button disabled={!copilot.suggested_reply?.trim()} onClick={() => setMessage(copilot.suggested_reply)}>Use suggested reply</Button>
                <h3>Defense strategy</h3><p style={{ whiteSpace: 'pre-wrap' }}>{copilot.defense_strategy}</p>
                {copilot.caveats?.length > 0 && <Notice>{copilot.caveats.join(' · ')}</Notice>}
                <p className="note">AI analysis is advisory. Verify every factual claim and approve messages/evidence yourself before sending to PayPal.</p>
              </div>
            )}
          </Card>
          <Card title="Raw PayPal details" sub="Provider payload for troubleshooting. It can contain personal data."><pre className="json">{JSON.stringify(record, null, 2)}</pre></Card>
        </div>
      )}
      {confirmSubmit && <ConfirmDialog title="Submit evidence to PayPal?" confirmLabel="Submit evidence" busy={busy} onClose={() => setConfirmSubmit(false)} onConfirm={submit}>The approved evidence pack will be sent to the live PayPal case. It cannot be treated as a draft afterwards.</ConfirmDialog>}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, Download, File, RefreshCw, Sparkles, Upload, WandSparkles } from 'lucide-react';
import { Async, Button, Card, DataTable, EmptyState, Notice, SelectField, StatusBadge, TextField, useToast } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate, useData, usePageTitle } from '../../lib/hooks.js';
import { ACCEPT, MAX_UPLOAD_BYTES, uploadDocument } from '../../lib/upload.js';
import { asList } from '../../lib/models.js';
import { fmtDate } from '../../lib/format.js';

const size = (n) => (!Number(n) ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);
const get = (o, camel, snake) => o?.[camel] ?? o?.[snake];
const isoDate = (value) => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const dateInput = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toISOString().slice(0, 10);
};
const amountString = (value) => value == null || value === '' ? '' : String(value);

function ExtractionReview({ document, clients, onClose, onConverted }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);
  const [form, setForm] = useState(null);
  const [clientId, setClientId] = useState('');
  const [createdContract, setCreatedContract] = useState(null);
  const [contractTitle, setContractTitle] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const result = await api(`/v1/documents/${document.id}/ai-extraction`);
      setPayload(result);
      const runs = asList(result?.runs);
      const successful = runs.find((r) => String(r.status).toUpperCase() === 'SUCCEEDED' && r.result?.extraction);
      if (successful || runs.some((r) => String(r.status).toUpperCase() === 'FAILED')) setQueued(false);
      if (successful) {
        const extraction = successful.result.extraction;
        setForm((current) => current || {
          ...extraction,
          parties: Array.isArray(extraction.parties) ? extraction.parties.map((p) => ({ ...p })) : [],
          payment_terms: { due_days: extraction.payment_terms?.due_days ?? '', notes: extraction.payment_terms?.notes ?? '' },
          milestones: Array.isArray(extraction.milestones) ? extraction.milestones.map((m) => ({ ...m, amount: amountString(m.amount), due_date: dateInput(m.due_date), deliverables: Array.isArray(m.deliverables) ? m.deliverables : [] })) : [],
        });
        setContractTitle((v) => v || extraction.title || document.filename || 'Extracted contract');
      }
    } catch (ex) { setError(ex.message || 'Could not load extraction results.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [document.id, document.filename]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!queued) return undefined;
    const timer = window.setInterval(() => { load(true); }, 4000);
    return () => window.clearInterval(timer);
  }, [queued, load]);
  const runs = asList(payload?.runs);
  const successful = runs.find((r) => String(r.status).toUpperCase() === 'SUCCEEDED' && r.result?.extraction);
  const latest = runs[0];
  const status = String(latest?.status || '').toUpperCase();
  const extraction = form;
  const setRoot = (key, value) => setForm((v) => ({ ...v, [key]: value }));
  const setTerms = (key, value) => setForm((v) => ({ ...v, payment_terms: { ...v.payment_terms, [key]: value } }));
  const setMilestone = (index, key, value) => setForm((v) => ({ ...v, milestones: v.milestones.map((m, i) => i === index ? { ...m, [key]: value } : m) }));

  async function startExtraction() {
    setStarting(true); setError('');
    try {
      await api(`/v1/documents/${document.id}/ai-extraction`, { method: 'POST', body: JSON.stringify({}) });
      setQueued(true);
      toast('AI extraction queued. Results will appear here when processing finishes.');
      await load(true);
    } catch (ex) { setError(ex.message || 'Could not start AI extraction.'); }
    finally { setStarting(false); }
  }

  async function convert() {
    if (!clientId) { setError('Choose the client this contract belongs to.'); return; }
    if (!contractTitle.trim()) { setError('Enter a contract title.'); return; }
    if (!extraction) return;
    setSaving(true); setError('');
    let created;
    try {
      created = await api('/v1/contracts', { method: 'POST', body: JSON.stringify({
        client_id: clientId,
        title: contractTitle.trim(),
        currency: (extraction.currency || 'USD').toUpperCase().slice(0, 3),
        total_amount: extraction.total_amount == null || extraction.total_amount === '' ? undefined : String(extraction.total_amount),
        starts_at: isoDate(extraction.effective_date),
        metadata: { source_document_id: document.id, ai_extraction_run_id: successful?.id, extracted_terms: extraction, reviewed_and_approved: true },
      }) });
      const failures = [];
      for (const [index, milestone] of extraction.milestones.entries()) {
        if (!milestone.name?.trim()) continue;
        try {
          await api(`/v1/contracts/${created.id}/milestones`, { method: 'POST', body: JSON.stringify({
            name: milestone.name.trim(),
            description: [milestone.deliverables?.length ? `Deliverables: ${milestone.deliverables.join(', ')}` : '',].filter(Boolean).join('\n') || undefined,
            amount: milestone.amount === '' || milestone.amount == null ? undefined : String(milestone.amount),
            due_at: isoDate(milestone.due_date),
            metadata: { source_document_id: document.id, extraction_milestone_index: index },
          }) });
        } catch (ex) { failures.push(`${milestone.name}: ${ex.message}`); }
      }
      invalidate('/v1/contracts'); invalidate('/v1/');
      if (failures.length) {
        setCreatedContract(created);
        setError(`Contract ${created.title || contractTitle} was created, but ${failures.length} milestone(s) could not be added: ${failures.join('; ')}`);
        toast('Contract created with some milestone errors.');
      } else {
        toast(`Contract created with ${extraction.milestones.filter((m) => m.name?.trim()).length} milestone(s).`);
        onConverted(created);
      }
    } catch (ex) { setError(ex.message || 'Contract creation failed.'); }
    finally { setSaving(false); }
  }

  return (
    <Card title="AI contract extraction" sub={document.filename || 'Document'} actions={<Button size="sm" icon={RefreshCw} loading={refreshing} onClick={() => load(true)}>Refresh results</Button>}>
      {error && <Notice>{error}</Notice>}
      {createdContract?.id && <Notice kind="success">Contract created. <Link to={`/contracts/${createdContract.id}`} style={{ textDecoration: 'underline' }}>Open contract</Link>. You can safely close this review.</Notice>}
      {loading ? <div className="panel-skel"><span className="skel" style={{ height: 16, width: '65%' }} /><span className="skel" style={{ height: 16, width: '90%' }} /><span className="skel" style={{ height: 16, width: '75%' }} /></div> : !successful ? (
        <div className="stack">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><StatusBadge value={status || 'not_started'} /><span className="muted">{queued || status === 'QUEUED' || status === 'PROCESSING' ? 'Your document is being analyzed in the background. This panel refreshes automatically.' : status === 'FAILED' ? (latest?.error || 'The extraction failed. You can retry it.') : 'No extraction has been run for this document yet.'}</span></div>
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" icon={Sparkles} loading={starting} disabled={starting || queued || !['verified'].includes(String(get(document, 'verificationStatus', 'verification_status') || '').toLowerCase())} onClick={startExtraction}>{queued ? 'Extraction in progress…' : status === 'FAILED' ? 'Retry AI extraction' : 'Extract with AI'}</Button>
            {!['verified'].includes(String(get(document, 'verificationStatus', 'verification_status') || '').toLowerCase()) && <span className="tiny">Document verification must finish before AI analysis can start.</span>}
          </div>
          {asList(payload?.facts).length > 0 && <p className="tiny">{payload.facts.length} source-backed fact(s) are stored for this document.</p>}
        </div>
      ) : extraction ? (
        <div className="stack">
          <div className="review-meta">
            <StatusBadge value="succeeded" label="Extraction complete" />
            <span className="tiny">{successful.provider || 'AI provider'}{successful.model ? ` · ${successful.model}` : ''}{successful.createdAt ? ` · ${fmtDate(successful.createdAt)}` : ''}</span>
          </div>
          {extraction.summary && <div className="review-summary"><b>AI summary</b><p>{extraction.summary}</p></div>}
          <div className="form-grid">
            <TextField label="Contract title" value={contractTitle} onChange={(e) => setContractTitle(e.target.value)} />
            <TextField label="Document type" value={extraction.document_type || ''} readOnly />
            <TextField label="Total amount" type="number" min="0" step="0.01" value={extraction.total_amount ?? ''} onChange={(e) => setRoot('total_amount', e.target.value)} />
            <TextField label="Currency" maxLength={3} value={extraction.currency || 'USD'} onChange={(e) => setRoot('currency', e.target.value.toUpperCase())} />
            <TextField label="Effective date" type="date" value={dateInput(extraction.effective_date)} onChange={(e) => setRoot('effective_date', e.target.value || null)} />
            <TextField label="Governing law" value={extraction.governing_law || ''} onChange={(e) => setRoot('governing_law', e.target.value || null)} />
            <TextField label="Payment due (days)" type="number" min="0" value={extraction.payment_terms?.due_days ?? ''} onChange={(e) => setTerms('due_days', e.target.value === '' ? null : Number(e.target.value))} />
            <TextField label="Payment terms" value={extraction.payment_terms?.notes || ''} onChange={(e) => setTerms('notes', e.target.value || null)} />
          </div>

          <div>
            <h3 className="review-section-title">Parties</h3>
            {extraction.parties?.length ? <div className="review-parties">{extraction.parties.map((p, i) => <div className="review-party" key={`${p.name}-${i}`}><TextField label="Name" value={p.name} onChange={(e) => setRoot('parties', extraction.parties.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /><TextField label="Role" value={p.role} onChange={(e) => setRoot('parties', extraction.parties.map((x, j) => j === i ? { ...x, role: e.target.value } : x))} /></div>)}</div> : <p className="muted">No parties were confidently extracted.</p>}
          </div>

          <div>
            <div className="review-heading"><div><h3 className="review-section-title">Extracted milestones</h3><p className="tiny">Review and edit each item before creating the contract.</p></div><span className="count">{extraction.milestones?.length || 0} found</span></div>
            {extraction.milestones?.length ? <div className="review-milestones">{extraction.milestones.map((m, i) => <div className="review-milestone" key={`${m.name}-${i}`}>
              <div className="review-milestone-top"><b>Milestone {i + 1}</b><span className="tiny">{m.deliverables?.length || 0} deliverable(s)</span></div>
              <div className="form-grid">
                <TextField label="Name" value={m.name} onChange={(e) => setMilestone(i, 'name', e.target.value)} />
                <TextField label="Amount" type="number" min="0" step="0.01" value={m.amount ?? ''} onChange={(e) => setMilestone(i, 'amount', e.target.value)} />
                <TextField label="Due date" type="date" value={m.due_date || ''} onChange={(e) => setMilestone(i, 'due_date', e.target.value || null)} />
                <TextField label="Deliverables (comma separated)" value={(m.deliverables || []).join(', ')} onChange={(e) => setMilestone(i, 'deliverables', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
              </div>
            </div>)}</div> : <EmptyState title="No milestones extracted">You can still create a contract from the reviewed contract details.</EmptyState>}
          </div>

          <div>
            <h3 className="review-section-title">Source evidence and confidence</h3>
            {extraction.claims?.length ? <div className="review-claims">{extraction.claims.map((claim, i) => <div className="review-claim" key={`${claim.field}-${i}`}>
              <div className="review-heading"><b>{claim.field.replaceAll('_', ' ')}</b><span className="confidence">{Math.round((Number(claim.confidence) || 0) * 100)}% confidence</span></div>
              <p>{claim.source_excerpt || 'No source excerpt provided.'}</p>
              <span className="tiny">Extracted value: {claim.value == null ? 'Not specified' : typeof claim.value === 'object' ? JSON.stringify(claim.value) : String(claim.value)}</span>
            </div>)}</div> : <p className="muted">The model did not return field-level source excerpts.</p>}
          </div>

          <div className="review-approve">
            <div><h3 className="review-section-title">Review and create contract</h3><p className="tiny">Creating the contract saves the reviewed values and adds the milestones. It does not send an invoice or contact the client.</p></div>
            <SelectField label="Assign to client" required value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Choose a workspace client" options={clients.map((c) => [c.id, c.name])} />
            <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
              <Button onClick={onClose} disabled={saving}>Close review</Button>
              <Button variant="primary" icon={Check} loading={saving} disabled={saving || !clients.length || Boolean(createdContract)} onClick={convert}>{createdContract ? 'Contract created' : 'Approve and create contract'}</Button>
            </div>
          </div>
        </div>
      ) : <Notice>Extraction finished, but the returned result did not contain a usable extraction payload. Refresh or retry the extraction.</Notice>}
    </Card>
  );
}

export default function Documents() {
  usePageTitle('Documents');
  const toast = useToast();
  const docs = useData('/v1/documents');
  const clientsState = useData('/v1/clients');
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [reviewDoc, setReviewDoc] = useState(null);
  const [expanded, setExpanded] = useState({});

  const choose = (f) => {
    setError('');
    if (f && f.size > MAX_UPLOAD_BYTES) { setFile(null); setError('This file is larger than 25 MB.'); return; }
    setFile(f || null);
  };
  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setError('');
    try {
      await uploadDocument(file, undefined, setStage);
      invalidate('/v1/documents');
      toast('Document uploaded. Verification runs in the background.');
      setFile(null);
      if (input.current) input.current.value = '';
      await docs.reload();
    } catch (ex) { setError(ex.message || 'Document upload failed.'); } finally { setStage(''); }
  }
  async function download(id) {
    try { window.open((await api(`/v1/documents/${id}/download-url`)).url, '_blank', 'noopener,noreferrer'); } catch (ex) { setError(ex.message); }
  }
  const rows = asList(docs.data);
  const clients = asList(clientsState.data);
  const openReview = (doc) => { setReviewDoc(doc); };
  const afterConverted = async () => { setReviewDoc(null); await docs.reload(); invalidate('/v1/contracts'); };

  return (
    <>
      <div className="page-head">
        <div><h1>Documents</h1><p>Upload contracts and supporting files, extract contract terms with AI, and review them before creating a contract.</p></div>
        <div className="page-actions"><Button icon={RefreshCw} onClick={docs.reload}>Refresh</Button></div>
      </div>
      {error && <Notice>{error}</Notice>}
      <Card title="Upload a document" sub="PDF, PNG, JPG, GIF, TXT, CSV or JSON, up to 25 MB. Files are uploaded to workspace-scoped storage and verified before AI analysis.">
        <form className="form" onSubmit={upload}>
          <label htmlFor="doc-file" className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files?.[0]); }}>
            <Upload size={20} aria-hidden="true" />
            <span><b>{file?.name || 'Choose a file or drop it here'}</b><small>{file ? size(file.size) : 'Nothing is uploaded until you press Upload.'}</small></span>
          </label>
          <input id="doc-file" ref={input} className="sr-only" type="file" accept={ACCEPT} onChange={(e) => choose(e.target.files?.[0])} />
          <div className="form-actions" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
            <Button variant="primary" type="submit" loading={Boolean(stage)} disabled={!file}>{stage ? `${stage}…` : 'Upload file'}</Button>
            {file && !stage && <Button variant="ghost" onClick={() => { setFile(null); if (input.current) input.current.value = ''; }}>Clear</Button>}
          </div>
        </form>
      </Card>
      {reviewDoc && <ExtractionReview key={reviewDoc.id} document={reviewDoc} clients={clients} onClose={() => setReviewDoc(null)} onConverted={afterConverted} />}
      <Card title="Workspace documents" sub="Verification status and AI extraction results" flush>
        <Async state={docs} rows={4}>
          {rows.length ? <div className="document-list">{rows.map((d) => {
            const verification = String(get(d, 'verificationStatus', 'verification_status') || 'pending').toLowerCase();
            const isExpanded = Boolean(expanded[d.id]);
            return <div className="document-row" key={d.id}>
              <div className="document-main">
                <div className="document-icon"><File size={18} /></div>
                <div className="document-info"><b>{d.filename || d.name || 'Document'}</b><span className="tiny">{d.contentType || d.content_type || 'Unknown type'} · {size(d.sizeBytes || d.size_bytes)} · {fmtDate(d.createdAt || d.created_at || d.uploadedAt || d.uploaded_at)}</span><div className="document-status"><StatusBadge value={d.status} /><StatusBadge value={verification} /></div></div>
                <div className="document-actions">
                  {verification === 'verified' && <Button size="sm" variant="primary" icon={WandSparkles} onClick={() => openReview(d)}>AI extraction</Button>}
                  <Button size="sm" icon={Download} onClick={() => download(d.id)}>Download</Button>
                  <Button size="sm" variant="ghost" icon={isExpanded ? ChevronUp : ChevronDown} onClick={() => setExpanded((v) => ({ ...v, [d.id]: !v[d.id] }))}>{isExpanded ? 'Less' : 'Details'}</Button>
                </div>
              </div>
              {isExpanded && <div className="document-extra"><span>Document ID <code>{d.id}</code></span><span>Verification: {verification}</span>{verification !== 'verified' && <span className="tiny">AI extraction becomes available after verification completes.</span>}</div>}
            </div>;
          })}</div> : <EmptyState title="No documents yet">Upload a signed contract or statement of work to keep it with the rest of the record.</EmptyState>}
        </Async>
      </Card>
    </>
  );
}

import { useRef, useState } from 'react';
import { Download, File, RefreshCw, Upload } from 'lucide-react';
import { Async, Button, Card, DataTable, EmptyState, Notice, StatusBadge, useToast } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate, useData, usePageTitle } from '../../lib/hooks.js';
import { ACCEPT, MAX_UPLOAD_BYTES, uploadDocument } from '../../lib/upload.js';
import { asList } from '../../lib/models.js';
import { fmtDate } from '../../lib/format.js';

const size = (n) => (!Number(n) ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

export default function Documents() {
  usePageTitle('Documents');
  const toast = useToast();
  const docs = useData('/v1/documents');
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');

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

  return (
    <>
      <div className="page-head">
        <div><h1>Documents</h1><p>Contracts and supporting files, stored in your workspace and checked before use as evidence.</p></div>
        <div className="page-actions"><Button icon={RefreshCw} onClick={docs.reload}>Refresh</Button></div>
      </div>
      <Card title="Upload a document" sub="PDF, PNG, JPG, GIF, TXT, CSV or JSON, up to 25 MB. Files go to a time-limited, workspace-scoped storage URL.">
        <form className="form" onSubmit={upload}>
          <Notice>{error}</Notice>
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
      <Card title="Workspace documents" sub="Uploaded files and their verification status" flush>
        <Async state={docs} rows={4}>
          {rows.length ? (
            <DataTable label="Documents" rows={rows}
              columns={[
                { key: 'n', label: 'Document', render: (d) => <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><File size={15} /><span><b style={{ fontWeight: 500 }}>{d.filename || d.name || 'Document'}</b><span className="sub mono">{String(d.id).slice(0, 8)}</span></span></span> },
                { key: 't', label: 'Type', render: (d) => d.contentType || d.content_type || '—' },
                { key: 's', label: 'Size', align: 'right', render: (d) => <span className="num">{size(d.sizeBytes || d.size_bytes)}</span> },
                { key: 'st', label: 'Status', render: (d) => <StatusBadge value={d.status} /> },
                { key: 'v', label: 'Verification', render: (d) => <StatusBadge value={d.verificationStatus || d.verification_status || 'pending'} /> },
                { key: 'u', label: 'Uploaded', render: (d) => fmtDate(d.createdAt || d.created_at || d.uploadedAt || d.uploaded_at) },
                { key: 'a', label: '', align: 'right', render: (d) => <Button size="sm" icon={Download} onClick={() => download(d.id)}>Download</Button> },
              ]} />
          ) : <EmptyState title="No documents yet">Upload a signed contract or statement of work to keep it with the rest of the record.</EmptyState>}
        </Async>
      </Card>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Async, Button, Card, ConfirmDialog, Notice, SelectField, StatusBadge, TextField, useToast } from '../../components/ui.jsx';
import { api, session, updateWorkspaceCache } from '../../services/api.js';
import { invalidate, useData, usePageTitle } from '../../lib/hooks.js';

function WorkspaceCard() {
  const toast = useToast();
  const ws = useData('/v1/workspace');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (ws.data?.name) setName(ws.data.name); }, [ws.data]);
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api('/v1/workspace', { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }); updateWorkspaceCache({ name: name.trim() }); invalidate('/v1/workspace'); toast('Workspace updated.'); await ws.reload(); } catch (ex) { setError(ex.message); } finally { setBusy(false); }
  }
  return (
    <Card title="Workspace" sub="Your business details as they appear in Settle.">
      <Async state={ws} rows={2}>
        <form className="form" onSubmit={save} style={{ maxWidth: 440 }}>
          <Notice>{error}</Notice>
          <TextField label="Workspace name" required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <div className="form-actions" style={{ justifyContent: 'flex-start' }}><Button variant="primary" type="submit" loading={busy} disabled={!name.trim() || name.trim() === ws.data?.name}>Save workspace</Button></div>
        </form>
      </Async>
    </Card>
  );
}

function PayPalCard() {
  const toast = useToast();
  const [conn, setConn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [env, setEnv] = useState('sandbox');
  const [f, setF] = useState({ clientId: '', clientSecret: '', webhookId: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api('/v1/paypal/connection').then((x) => { setConn(x); if (x?.environment) setEnv(x.environment); }).catch((e) => setLoadError(e.message)).finally(() => setLoading(false));
  }, []);

  async function connect(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api('/v1/paypal/connection', { method: 'PUT', body: JSON.stringify({ clientId: f.clientId, clientSecret: f.clientSecret, webhookId: f.webhookId || undefined, environment: env }) });
      setConn({ connected: true, ...r.connection });
      setF({ clientId: '', clientSecret: '', webhookId: '' }); // secrets leave component state immediately
      toast('PayPal credentials were validated and stored encrypted.');
    } catch (ex) { setError(ex.message); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError('');
    try { await api('/v1/paypal/connection', { method: 'DELETE' }); setConn({ connected: false }); toast('PayPal disconnected.'); } catch (ex) { setError(ex.message); } finally { setBusy(false); setConfirm(false); }
  }

  return (
    <Card title="PayPal connection" sub="Invoices are created and sent from your own PayPal REST app." actions={loading ? null : <span style={{ display: 'flex', gap: 8 }}>{conn?.connected && <StatusBadge value={conn.environment === 'live' ? 'overdue' : 'pending'} label={conn.environment === 'live' ? 'Live' : 'Sandbox'} />}<StatusBadge value={conn?.connected ? 'connected' : 'pending'} label={conn?.connected ? 'Connected' : 'Not connected'} /></span>}>
      {loadError && <Notice>{loadError}</Notice>}
      {conn?.connected && env === 'live' && <Notice kind="info">This workspace is connected to the live PayPal environment. Sent invoices are real.</Notice>}
      <form className="form" onSubmit={connect} style={{ maxWidth: 480 }} autoComplete="off">
        <Notice>{error}</Notice>
        <SelectField label="Environment" value={env} onChange={(e) => setEnv(e.target.value)} options={[['sandbox', 'Sandbox (testing, no real money)'], ['live', 'Live (real invoices and payments)']]} hint="Sandbox and live credentials are separate. Reconnect to switch." />
        <TextField label="Client ID" required value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} autoComplete="off" spellCheck={false} />
        <TextField label="Client secret" required type="password" minLength={8} value={f.clientSecret} onChange={(e) => setF({ ...f, clientSecret: e.target.value })} autoComplete="new-password" hint="Validated by the server, stored encrypted, and never shown again." />
        <TextField label="Webhook ID (optional)" type="password" value={f.webhookId} onChange={(e) => setF({ ...f, webhookId: e.target.value })} autoComplete="off" hint="Lets Settle verify PayPal webhook calls for payment updates." />
        <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
          <Button variant="primary" type="submit" loading={busy}>{busy ? 'Validating…' : conn?.connected ? 'Replace credentials' : 'Validate and connect'}</Button>
          {conn?.connected && <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>Disconnect</Button>}
        </div>
      </form>
      {confirm && <ConfirmDialog title="Disconnect PayPal?" confirmLabel="Disconnect" danger busy={busy} onClose={() => setConfirm(false)} onConfirm={disconnect}>Settle will remove the stored credentials. You will not be able to send invoices until you reconnect. Existing invoices are not changed.</ConfirmDialog>}
    </Card>
  );
}

export default function Settings() {
  usePageTitle('Settings');
  const s = session();
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Workspace details, payment integration and your account.</p></div></div>
      <div className="stack">
        <Card title="Account" sub="Your sign-in details. Editing the profile is not yet supported by the API.">
          <dl className="dl"><dt>Name</dt><dd>{s.user?.name || '—'}</dd><dt>Email</dt><dd>{s.user?.email || '—'}</dd><dt>Workspace ID</dt><dd className="mono">{s.workspaceId}</dd></dl>
        </Card>
        <WorkspaceCard />
        <PayPalCard />
      </div>
    </>
  );
}

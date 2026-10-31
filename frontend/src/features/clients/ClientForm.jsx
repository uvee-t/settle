import { useState } from 'react';
import { Button, Modal, Notice, TextField, useToast } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate } from '../../lib/hooks.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ClientForm({ client, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState({ name: client?.name || '', email: client?.email || '', company_name: client?.company || '', country_code: client?.country || '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));

  const errors = {};
  if (!v.name.trim()) errors.name = 'Enter a contact name.';
  else if (v.name.length > 120) errors.name = 'Use 120 characters or fewer.';
  if (v.email && !EMAIL.test(v.email.trim())) errors.email = 'Enter a valid email address.';
  if (v.email.length > 254) errors.email = 'Email is too long.';
  if (v.company_name.length > 160) errors.company_name = 'Use 160 characters or fewer.';
  if (v.country_code && !/^[A-Za-z]{2}$/.test(v.country_code.trim())) errors.country_code = 'Use a 2-letter country code, for example US.';
  const show = (k) => (touched ? errors[k] : undefined);

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError('');
    const body = {
      name: v.name.trim(),
      email: v.email.trim() || undefined,
      company_name: v.company_name.trim() || undefined,
      country_code: v.country_code.trim().toUpperCase() || undefined,
    };
    try {
      const saved = await api(client ? `/v1/clients/${client.id}` : '/v1/clients', { method: client ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      invalidate('/v1/clients');
      toast(client ? 'Client updated.' : 'Client added.');
      onSaved?.(saved);
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={client ? 'Edit client' : 'New client'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <Notice>{error}</Notice>
        <TextField label="Contact name" required value={v.name} onChange={set('name')} error={show('name')} maxLength={121} data-autofocus />
        <TextField label="Email" type="email" value={v.email} onChange={set('email')} error={show('email')} hint="Required to send invoices through PayPal." />
        <TextField label="Company" value={v.company_name} onChange={set('company_name')} error={show('company_name')} />
        <TextField label="Country code" value={v.country_code} onChange={set('country_code')} error={show('country_code')} maxLength={2} placeholder="US" hint="Two letters." />
        <div className="form-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>{busy ? 'Saving…' : 'Save client'}</Button>
        </div>
      </form>
    </Modal>
  );
}

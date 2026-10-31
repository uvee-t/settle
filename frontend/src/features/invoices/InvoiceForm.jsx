import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Modal, Notice, SelectField, TextField, useToast } from '../../components/ui.jsx';
import { api } from '../../services/api.js';
import { invalidate } from '../../lib/hooks.js';
import { money } from '../../lib/format.js';

const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP'];
const blank = () => ({ description: '', quantity: '1', unit_amount: '' });

/** Creates a draft invoice via POST /v1/invoices. One Idempotency-Key per open form, so a retry cannot create a second invoice. */
export function InvoiceForm({ clients, defaultClientId, onClose, onSaved }) {
  const toast = useToast();
  const key = useRef(crypto.randomUUID());
  const [v, setV] = useState({ client_id: defaultClientId || '', invoice_number: '', reference: '', currency: 'USD', due_at: '' });
  const [items, setItems] = useState([{ description: 'Professional services', quantity: '1', unit_amount: '' }]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const setItem = (i, k) => (e) => setItems((arr) => arr.map((it, j) => (j === i ? { ...it, [k]: e.target.value } : it)));

  const total = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_amount) || 0), 0);
  const errors = {};
  if (!v.client_id) errors.client_id = 'Choose a client.';
  if (v.invoice_number.length > 64) errors.invoice_number = 'Use 64 characters or fewer.';
  if (v.reference.length > 200) errors.reference = 'Use 200 characters or fewer.';
  const itemErr = items.map((it) => ({
    description: !it.description.trim() ? 'Required' : undefined,
    quantity: !(Number(it.quantity) > 0) ? 'Must be above 0' : undefined,
    unit_amount: !(Number(it.unit_amount) > 0) ? 'Must be above 0' : undefined,
  }));
  const invalid = Object.keys(errors).length || itemErr.some((e) => e.description || e.quantity || e.unit_amount);

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError('');
    const body = {
      client_id: v.client_id,
      invoice_number: v.invoice_number.trim() || undefined,
      reference: v.reference.trim() || undefined,
      currency: v.currency,
      due_at: v.due_at ? new Date(v.due_at).toISOString() : undefined,
      items: items.map((it) => ({ description: it.description.trim(), quantity: String(Number(it.quantity)), unit_amount: String(Number(it.unit_amount)) })),
    };
    try {
      const saved = await api('/v1/invoices', { method: 'POST', headers: { 'Idempotency-Key': key.current }, body: JSON.stringify(body) });
      invalidate('/v1/invoices');
      toast('Draft invoice created.');
      onSaved?.(saved);
    } catch (ex) {
      setError(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New invoice" onClose={onClose} wide>
      <form className="form" onSubmit={submit} noValidate>
        <Notice>{error}</Notice>
        <div className="form-grid">
          <SelectField label="Client" required value={v.client_id} onChange={set('client_id')} placeholder="Select client" error={touched ? errors.client_id : undefined} options={clients.map((c) => [c.id, c.email ? `${c.name} (${c.email})` : c.name])} data-autofocus />
          <SelectField label="Currency" value={v.currency} onChange={set('currency')} options={CURRENCIES} />
          <TextField label="Invoice number" value={v.invoice_number} onChange={set('invoice_number')} placeholder="Generated if blank" error={touched ? errors.invoice_number : undefined} />
          <TextField label="Due date" type="date" value={v.due_at} onChange={set('due_at')} />
        </div>
        <TextField label="Reference" value={v.reference} onChange={set('reference')} error={touched ? errors.reference : undefined} hint="Your purchase order or project reference." />

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          <legend className="tiny" style={{ padding: 0, marginBottom: 6, fontWeight: 500, color: 'var(--text-2)', fontSize: 12.5 }}>Line items</legend>
          {items.map((it, i) => (
            <div key={i} className="form-grid" style={{ gridTemplateColumns: 'minmax(0,3fr) minmax(70px,1fr) minmax(90px,1.4fr) auto', alignItems: 'start' }}>
              <TextField label={i === 0 ? 'Description' : <span className="sr-only">Description {i + 1}</span>} required value={it.description} onChange={setItem(i, 'description')} error={touched ? itemErr[i].description : undefined} />
              <TextField label={i === 0 ? 'Qty' : <span className="sr-only">Quantity {i + 1}</span>} required type="number" min="0.01" step="any" inputMode="decimal" value={it.quantity} onChange={setItem(i, 'quantity')} error={touched ? itemErr[i].quantity : undefined} />
              <TextField label={i === 0 ? 'Unit amount' : <span className="sr-only">Unit amount {i + 1}</span>} required type="number" min="0.01" step="0.01" inputMode="decimal" value={it.unit_amount} onChange={setItem(i, 'unit_amount')} error={touched ? itemErr[i].unit_amount : undefined} />
              <div style={{ paddingTop: i === 0 ? 22 : 0 }}>
                <IconButton label={`Remove line ${i + 1}`} icon={Trash2} disabled={items.length === 1} onClick={() => setItems((a) => a.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
          <div><Button size="sm" icon={Plus} onClick={() => setItems((a) => [...a, blank()])}>Add line</Button></div>
        </fieldset>

        <div className="inv-total" style={{ marginLeft: 'auto' }}>
          <div className="grand"><span>Total</span><b className="num">{money(total, v.currency)}</b></div>
        </div>
        <div className="form-actions">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy}>{busy ? 'Creating…' : 'Create draft'}</Button>
        </div>
      </form>
    </Modal>
  );
}

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, SearchX, X } from 'lucide-react';
import { titleCase } from '../lib/format.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

/* ---------- buttons ---------- */
export function Button({ variant = 'secondary', size, loading, icon: Icon, children, className, to, ...props }) {
  const cls = cx('btn', variant, size, className);
  const body = (
    <>
      {loading ? <Loader2 size={15} className="spin" aria-hidden="true" /> : Icon ? <Icon size={15} aria-hidden="true" /> : null}
      {children}
    </>
  );
  if (to) return <Link to={to} className={cls} {...props}>{body}</Link>;
  return (
    <button type="button" className={cls} disabled={props.disabled || loading} aria-busy={loading || undefined} {...props}>
      {body}
    </button>
  );
}
export function IconButton({ label, icon: Icon, className, ...props }) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} title={label} {...props}>
      <Icon size={17} aria-hidden="true" />
    </button>
  );
}

/* ---------- status ---------- */
const TONE = {
  overdue: 'danger', failed: 'danger', rejected: 'danger', cancelled: 'danger', canceled: 'danger', lost: 'danger', error: 'danger', declined: 'danger',
  paid: 'success', completed: 'success', succeeded: 'success', verified: 'success', approved: 'success', active: 'success', connected: 'success', won: 'success', resolved: 'success',
  sent: 'primary', open: 'primary', processing: 'primary', submitted: 'primary', in_progress: 'primary',
  partial: 'violet', partially_paid: 'violet',
  draft: 'muted', pending: 'warning', unknown: 'muted', archived: 'muted',
};
const LABEL = { partial: 'Partially paid', sent: 'Sent' };
export function StatusBadge({ value, label }) {
  const v = String(value || 'unknown').toLowerCase();
  return <span className={cx('badge', `tone-${TONE[v] || 'muted'}`)}>{label || LABEL[v] || titleCase(v)}</span>;
}

/* ---------- messages ---------- */
export function Notice({ kind = 'error', children, onClose }) {
  if (!children) return null;
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div className={cx('notice', kind)} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
      {onClose && <button type="button" className="notice-x" onClick={onClose} aria-label="Dismiss"><X size={14} /></button>}
    </div>
  );
}
export function Skeleton({ h = 14, w = '100%', className }) {
  return <span className={cx('skel', className)} style={{ height: h, width: w }} aria-hidden="true" />;
}
export function PanelSkeleton({ rows = 4 }) {
  return (
    <div className="panel-skel" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={16} w={`${90 - i * 12}%`} />)}
    </div>
  );
}
export function EmptyState({ icon: Icon = SearchX, title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon size={20} aria-hidden="true" /></span>
      <b>{title}</b>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
export function ErrorState({ message, onRetry }) {
  return (
    <div className="empty error-state" role="alert">
      <span className="empty-icon danger"><AlertCircle size={20} aria-hidden="true" /></span>
      <b>Something went wrong</b>
      <p>{message}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* ---------- layout ---------- */
export function PageHeader({ title, sub, actions, back }) {
  return (
    <div className="page-head">
      <div>
        {back && <Link to={back.to} className="back-link">← {back.label}</Link>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
export function Card({ title, sub, actions, children, className, flush, id }) {
  const tid = useId();
  return (
    <section className={cx('card', className)} aria-labelledby={title ? tid : undefined} id={id}>
      {(title || actions) && (
        <div className="card-h">
          <div>
            {title && <h2 id={tid}>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? 'card-b flush' : 'card-b'}>{children}</div>
    </section>
  );
}
export function Seg({ value, onChange, options, label, small }) {
  return (
    <div className={cx('seg', small && 'sm')} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
export function Metric({ label, value, detail, trend, to, onClick, children, tone }) {
  const body = (
    <>
      <span className="metric-label">{label}</span>
      <span className="metric-row">
        <strong className={cx('metric-value', tone && `t-${tone}`)}>{value}</strong>
        {children}
      </span>
      {trend}
      {detail && <small className="metric-detail">{detail}</small>}
    </>
  );
  if (to) return <Link className="metric link" to={to}>{body}</Link>;
  if (onClick) return <button type="button" className="metric link" onClick={onClick}>{body}</button>;
  return <div className="metric">{body}</div>;
}

/* ---------- forms ---------- */
export function Field({ label, error, hint, required, children, className }) {
  const id = useId();
  return (
    <div className={cx('field', error && 'has-error', className)}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {typeof children === 'function' ? children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? `${id}-m` : undefined, required }) : children}
      {(error || hint) && <small id={`${id}-m`} className={error ? 'field-error' : 'field-hint'}>{error || hint}</small>}
    </div>
  );
}
export const TextField = ({ label, error, hint, required, className, ...props }) => (
  <Field label={label} error={error} hint={hint} required={required} className={className}>{(a) => <input {...a} {...props} />}</Field>
);
export const SelectField = ({ label, error, hint, required, options, className, placeholder, ...props }) => (
  <Field label={label} error={error} hint={hint} required={required} className={className}>
    {(a) => (
      <select {...a} {...props}>
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>))}
      </select>
    )}
  </Field>
);
export const TextArea = ({ label, error, hint, required, className, ...props }) => (
  <Field label={label} error={error} hint={hint} required={required} className={className}>{(a) => <textarea {...a} {...props} />}</Field>
);

/* ---------- dialogs ---------- */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Modal({ title, onClose, children, wide, side }) {
  const ref = useRef(null);
  const tid = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const node = ref.current;
    (node.querySelector('[data-autofocus]') || node.querySelector(FOCUSABLE) || node).focus();
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab') return;
      const items = [...node.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={cx('modal-back', side && 'side')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={ref} className={cx('modal', wide && 'wide')} role="dialog" aria-modal="true" aria-labelledby={tid} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={tid}>{title}</h2>
          <IconButton label="Close dialog" icon={X} onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
export function ConfirmDialog({ title, children, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <div className="confirm-text">{children}</div>
      <div className="form-actions">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm} data-autofocus>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/* ---------- tables ---------- */
export function usePaged(rows, size = 10) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  useEffect(() => { if (page > pages - 1) setPage(0); }, [rows.length, pages, page]);
  const slice = useMemo(() => rows.slice(page * size, page * size + size), [rows, page, size]);
  return { page, setPage, pages, slice, total: rows.length, from: rows.length ? page * size + 1 : 0, to: Math.min(rows.length, page * size + size) };
}
export function Pager({ p }) {
  if (p.pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      <span>{p.from}–{p.to} of {p.total}</span>
      <div>
        <IconButton label="Previous page" icon={ChevronLeft} disabled={p.page === 0} onClick={() => p.setPage(p.page - 1)} />
        <IconButton label="Next page" icon={ChevronRight} disabled={p.page >= p.pages - 1} onClick={() => p.setPage(p.page + 1)} />
      </div>
    </nav>
  );
}
/** columns: [{key,label,align,render,sort}] */
export function DataTable({ columns, rows, rowKey = (r) => r.id, empty, onRowClick, label }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={label || 'Table, scrollable'}>
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'r' : undefined} scope="col">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((r) => (
            <tr key={rowKey(r)} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={cx(c.align === 'right' && 'r', c.mono && 'mono')}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          )) : (
            <tr><td colSpan={columns.length} className="no-rows">{empty || 'Nothing to show.'}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef();
  const toast = useCallback((message, kind = 'success') => {
    clearTimeout(timer.current);
    setT({ message, kind, id: Math.random() });
    timer.current = setTimeout(() => setT(null), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-region" aria-live="polite" role="status">
        {t && <div key={t.id} className={cx('toast', t.kind)}>{t.message}</div>}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wrap a list fetch result: loading skeleton, error with retry, or children. */
export function Async({ state, children, rows = 4 }) {
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (state.busy && !state.data) return <PanelSkeleton rows={rows} />;
  return children;
}

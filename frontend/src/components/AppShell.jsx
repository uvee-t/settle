import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, ChartNoAxesCombined, ChevronsLeft, ChevronsRight, FileText, FolderOpen, LayoutDashboard, LogOut, Menu, Receipt, RefreshCw, Scale, Search, Settings, SearchX, Users, Wallet, X } from 'lucide-react';
import { Brand } from './Brand.jsx';
import { IconButton, ToastProvider } from './ui.jsx';
import { clearSession, session , api} from '../services/api.js';
import { fetchShared } from '../lib/hooks.js';
import { asList } from '../lib/models.js';

const NAV = [
  ['/dashboard', 'Overview', LayoutDashboard],
  ['/clients', 'Clients', Users],
  ['/contracts', 'Contracts', FileText],
  ['/invoices', 'Invoices', Receipt],
  ['/payments', 'Payments', Wallet],
  ['/cashflow', 'Cash flow', ChartNoAxesCombined],
  ['/disputes', 'Disputes', Scale],
  ['/documents', 'Documents', FolderOpen],
  ['/reports', 'Reports', BarChart3],
  ['/settings', 'Settings', Settings],
];

const initials = (n) => String(n || 'S').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function useSearch(query) {
  const [state, setState] = useState({ items: [], busy: false });
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) { setState({ items: [], busy: false }); return undefined; }
    let live = true;
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(async () => {
      const get = (p) => fetchShared(p).then(asList).catch(() => []);
      const [clients, invoices, contracts, payments, disputes, documents] = await Promise.all(['/v1/clients', '/v1/invoices', '/v1/contracts', '/v1/payments', '/v1/disputes', '/v1/documents'].map(get));
      if (!live) return;
      const has = (...parts) => parts.join(' ').toLowerCase().includes(q);
      const items = [
        ...clients.filter((x) => has(x.name, x.companyName, x.company_name, x.email)).map((x) => ({ kind: 'Client', label: x.name || x.companyName || x.company_name, detail: x.email || x.companyName || '', to: `/clients/${x.id}` })),
        ...invoices.filter((x) => has(x.invoiceNumber, x.invoice_number, x.reference)).map((x) => ({ kind: 'Invoice', label: x.invoiceNumber || x.invoice_number || 'Invoice', detail: `${x.currency || ''} ${x.amount ?? ''} · ${x.status || ''}`, to: `/invoices/${x.id}` })),
        ...contracts.filter((x) => has(x.title, x.status)).map((x) => ({ kind: 'Contract', label: x.title, detail: x.status || '', to: `/contracts/${x.id}` })),
        ...payments.filter((x) => has(x.id, x.status, x.providerReference, x.provider_reference)).map((x) => ({ kind: 'Payment', label: x.providerReference || x.provider_reference || `Payment ${String(x.id).slice(0, 8)}`, detail: `${x.currency || ''} ${x.amount ?? ''} · ${x.status || ''}`, to: '/payments' })),
        ...disputes.filter((x) => has(x.providerDisputeId, x.provider_dispute_id, x.status, x.reason)).map((x) => ({ kind: 'Dispute', label: x.providerDisputeId || x.provider_dispute_id || `Dispute ${String(x.id).slice(0, 8)}`, detail: `${x.reason || ''} · ${x.status || ''}`, to: `/disputes/${x.id}` })),
        ...documents.filter((x) => has(x.filename, x.name, x.contentType, x.content_type)).map((x) => ({ kind: 'Document', label: x.filename || x.name, detail: x.contentType || x.content_type || '', to: '/documents' })),
      ].slice(0, 10);
      setState({ items, busy: false });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query]);
  return state;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();
  const box = useRef(null);
  const { items, busy } = useSearch(q);
  useEffect(() => setIdx(0), [items]);
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, []);
  const go = (it) => { setOpen(false); setQ(''); navigate(it.to); };
  const onKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); setQ(''); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && items[idx]) go(items[idx]);
  };
  return (
    <div className="search" ref={box} role="search">
      <Search size={15} aria-hidden="true" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey} placeholder="Search clients, invoices, contracts" aria-label="Search this workspace" role="combobox" aria-expanded={open && q.trim().length >= 2} aria-controls="search-list" autoComplete="off" />
      {q && <button type="button" className="search-clear" onClick={() => setQ('')} aria-label="Clear search"><X size={14} /></button>}
      {open && q.trim().length >= 2 && (
        <div className="search-pop" id="search-list" role="listbox">
          {busy ? <div className="search-state">Searching…</div> : items.length ? items.map((it, i) => (
            <button key={`${it.kind}${it.to}${i}`} type="button" role="option" aria-selected={i === idx} className="search-hit" onMouseDown={(e) => e.preventDefault()} onClick={() => go(it)}>
              <span className="kind">{it.kind}</span>
              <span style={{ minWidth: 0 }}><b>{it.label}</b><small>{it.detail}</small></span>
            </button>
          )) : <div className="search-state"><SearchX size={14} style={{ verticalAlign: -2 }} /> No matching records.</div>}
        </div>
      )}
    </div>
  );
}

function useCrumb() {
  const { pathname } = useLocation();
  const hit = NAV.find(([to]) => pathname === to || pathname.startsWith(`${to}/`));
  return hit?.[1] || 'Workspace';
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('settle.collapsed') === '1'; } catch { return false; } });
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const crumb = useCrumb();
  const s = session();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => { try { localStorage.setItem('settle.collapsed', collapsed ? '1' : '0'); } catch { /* storage unavailable */ } }, [collapsed]);
  useEffect(() => {
    const out = () => navigate('/login', { replace: true, state: { from: { pathname, search: window.location.search }, expired: true } });
    window.addEventListener('settle-auth-expired', out);
    return () => window.removeEventListener('settle-auth-expired', out);
  }, [navigate, pathname]);

const signOut = async () => {
  try {
    await api("/v1/auth/logout", {
      method: "POST",
    });
  } finally {
    clearSession();
    navigate("/login", { replace: true });
  }
};

  return (
    <ToastProvider>
      <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
        <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Primary">
          <Brand to="/dashboard" />
          <nav className="nav" aria-label="Workspace">
            <div className="nav-label">Workspace</div>
            {NAV.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} title={label} className={({ isActive }) => (isActive ? 'active' : '')}>
                <Icon size={16} strokeWidth={1.7} aria-hidden="true" /><span className="label">{label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="side-foot">
            <div className="avatar" aria-hidden="true">{initials(s.user?.name || s.workspace?.name)}</div>
            <div className="who"><b>{s.workspace?.name || 'Your workspace'}</b><span>{s.user?.email || ''}</span></div>
            <IconButton label="Sign out" icon={LogOut} onClick={signOut} />
          </div>
        </aside>
        {open && <button type="button" className="scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
        <div className="main">
          <header className="topbar">
            <IconButton className="menu-btn" label={open ? 'Close navigation' : 'Open navigation'} icon={open ? X : Menu} onClick={() => setOpen(!open)} aria-expanded={open} />
            <IconButton className="collapse-btn" label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} icon={collapsed ? ChevronsRight : ChevronsLeft} onClick={() => setCollapsed(!collapsed)} />
            <div className="crumb">{s.workspace?.name || 'Workspace'} / <b>{crumb}</b></div>
            <GlobalSearch />
            <span className="grow" />
            <IconButton label="Refresh data" icon={RefreshCw} onClick={() => window.dispatchEvent(new Event('settle-refresh'))} />
          </header>
          <main className="content" id="main"><Outlet /></main>
        </div>
      </div>
    </ToastProvider>
  );
}

const API_BASE = String(localStorage.getItem('settle.apiBase') || window.SETTLE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const state = {
  token: sessionStorage.getItem('settle.accessToken') || '',
  refreshToken: sessionStorage.getItem('settle.refreshToken') || '',
  workspaceId: sessionStorage.getItem('settle.workspaceId') || '',
  user: JSON.parse(sessionStorage.getItem('settle.user') || 'null'),
  workspace: JSON.parse(sessionStorage.getItem('settle.workspace') || 'null'),
  page: 'overview',
  data: { summary: null, cashFlow: null, invoices: [], contracts: [], clients: [], disputes: [], documents: [] },
  loading: false,
  search: '',
  mobileNav: false,
};
const app = document.querySelector('#app');
const icons = { overview: '◫', contracts: '▤', invoices: '▧', clients: '♧', disputes: '◇', documents: '▱', cashflow: '⌁', settings: '⚙' };
const titles = { overview: 'Overview', contracts: 'Contracts', invoices: 'Invoices', clients: 'Clients', disputes: 'Disputes', documents: 'Documents', cashflow: 'Cash flow', settings: 'Settings' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function field(obj, ...keys) {
  for (const key of keys) if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  return '';
}
function money(value, currency = 'USD') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(currency || 'USD').toUpperCase(), maximumFractionDigits: 2 }).format(number); }
  catch { return `${currency || ''} ${number.toFixed(2)}`; }
}
function date(value) {
  if (!value) return 'No date';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function initials(value) { return String(value || 'S').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase(); }
function statusClass(value) { return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }
function toast(message, type = '') {
  let region = document.querySelector('.toast-region');
  if (!region) { region = document.createElement('div'); region.className = 'toast-region'; document.body.append(region); }
  const node = document.createElement('div'); node.className = `toast ${type}`; node.textContent = message; region.append(node);
  setTimeout(() => node.remove(), 3800);
}
function saveSession(payload) {
  state.token = payload.accessToken || payload.access_token || '';
  state.refreshToken = payload.refreshToken || payload.refresh_token || '';
  state.user = payload.user || state.user;
  if (payload.workspace) {
    state.workspace = payload.workspace;
    state.workspaceId = payload.workspace.id;
  } else if (Array.isArray(payload.workspaceIds)) {
    state.workspaceId = payload.workspaceIds.includes(state.workspaceId) ? state.workspaceId : (payload.workspaceIds[0] || '');
  }
  sessionStorage.setItem('settle.accessToken', state.token);
  sessionStorage.setItem('settle.refreshToken', state.refreshToken);
  sessionStorage.setItem('settle.workspaceId', state.workspaceId);
  sessionStorage.setItem('settle.user', JSON.stringify(state.user));
  sessionStorage.setItem('settle.workspace', JSON.stringify(state.workspace));
}
function clearSession() {
  for (const key of ['settle.accessToken', 'settle.refreshToken', 'settle.workspaceId', 'settle.user', 'settle.workspace']) sessionStorage.removeItem(key);
  state.token = ''; state.refreshToken = ''; state.workspaceId = ''; state.user = null; state.workspace = null;
  state.data = { summary: null, cashFlow: null, invoices: [], contracts: [], clients: [], disputes: [], documents: [] };
}
async function refreshSession() {
  if (!state.refreshToken) return false;
  const response = await fetch(`${API_BASE}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: state.refreshToken }) });
  if (!response.ok) return false;
  const payload = await response.json();
  saveSession({ ...payload, user: state.user, workspace: state.workspace, workspaceIds: state.workspaceId ? [state.workspaceId] : [] });
  return Boolean(state.token);
}
async function api(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('authorization', `Bearer ${state.token}`);
  if (state.workspaceId) headers.set('x-workspace-id', state.workspaceId);
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401 && retry && state.refreshToken) {
    try { if (await refreshSession()) return api(path, options, false); } catch { /* sign-in screen below */ }
    clearSession(); render();
  }
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || (typeof payload === 'string' ? payload : `Request failed (${response.status})`);
    throw new Error(message);
  }
  return payload;
}
async function loadData() {
  if (!state.token || !state.workspaceId) return;
  state.loading = true;
  try {
    const requests = await Promise.allSettled([
      api('/v1/dashboard/summary'), api('/v1/dashboard/cash-flow?days=90'), api('/v1/invoices'), api('/v1/contracts'), api('/v1/clients'), api('/v1/disputes'), api('/v1/documents'), api('/v1/workspace'),
    ]);
    const [summary, cashFlow, invoices, contracts, clients, disputes, documents, workspace] = requests;
    const assign = (key, result, fallback) => { state.data[key] = result.status === 'fulfilled' ? result.value : fallback; };
    assign('summary', summary, null); assign('cashFlow', cashFlow, null); assign('invoices', invoices, []); assign('contracts', contracts, []); assign('clients', clients, []); assign('disputes', disputes, []); assign('documents', documents, []);
    if (workspace.status === 'fulfilled') { state.workspace = workspace.value; sessionStorage.setItem('settle.workspace', JSON.stringify(state.workspace)); }
    const rejected = requests.find((item) => item.status === 'rejected');
    if (rejected && !state.data.summary) toast(rejected.reason?.message || 'Some data could not be loaded.', 'error');
  } catch (error) { toast(error.message || 'Unable to load workspace data.', 'error'); }
  finally { state.loading = false; }
}
function brand() { return `<div class="brand"><div class="brand-mark">s.</div><div class="brand-word">settle<span>.</span></div></div>`; }
function renderAuth(mode = 'login', error = '') {
  const register = mode === 'register';
  app.innerHTML = `<div class="auth-layout"><aside class="auth-aside"><div class="auth-logo">${brand()}</div><div class="auth-copy"><div class="eyebrow">Less chasing. More creating.</div><h1>Good work deserves to get paid.</h1><p>From signed contract to money in the bank, Settle keeps your projects, invoices, and follow-ups moving — so you can focus on the work that matters.</p></div><div class="auth-proof">Designed for independent teams <strong>· Built for cash-flow clarity</strong></div></aside><main class="auth-main"><form class="auth-card" id="auth-form"><div class="eyebrow">Welcome to Settle</div><h2>${register ? 'Create your workspace' : 'Welcome back'}</h2><p>${register ? 'Start with a workspace for your business. You can invite your team later.' : 'Sign in to pick up where your business left off.'}</p>${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ''}${register ? `<div class="form-field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" placeholder="Alex Morgan" required maxlength="120" /></div>` : ''}<div class="form-field"><label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="you@company.com" required /></div><div class="form-field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="${register ? '10' : '1'}" placeholder="${register ? 'At least 10 characters' : 'Your password'}" required /></div>${register ? `<div class="form-field"><label for="workspace_name">Workspace name</label><input id="workspace_name" name="workspace_name" placeholder="Studio North" required maxlength="120" /></div>` : ''}<button class="button button-primary" type="submit">${register ? 'Create workspace' : 'Sign in'} <span>→</span></button><div class="auth-switch">${register ? 'Already have an account?' : 'New to Settle?'} <button type="button" id="auth-switch">${register ? 'Sign in' : 'Create an account'}</button></div><div class="auth-small"><span class="connection-dot"></span>Connecting to ${escapeHtml(new URL(API_BASE).host)}</div></form></main></div>`;
  document.querySelector('#auth-switch').addEventListener('click', () => renderAuth(register ? 'login' : 'register'));
  document.querySelector('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Please wait…';
    try {
      const body = Object.fromEntries(form.entries());
      const payload = await api(register ? '/v1/auth/register' : '/v1/auth/login', { method: 'POST', body: JSON.stringify(body) }, false);
      saveSession(payload);
      if (!payload.workspace && Array.isArray(payload.workspaceIds) && payload.workspaceIds.length > 1) {
        const ids = payload.workspaceIds;
        state.workspaceId = prompt('Enter the workspace ID you want to open. You can change this in Settings.', state.workspaceId || ids[0]) || state.workspaceId || ids[0];
        sessionStorage.setItem('settle.workspaceId', state.workspaceId);
      }
      if (!state.workspaceId) throw new Error('No workspace is linked to this account.');
      state.page = 'overview'; await loadData(); render();
    } catch (err) { renderAuth(mode, err.message || 'Unable to sign in.'); }
  });
}
function navItem(page) { return `<button class="nav-item ${state.page === page ? 'active' : ''}" data-page="${page}"><span class="nav-icon">${icons[page]}</span>${titles[page]}</button>`; }
function shell(content) {
  const name = state.user?.name || state.user?.email || 'Your account';
  const workspaceName = state.workspace?.name || 'Your workspace';
  return `<div class="app-shell"><aside class="sidebar ${state.mobileNav ? 'open' : ''}" id="sidebar">${brand()}<button class="workspace-switch" data-page="settings"><span class="workspace-avatar">${escapeHtml(initials(workspaceName))}</span><span class="workspace-copy"><strong>${escapeHtml(workspaceName)}</strong><span>Workspace · ${escapeHtml((state.user?.email || '').split('@')[1] || 'Personal')}</span></span><span>⌄</span></button><div class="nav-label">Workspace</div><nav class="nav-list">${['overview','contracts','invoices','clients','disputes','documents','cashflow'].map(navItem).join('')}</nav><div class="sidebar-bottom"><div class="nav-label">Preferences</div><nav class="nav-list">${navItem('settings')}</nav><div class="help-card"><strong>Need a hand?</strong><p>Keep your cash flow healthy with a clear view of what is next.</p><button class="text-button" data-page="cashflow">Explore cash flow ↗</button></div><div class="profile"><div class="profile-avatar">${escapeHtml(initials(name))}</div><div class="profile-info"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(state.user?.email || '')}</span></div><button class="icon-button" title="Sign out" id="logout">↗</button></div></div></aside><div class="mobile-scrim ${state.mobileNav ? 'open' : ''}" id="mobile-scrim"></div><main class="main"><header class="topbar"><button class="icon-button mobile-menu" id="mobile-menu" aria-label="Open navigation">☰</button><div class="crumb">Workspace <span style="padding:0 7px;color:#c0c5bd">/</span><strong>${escapeHtml(titles[state.page])}</strong></div><div class="topbar-spacer"></div><label class="searchbox"><span>⌕</span><input id="global-search" placeholder="Search anything…" value="${escapeHtml(state.search)}" /></label><div class="topbar-actions"><button class="icon-button notification" title="Notifications" id="refresh-data">♧</button><button class="icon-button" title="Settings" data-page="settings">⚙</button></div></header><section class="page">${content}</section></main></div>`;
}
function heading(title, subtitle, action = '') { return `<div class="page-heading"><div class="page-heading-copy"><div class="eyebrow">${state.page === 'overview' ? 'Your business at a glance' : 'Manage your business'}</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${subtitle}</p></div><div class="heading-actions">${action}</div></div>`; }
function button(label, action, primary = false, icon = '+') { return `<button class="button ${primary ? 'button-primary' : ''}" data-action="${action}"><span>${icon}</span>${label}</button>`; }
function metric(label, value, icon, foot, cls = '') { return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value ${cls}">${value}</div><div class="metric-foot">${foot}</div></article>`; }
function table(headers, rows, emptyTitle, emptyText) {
  if (!rows.length) return `<div class="empty-state"><strong>${emptyTitle}</strong>${emptyText}</div>`;
  return `<div class="table-scroll"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function status(value) { const clean = String(value || 'unknown').replace(/_/g, ' '); return `<span class="status status-${statusClass(value)}">${escapeHtml(clean)}</span>`; }
function invoiceRow(item) {
  const client = state.data.clients.find((c) => c.id === field(item, 'clientId', 'client_id'));
  const number = field(item, 'invoiceNumber', 'invoice_number', 'id') || 'Invoice';
  return `<tr><td class="cell-title">${escapeHtml(number)}<span class="cell-sub">${escapeHtml(field(item, 'reference') || 'No reference')}</span></td><td>${escapeHtml(client?.name || field(item, 'clientName', 'client_name') || 'Client')}</td><td>${date(field(item, 'dueAt', 'due_at'))}</td><td>${money(field(item, 'amount', 'totalAmount', 'total_amount'), field(item, 'currency'))}</td><td>${status(field(item, 'status'))}</td></tr>`;
}
function contractRow(item) {
  const client = state.data.clients.find((c) => c.id === field(item, 'clientId', 'client_id'));
  return `<tr><td class="cell-title">${escapeHtml(field(item, 'title') || 'Untitled contract')}<span class="cell-sub">${escapeHtml(String(field(item, 'id')).slice(0, 8) || '')}</span></td><td>${escapeHtml(client?.name || 'Client')}</td><td>${money(field(item, 'totalAmount', 'total_amount'), field(item, 'currency'))}</td><td>${date(field(item, 'endsAt', 'ends_at'))}</td><td>${status(field(item, 'status'))}</td></tr>`;
}
function renderOverview() {
  const summary = state.data.summary || {};
  const invoice = summary.invoices || {};
  const disputes = summary.disputes || {};
  const milestones = summary.milestones || {};
  const currency = invoice.currency || Object.keys(invoice.by_currency || {})[0] || 'USD';
  const totalInvoices = Number(invoice.total || 0);
  const outstanding = Number(invoice.outstanding_amount || 0);
  const collected = Number(invoice.collected_amount || 0);
  const openDisputes = Number(disputes.open || 0);
  const cash = (state.data.cashFlow?.forecast || []).find((row) => row.currency === currency) || state.data.cashFlow?.forecast?.[0] || {};
  const dueSoon = Number(cash.expected_inflow || 0);
  const overdue = Number(cash.overdue_receivables || 0);
  const recent = [...state.data.invoices].slice(0, 5);
  const chart = buildChart(state.data.cashFlow?.forecast || []);
  const pageAction = `${button('New invoice', 'new-invoice', true, '+')} ${button('Add client', 'new-client', false, '+')}`;
  return `${heading(`Good morning, ${escapeHtml((state.user?.name || 'there').split(' ')[0])}.`, 'Here is what is happening across your contracts and cash flow today.', pageAction)}<div class="metrics-grid">${metric('Outstanding receivables', money(outstanding, currency), '↗', `<span class="up">${totalInvoices} invoices</span><span>in your pipeline</span>`)}${metric('Collected to date', money(collected, currency), '✓', `<span class="up">Money received</span><span>across this workspace</span>`)}${metric('Expected in 90 days', money(dueSoon, cash.currency || currency), '⌁', `<span>Forecasted invoice inflow</span>`)}${metric('Open disputes', String(openDisputes).padStart(2, '0'), '◇', `<span>${Number(milestones.pending || 0)} milestones pending</span>`)}</div><div class="overview-grid"><section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Cash flow outlook</h2><p class="panel-subtitle">Expected inflow and overdue receivables by currency</p></div><button class="panel-link" data-page="cashflow">View forecast ↗</button></div><div class="panel-body"><div class="chart-wrap">${chart}</div><div class="chart-legend"><span><i class="legend-dot" style="background:#4c8d68"></i>Expected inflow</span><span><i class="legend-dot" style="background:#d9a66c"></i>Overdue receivables</span></div></div></section><section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Needs your attention</h2><p class="panel-subtitle">A short list of what to do next</p></div><span class="metric-icon">✦</span></div><div class="panel-body"><div class="quick-list">${attentionRow('↗','Follow up on overdue invoices',overdue > 0 ? `${money(overdue, cash.currency || currency)} awaiting payment` : 'No overdue amount in your forecast', 'cashflow')}${attentionRow('◇','Review open disputes',`${openDisputes} currently open`, 'disputes')}${attentionRow('▤','Keep milestones moving',`${Number(milestones.pending || 0)} pending milestones`, 'contracts')}${attentionRow('▱','Check document verification',`${state.data.documents.filter((d) => field(d,'verificationStatus','verification_status') !== 'verified').length} awaiting verification`, 'documents')}</div></div></section></div><div class="lower-grid"><section class="panel table-panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Recent invoices</h2><p class="panel-subtitle">Track the latest billing activity</p></div><button class="panel-link" data-page="invoices">All invoices ↗</button></div>${table(['Invoice','Client','Due date','Amount','Status'], recent.map(invoiceRow), 'Nothing billed yet', 'Create your first invoice to start tracking receivables.')}<div class="table-footer"><span>Showing ${recent.length} of ${state.data.invoices.length} invoices</span><button class="panel-link" data-action="new-invoice">+ Create invoice</button></div></section><section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Cash flow snapshot</h2><p class="panel-subtitle">The numbers behind your next 90 days</p></div></div><div class="panel-body"><div class="cash-card"><div class="cash-label">Expected inflow</div><div class="cash-value">${money(dueSoon, cash.currency || currency)}</div><div class="cash-note">Invoices due within 90 days</div></div><div class="cash-card" style="background:#fbf0e9"><div class="cash-label">Overdue receivables</div><div class="cash-value">${money(overdue, cash.currency || currency)}</div><div class="cash-note">Open invoices past their due date</div></div><button class="button button-primary" style="width:100%;margin-top:12px" data-page="cashflow">Explore forecast <span>→</span></button></div></section></div>`;
}
function attentionRow(icon, title, subtitle, page) { return `<button class="quick-row" style="width:100%;border:0;background:transparent;text-align:left" data-page="${page}"><span class="quick-icon">${icon}</span><span class="quick-copy"><strong>${title}</strong><span>${escapeHtml(subtitle)}</span></span><span style="color:#8b938a">›</span></button>`; }
function buildChart(forecast) {
  if (!forecast.length) return `<div class="chart-empty"><div><strong>Your forecast will appear here</strong>Once invoices are in place, you will see upcoming cash flow.</div></div>`;
  const max = Math.max(1, ...forecast.map((row) => Number(row.expected_inflow || 0)), ...forecast.map((row) => Number(row.overdue_receivables || 0)));
  const width = 600, height = 220, pad = { l: 12, r: 12, t: 14, b: 24 }, innerW = width - pad.l - pad.r, innerH = height - pad.t - pad.b;
  const bars = forecast.slice(0, 8).map((row, index, all) => {
    const slot = innerW / all.length, barW = Math.min(28, slot * .25), x = pad.l + slot * index + slot / 2;
    const a = Number(row.expected_inflow || 0), b = Number(row.overdue_receivables || 0);
    const ha = innerH * a / max, hb = innerH * b / max;
    return `<rect x="${(x - barW - 2).toFixed(1)}" y="${(pad.t + innerH - ha).toFixed(1)}" width="${barW}" height="${Math.max(ha, 2).toFixed(1)}" rx="4" fill="#4c8d68"/><rect x="${(x + 2).toFixed(1)}" y="${(pad.t + innerH - hb).toFixed(1)}" width="${barW}" height="${Math.max(hb, 2).toFixed(1)}" rx="4" fill="#d9a66c"/><text x="${x.toFixed(1)}" y="${height - 5}" text-anchor="middle" fill="#8b928a" font-size="10">${escapeHtml(row.currency)}</text>`;
  }).join('');
  const grid = [0, 1, 2, 3].map((i) => { const y = pad.t + innerH * i / 3; return `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="#eff0e9" stroke-dasharray="3 4"/>`; }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Expected inflow and overdue receivables chart" style="width:100%;height:100%">${grid}${bars}</svg>`;
}
function filtered(items, search, getter) { const term = search.trim().toLowerCase(); return !term ? items : items.filter((item) => getter(item).toLowerCase().includes(term)); }
function renderInvoices() {
  const rows = filtered(state.data.invoices, state.search, (item) => [field(item,'invoiceNumber','invoice_number'), field(item,'reference'), field(item,'status'), state.data.clients.find((c) => c.id === field(item,'clientId','client_id'))?.name].join(' ')).map(invoiceRow);
  return `${heading('Invoices', 'Every amount due, in one clear place.', button('New invoice','new-invoice',true,'+'))}<div class="page-toolbar"><input class="filter-input" id="page-search" placeholder="Search invoices…" value="${escapeHtml(state.search)}"/><select class="filter-select" id="status-filter"><option value="all">All statuses</option>${['draft','sent','paid','overdue','cancelled','refunded'].map((s) => `<option value="${s}">${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select><span style="font-size:11px;color:var(--muted);margin-left:auto">${state.data.invoices.length} total</span></div><section class="panel table-page"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Invoice register</h2><p class="panel-subtitle">Billing history and payment status</p></div></div>${table(['Invoice','Client','Due date','Amount','Status'], rows, 'No invoices yet', 'Create an invoice to see billing activity here.')}<div class="table-footer"><span>${rows.length} invoices shown</span><button class="panel-link" data-action="new-invoice">+ New invoice</button></div></section>`;
}
function renderContracts() {
  const rows = filtered(state.data.contracts, state.search, (item) => [field(item,'title'), field(item,'status'), state.data.clients.find((c) => c.id === field(item,'clientId','client_id'))?.name].join(' ')).map(contractRow);
  return `${heading('Contracts', 'Keep scope, value, and milestones connected.', button('New contract','new-contract',true,'+'))}<div class="page-toolbar"><input class="filter-input" id="page-search" placeholder="Search contracts…" value="${escapeHtml(state.search)}"/><span style="font-size:11px;color:var(--muted);margin-left:auto">${state.data.contracts.length} total</span></div><section class="panel table-page"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Contract register</h2><p class="panel-subtitle">Agreements and delivery commitments</p></div></div>${table(['Contract','Client','Value','End date','Status'], rows, 'No contracts yet', 'Add a contract to keep its value and delivery timeline visible.')}<div class="table-footer"><span>${rows.length} contracts shown</span><button class="panel-link" data-action="new-contract">+ New contract</button></div></section>`;
}
function renderClients() {
  const clients = filtered(state.data.clients, state.search, (item) => [field(item,'name'), field(item,'email'), field(item,'companyName','company_name')].join(' '));
  const cards = clients.map((item) => `<article class="entity-card"><div class="entity-card-top"><span class="quick-icon">${escapeHtml(initials(field(item,'companyName','company_name') || field(item,'name')))}</span><div style="min-width:0;flex:1"><h3>${escapeHtml(field(item,'name'))}</h3><p>${escapeHtml(field(item,'companyName','company_name') || 'Independent client')}</p></div>${status(field(item,'archivedAt','archived_at') ? 'archived' : 'active')}</div><div style="margin-top:14px"><p>${escapeHtml(field(item,'email') || 'No email added')}</p></div><div class="entity-card-bottom"><span>Added ${date(field(item,'createdAt','created_at'))}</span><span>${state.data.contracts.filter((c) => field(c,'clientId','client_id') === item.id).length} contracts</span></div></article>`).join('');
  return `${heading('Clients', 'Good relationships start with clear expectations.', button('Add client','new-client',true,'+'))}<div class="page-toolbar"><input class="filter-input" id="page-search" placeholder="Search clients…" value="${escapeHtml(state.search)}"/><span style="font-size:11px;color:var(--muted);margin-left:auto">${clients.length} clients</span></div>${cards ? `<div class="content-grid">${cards}</div>` : `<section class="panel"><div class="empty-state"><strong>No clients found</strong>Add a client or adjust your search.</div></section>`}`;
}
function renderDisputes() {
  const rows = filtered(state.data.disputes, state.search, (item) => [field(item,'providerDisputeId','provider_dispute_id'), field(item,'status'), field(item,'reason')].join(' ')).map((item) => `<tr><td class="cell-title">${escapeHtml(field(item,'providerDisputeId','provider_dispute_id') || field(item,'id'))}<span class="cell-sub">${escapeHtml(field(item,'reason') || 'Payment dispute')}</span></td><td>${money(field(item,'amount'), field(item,'currency'))}</td><td>${date(field(item,'createdAt','created_at'))}</td><td>${status(field(item,'status'))}</td><td><button class="button button-sm" data-action="view-dispute" data-id="${escapeHtml(item.providerDisputeId || item.provider_dispute_id || item.id)}">View details</button></td></tr>`);
  return `${heading('Disputes', 'Keep evidence and next steps together when a payment is challenged.', '')}<div class="notice"><strong>Evidence-first workflow.</strong> Settle can prepare evidence packs for review. Provider submissions should always be checked before they are sent.</div><div class="page-toolbar"><input class="filter-input" id="page-search" placeholder="Search disputes…" value="${escapeHtml(state.search)}"/><button class="button" data-action="refresh-disputes">↻ Sync from PayPal</button></div><section class="panel table-page"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Dispute register</h2><p class="panel-subtitle">Provider status and local case records</p></div></div>${table(['Dispute','Amount','Opened','Status',''], rows, 'No disputes found', 'When a dispute is synced into this workspace, it will appear here.')}</section>`;
}
function renderDocuments() {
  const docs = filtered(state.data.documents, state.search, (item) => [field(item,'filename'), field(item,'verificationStatus','verification_status'), field(item,'contentType','content_type')].join(' '));
  const rows = docs.map((item) => `<tr><td class="cell-title">▱ ${escapeHtml(field(item,'filename'))}<span class="cell-sub">${escapeHtml(field(item,'contentType','content_type'))} · ${formatBytes(field(item,'sizeBytes','size_bytes'))}</span></td><td>${date(field(item,'createdAt','created_at'))}</td><td>${status(field(item,'verificationStatus','verification_status'))}</td><td><div style="display:flex;gap:6px"><button class="button button-sm" data-action="extract-document" data-id="${escapeHtml(item.id)}">AI extract</button><button class="button button-sm" data-action="document-details" data-id="${escapeHtml(item.id)}">Details</button></div></td></tr>`);
  return `${heading('Documents', 'Your source of truth for contracts, receipts, and evidence.', button('Upload document','upload-document',true,'↑'))}<div class="notice"><strong>Private by design.</strong> Documents use workspace-scoped storage and verification. AI extraction is available after verification and when AI is enabled on your backend.</div><div class="page-toolbar"><input class="filter-input" id="page-search" placeholder="Search documents…" value="${escapeHtml(state.search)}"/><span style="font-size:11px;color:var(--muted);margin-left:auto">${docs.length} documents</span></div><section class="panel table-page"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Document library</h2><p class="panel-subtitle">Verification status and extraction actions</p></div></div>${table(['Document','Uploaded','Verification','Actions'], rows, 'No documents uploaded', 'Upload a contract or invoice to start building your evidence trail.')}</section>`;
}
function formatBytes(value) { const n = Number(value); if (!Number.isFinite(n)) return 'Size unavailable'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n/1024).toFixed(0)} KB`; return `${(n/1048576).toFixed(1)} MB`; }
function renderCashflow() {
  const forecasts = state.data.cashFlow?.forecast || [];
  const cards = forecasts.map((row) => `<article class="metric-card"><div class="metric-top"><span>${escapeHtml(row.currency)} forecast</span><span class="metric-icon">⌁</span></div><div class="metric-value">${money(row.expected_inflow,row.currency)}</div><div class="metric-foot">Expected inflow over ${Number(state.data.cashFlow?.horizon_days || 90)} days</div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, Number(row.expected_inflow || 0) / Math.max(1, Number(row.expected_inflow || 0) + Number(row.overdue_receivables || 0)) * 100)}%"></div></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted)"><span>Overdue</span><strong style="color:#b86d57">${money(row.overdue_receivables,row.currency)}</strong></div><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:8px"><span>Collected · last 30 days</span><strong>${money(row.collected_last_30_days,row.currency)}</strong></div></article>`).join('');
  return `${heading('Cash flow', 'A clearer view of what is expected, what is late, and what has landed.', `<button class="button" data-action="refresh-data">↻ Refresh forecast</button>`)}<div class="notice"><strong>Forecast methodology.</strong> Expected inflow is based on open invoices due within the selected horizon. Overdue receivables are shown separately; this is an operational forecast, not a guarantee of payment.</div>${cards ? `<div class="metrics-grid">${cards}</div>` : `<section class="panel"><div class="empty-state"><strong>No forecast data yet</strong>Create invoices to populate your cash-flow outlook.</div></section>`}<div class="overview-grid" style="margin-top:18px"><section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Forecast outlook</h2><p class="panel-subtitle">90-day snapshot by currency</p></div></div><div class="panel-body"><div class="chart-wrap">${buildChart(forecasts)}</div><div class="chart-legend"><span><i class="legend-dot" style="background:#4c8d68"></i>Expected inflow</span><span><i class="legend-dot" style="background:#d9a66c"></i>Overdue</span></div></div></section><section class="panel"><div class="panel-header"><div class="panel-header-copy"><h2 class="panel-title">Recommended next steps</h2><p class="panel-subtitle">Actions that keep your cash cycle moving</p></div></div><div class="panel-body"><div class="quick-list">${attentionRow('▧','Review open invoices',`${state.data.invoices.filter((i) => !['paid','cancelled','refunded'].includes(String(field(i,'status')).toLowerCase())).length} invoices need a status`, 'invoices')}${attentionRow('♧','Keep client details current',`${state.data.clients.length} clients in your workspace`, 'clients')}${attentionRow('▤','Review contract milestones',`${state.data.contracts.length} contracts on file`, 'contracts')}</div></div></section></div>`;
}
function renderSettings() {
  return `${heading('Settings', 'Manage your workspace connection and account.', '')}<section class="settings-card"><h3>Workspace</h3><p>All API requests are scoped to the selected workspace. Use a workspace ID that belongs to your account.</p><div class="settings-row"><label for="workspace-id">Workspace ID</label><input id="workspace-id" value="${escapeHtml(state.workspaceId)}" placeholder="Workspace UUID"/><button class="button button-primary" data-action="save-workspace">Switch workspace</button></div><div class="settings-row"><label>Workspace name</label><input id="workspace-name" value="${escapeHtml(state.workspace?.name || '')}" maxlength="120"/><button class="button" data-action="rename-workspace">Save name</button></div></section><section class="settings-card"><h3>API connection</h3><p>Frontend requests go directly to your Settle API. Configure the address before launching the frontend if the API isn't running on this machine.</p><div class="settings-row"><label>API base URL</label><input id="api-base" value="${escapeHtml(API_BASE)}"/><button class="button" data-action="save-api">Update URL</button></div><div class="settings-row"><label>Connection status</label><span id="connection-status" style="font-size:11px;color:var(--muted)"><span class="connection-dot"></span>Checking API…</span><button class="button" data-action="check-api">Check now</button></div></section><section class="settings-card"><h3>Account</h3><p>${escapeHtml(state.user?.name || '')}<br/>${escapeHtml(state.user?.email || '')}</p><div class="settings-row"><label>Session</label><span style="font-size:11px;color:var(--muted);flex:1">Access token is held in this browser tab's session storage.</span><button class="button" data-action="logout">Sign out</button></div></section>`;
}
function render() {
  if (!state.token) { renderAuth(); return; }
  const page = { overview: renderOverview, invoices: renderInvoices, contracts: renderContracts, clients: renderClients, disputes: renderDisputes, documents: renderDocuments, cashflow: renderCashflow, settings: renderSettings }[state.page] || renderOverview;
  app.innerHTML = shell(page());
  document.querySelectorAll('[data-page]').forEach((node) => node.addEventListener('click', () => { state.page = node.dataset.page; state.mobileNav = false; state.search = ''; render(); }));
  document.querySelectorAll('[data-action]').forEach((node) => node.addEventListener('click', () => handleAction(node.dataset.action, node.dataset.id)));
  document.querySelector('#logout')?.addEventListener('click', signOut);
  document.querySelector('#mobile-menu')?.addEventListener('click', () => { state.mobileNav = !state.mobileNav; render(); });
  document.querySelector('#mobile-scrim')?.addEventListener('click', () => { state.mobileNav = false; render(); });
  document.querySelector('#refresh-data')?.addEventListener('click', async () => { await loadData(); render(); toast('Workspace data refreshed.'); });
  document.querySelector('#global-search')?.addEventListener('input', (event) => { state.search = event.target.value; const focused = event.target.selectionStart; render(); const next = document.querySelector('#page-search'); if (next) { next.value = state.search; next.focus(); next.setSelectionRange(focused, focused); } });
  document.querySelector('#page-search')?.addEventListener('input', (event) => { state.search = event.target.value; const caret = event.target.selectionStart; render(); const next = document.querySelector('#page-search'); next?.focus(); next?.setSelectionRange(caret, caret); });
  document.querySelector('#status-filter')?.addEventListener('change', (event) => { const value = event.target.value; document.querySelectorAll('.data-table tbody tr').forEach((row) => { const text = row.querySelector('.status')?.textContent?.trim().toLowerCase() || ''; row.hidden = value !== 'all' && text !== value; }); });
  if (state.page === 'settings') checkApi().catch(() => {});
}
async function handleAction(action, id) {
  try {
    if (action === 'new-client') return openModal('client');
    if (action === 'new-contract') return openModal('contract');
    if (action === 'new-invoice') return openModal('invoice');
    if (action === 'upload-document') return openModal('document');
    if (action === 'refresh-data') { await loadData(); render(); toast('Workspace data refreshed.'); return; }
    if (action === 'refresh-disputes') { const result = await api('/v1/disputes'); state.data.disputes = result; render(); toast('Disputes refreshed.'); return; }
    if (action === 'extract-document') {
      await api(`/v1/documents/${encodeURIComponent(id)}/ai-extraction`, { method: 'POST', body: '{}' });
      toast('AI extraction queued.'); state.page = 'documents'; await loadData(); render(); return;
    }
    if (action === 'document-details') {
      const document = state.data.documents.find((item) => item.id === id);
      const result = await api(`/v1/documents/${encodeURIComponent(id)}/ai-extraction`);
      openInfoModal(`Document · ${field(document,'filename') || 'Details'}`, `<div class="notice">Verification: <strong>${escapeHtml(field(document,'verificationStatus','verification_status') || 'unknown')}</strong></div><h3 style="font-size:12px">AI extraction runs</h3>${result.runs?.length ? result.runs.map((run) => `<div class="quick-row"><span class="quick-copy"><strong>${escapeHtml(run.status)}</strong><span>${date(run.createdAt)} · ${escapeHtml(run.model || '')}</span></span>${status(run.status)}</div>`).join('') : '<div class="empty-state">No extraction runs yet.</div>'}<h3 style="font-size:12px;margin-top:18px">Evidence facts</h3>${result.facts?.length ? result.facts.map((fact) => `<div class="quick-row"><span class="quick-copy"><strong>${escapeHtml(fact.factType)}</strong><span>${escapeHtml(typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value))}</span></span></div>`).join('') : '<div class="empty-state">No extracted facts yet.</div>'}`);
      return;
    }
    if (action === 'view-dispute') {
      const result = await api(`/v1/disputes/${encodeURIComponent(id)}`);
      openInfoModal(`Dispute · ${id}`, `<div class="notice">Provider status and evidence actions are read from the connected PayPal account.</div><pre style="font-size:10px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8f3;padding:13px;border-radius:9px">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`); return;
    }
    if (action === 'save-workspace') {
      const next = document.querySelector('#workspace-id')?.value.trim(); if (!next) throw new Error('Enter a workspace ID.');
      state.workspaceId = next; sessionStorage.setItem('settle.workspaceId', next); state.workspace = null; sessionStorage.removeItem('settle.workspace'); await loadData(); state.page = 'overview'; render(); toast('Workspace switched.'); return;
    }
    if (action === 'rename-workspace') {
      const name = document.querySelector('#workspace-name')?.value.trim(); if (!name) throw new Error('Enter a workspace name.');
      state.workspace = await api('/v1/workspace', { method: 'PATCH', body: JSON.stringify({ name }) }); sessionStorage.setItem('settle.workspace', JSON.stringify(state.workspace)); render(); toast('Workspace name updated.'); return;
    }
    if (action === 'save-api') {
      const next = document.querySelector('#api-base')?.value.trim().replace(/\/$/, ''); if (!next || !/^https?:\/\//i.test(next)) throw new Error('Enter a valid http(s) API URL.');
      toast('API URL changed for this page. Reload to apply the connection.');
      const script = document.querySelector('script[data-api-config]'); if (script) script.remove();
      localStorage.setItem('settle.apiBase', next); location.reload(); return;
    }
    if (action === 'check-api') { await checkApi(true); return; }
    if (action === 'logout') { signOut(); return; }
  } catch (error) { toast(error.message || 'Action failed.', 'error'); }
}
function openInfoModal(title, body) {
  const wrapper = document.createElement('div'); wrapper.className = 'modal-backdrop'; wrapper.innerHTML = `<section class="modal"><header class="modal-header"><div class="modal-header-copy"><h2>${escapeHtml(title)}</h2><p>Workspace details</p></div><button class="icon-button" data-close aria-label="Close">✕</button></header><div class="modal-body">${body}<div class="form-actions"><button class="button" data-close>Close</button></div></div></section>`;
  document.body.append(wrapper); wrapper.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', () => wrapper.remove())); wrapper.addEventListener('click', (event) => { if (event.target === wrapper) wrapper.remove(); });
}
function openModal(type) {
  const config = {
    client: { title: 'Add a client', subtitle: 'Save the details you need to bill with confidence.', fields: `<div class="form-field"><label>Name *</label><input name="name" required maxlength="200" placeholder="Acme Studio" /></div><div class="form-grid"><div class="form-field"><label>Email</label><input name="email" type="email" placeholder="accounts@company.com" /></div><div class="form-field"><label>Company name</label><input name="company_name" maxlength="200" placeholder="Acme Inc." /></div></div><div class="form-field"><label>Country code</label><input name="country_code" minlength="2" maxlength="2" placeholder="US" /></div>` },
    contract: { title: 'New contract', subtitle: 'Start with the essentials. Milestones can be added after creation.', fields: `<div class="form-field"><label>Contract title *</label><input name="title" required maxlength="200" placeholder="Brand identity project" /></div><div class="form-field"><label>Client *</label><select name="client_id" required>${clientOptions()}</select></div><div class="form-grid"><div class="form-field"><label>Total value</label><input name="total_amount" inputmode="decimal" placeholder="5000.00" /></div><div class="form-field"><label>Currency</label><select name="currency"><option>USD</option><option>EUR</option><option>GBP</option><option>INR</option><option>CAD</option><option>AUD</option></select></div></div><div class="form-grid"><div class="form-field"><label>Start date</label><input name="starts_at" type="date" /></div><div class="form-field"><label>End date</label><input name="ends_at" type="date" /></div></div><div class="form-field"><label>Status</label><select name="status"><option value="draft">Draft</option><option value="active">Active</option></select></div>` },
    invoice: { title: 'Create an invoice', subtitle: 'Keep the amount, due date, and client in sync.', fields: `<div class="form-field"><label>Client *</label><select name="client_id" required>${clientOptions()}</select></div><div class="form-grid"><div class="form-field"><label>Invoice number</label><input name="invoice_number" maxlength="100" placeholder="INV-2026-001" /></div><div class="form-field"><label>Currency</label><select name="currency"><option>USD</option><option>EUR</option><option>GBP</option><option>INR</option><option>CAD</option><option>AUD</option></select></div></div><div class="form-field"><label>Description *</label><input name="description" required maxlength="500" placeholder="Product design — phase one" /></div><div class="form-grid"><div class="form-field"><label>Amount *</label><input name="unit_amount" inputmode="decimal" required pattern="^\\d+(\\.\\d{1,2})?$" placeholder="1500.00" /></div><div class="form-field"><label>Due date</label><input name="due_at" type="date" /></div></div><div class="form-field"><label>Reference</label><input name="reference" maxlength="200" placeholder="Project or PO reference" /></div><div class="form-help">This creates the invoice record in Settle. Sending it through PayPal is a separate action.</div>` },
    document: { title: 'Upload a document', subtitle: 'Upload a private file and let the worker verify it.', fields: `<div class="file-drop"><div style="font-size:25px;color:var(--green)">↑</div><strong>Choose a contract or supporting document</strong><p>PDF, PNG, JPG, GIF, TXT, CSV, or JSON · Up to 25 MB (server configuration applies)</p><label class="button" for="upload-file">Choose file</label><input id="upload-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.txt,.csv,.json,application/pdf,image/png,image/jpeg,image/gif,text/plain,text/csv,application/json" required /></div><div class="form-help" style="margin-top:12px">The browser calculates a SHA-256 checksum. Your S3 bucket must allow browser uploads from this frontend origin.</div>` },
  }[type];
  if (type === 'contract' || type === 'invoice') {
    const clients = state.data.clients;
    if (!clients.length) { toast('Add a client before creating this record.', 'error'); state.page = 'clients'; render(); return; }
  }
  const wrapper = document.createElement('div'); wrapper.className = 'modal-backdrop'; wrapper.innerHTML = `<section class="modal"><header class="modal-header"><div class="modal-header-copy"><h2>${config.title}</h2><p>${config.subtitle}</p></div><button class="icon-button" data-close aria-label="Close">✕</button></header><form class="modal-body" id="entity-form">${config.fields}<div class="form-actions"><button class="button" type="button" data-close>Cancel</button><button class="button button-primary" type="submit">${type === 'document' ? 'Upload and verify' : type === 'invoice' ? 'Create invoice' : type === 'contract' ? 'Create contract' : 'Save client'} <span>→</span></button></div></form></section>`;
  document.body.append(wrapper); wrapper.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', () => wrapper.remove())); wrapper.addEventListener('click', (event) => { if (event.target === wrapper) wrapper.remove(); });
  wrapper.querySelector('#entity-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const buttonNode = form.querySelector('[type="submit"]'); buttonNode.disabled = true; buttonNode.textContent = type === 'document' ? 'Uploading…' : 'Saving…';
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      if (type === 'client') {
        const body = { name: values.name, ...(values.email ? { email: values.email } : {}), ...(values.company_name ? { company_name: values.company_name } : {}), ...(values.country_code ? { country_code: values.country_code.toUpperCase() } : {}) };
        await api('/v1/clients', { method: 'POST', body: JSON.stringify(body) });
      } else if (type === 'contract') {
        const body = { client_id: values.client_id, title: values.title, currency: values.currency, status: values.status, ...(values.total_amount ? { total_amount: values.total_amount } : {}), ...(values.starts_at ? { starts_at: new Date(`${values.starts_at}T00:00:00`).toISOString() } : {}), ...(values.ends_at ? { ends_at: new Date(`${values.ends_at}T00:00:00`).toISOString() } : {}) };
        await api('/v1/contracts', { method: 'POST', body: JSON.stringify(body) });
      } else if (type === 'invoice') {
        const body = { client_id: values.client_id, currency: values.currency, items: [{ description: values.description, quantity: '1', unit_amount: values.unit_amount }], ...(values.invoice_number ? { invoice_number: values.invoice_number } : {}), ...(values.reference ? { reference: values.reference } : {}), ...(values.due_at ? { due_at: new Date(`${values.due_at}T00:00:00`).toISOString() } : {}) };
        await api('/v1/invoices', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      } else if (type === 'document') {
        await uploadDocument(form.querySelector('#upload-file').files[0]);
      }
      wrapper.remove(); await loadData(); render(); toast(type === 'document' ? 'Document uploaded; verification has been queued.' : `${type[0].toUpperCase()}${type.slice(1)} saved successfully.`);
    } catch (error) { toast(error.message || 'Unable to save this record.', 'error'); buttonNode.disabled = false; buttonNode.textContent = 'Try again'; }
  });
}
function clientOptions() { return `<option value="">Choose a client…</option>${state.data.clients.map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}${client.companyName ? ` — ${escapeHtml(client.companyName)}` : ''}</option>`).join('')}`; }
async function uploadDocument(file) {
  if (!file) throw new Error('Choose a file to upload.');
  if (!crypto.subtle) throw new Error('Secure browser context required to calculate a file checksum (use localhost or HTTPS).');
  const inferredTypes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', json: 'application/json' };
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const contentType = file.type || inferredTypes[extension];
  if (!contentType) throw new Error('Unsupported file type. Choose a PDF, image, text, CSV, or JSON file.');
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const signed = await api('/v1/documents/upload-url', { method: 'POST', body: JSON.stringify({ filename: file.name, content_type: contentType, sha256, size_bytes: file.size }) });
  const uploaded = await fetch(signed.url, { method: 'PUT', headers: Object.fromEntries(Object.entries(signed.required_headers || {}).filter(([key]) => key.toLowerCase() !== 'content-length')), body: file });
  if (!uploaded.ok) throw new Error(`Storage upload failed (${uploaded.status}). Check the S3 bucket CORS policy and storage configuration.`);
  await api('/v1/documents', { method: 'POST', body: JSON.stringify({ object_key: signed.key, filename: file.name, content_type: contentType, size_bytes: String(file.size), sha256 }) });
}
async function checkApi(showToast = false) {
  const target = document.querySelector('#connection-status');
  try {
    const response = await fetch(`${API_BASE}/health`, { method: 'GET' });
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    if (target) target.innerHTML = '<span class="connection-dot online"></span>Connected';
    if (showToast) toast('Settle API is reachable.');
  } catch (error) {
    if (target) target.innerHTML = `<span class="connection-dot"></span>${escapeHtml(error.message || 'Unable to reach API')}`;
    if (showToast) toast(`API connection failed: ${error.message}`, 'error');
  }
}
function signOut() {
  const refreshToken = state.refreshToken;
  if (refreshToken) api('/v1/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }, false).catch(() => {});
  clearSession(); state.page = 'overview'; render();
}

if (!state.token) renderAuth();
else if (!state.workspaceId) {
  app.innerHTML = `<div class="auth-layout"><aside class="auth-aside"><div class="auth-logo">${brand()}</div><div class="auth-copy"><div class="eyebrow">One last step</div><h1>Choose your workspace.</h1><p>Enter the workspace ID associated with your account to load your business dashboard.</p></div></aside><main class="auth-main"><form class="auth-card" id="workspace-form"><h2>Workspace ID</h2><p>You'll find this in your workspace settings or registration response.</p><div class="form-field"><label for="workspace_id">Workspace UUID</label><input id="workspace_id" required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></div><button class="button button-primary">Open workspace →</button><div class="auth-switch"><button type="button" id="signout">Sign out</button></div></form></main></div>`;
  document.querySelector('#workspace-form').addEventListener('submit', async (event) => { event.preventDefault(); state.workspaceId = document.querySelector('#workspace_id').value.trim(); sessionStorage.setItem('settle.workspaceId', state.workspaceId); await loadData(); render(); });
  document.querySelector('#signout').addEventListener('click', signOut);
} else {
  render(); loadData().then(render);
}

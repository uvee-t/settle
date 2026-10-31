# Settle frontend

React 19 + Vite + React Router. Talks to the existing Fastify API unchanged: bearer token, `x-workspace-id` header, refresh through `POST /v1/auth/refresh`.

## Run

```
npm install
VITE_SETTLE_API_URL=http://localhost:4000 npm run dev     # http://localhost:5173
npm run build && npm run preview                          # http://localhost:4173
npm test                                                  # unit tests for balances, status, forecast, CSV
```

Serve `dist/` with a fallback to `index.html` so deep links survive a refresh. Keep `/v1/*` and `/webhooks/*` routed to the API.

## Structure

```
src/
  main.jsx                 router, route guard, lazy-loaded pages
  styles/                  tokens.css (all colors, both themes), app.css, marketing.css
  services/api.js          API client (same contract; one shared refresh, auth-expired event)
  lib/
    format.js              money, dates, CSV with formula-injection protection
    models.js              API record normalizers, invoice/payment ledger (balance + one status)
    analytics.js           aging, status distribution, weekly buckets, deterministic forecast
    hooks.js               useData (shared in-flight requests), useLedger
    upload.js              validate, SHA-256, signed-URL upload, register document
  components/              ui.jsx (kit), charts.jsx, AppShell.jsx, Brand.jsx
  features/                marketing, auth, dashboard, clients, contracts, invoices,
                           payments, cashflow, disputes, documents, reports, settings
```

## Routes

`/` `/login` `/register` `/onboarding` `/dashboard` `/clients` `/clients/new` `/clients/:id` `/contracts` `/contracts/new` `/contracts/:id` `/invoices` `/invoices/new` `/invoices/:id` `/payments` `/cashflow` `/disputes` `/disputes/:id` `/documents` `/reports` `/settings`

## API endpoints used

Auth: `POST /v1/auth/{login,register,refresh}`.
Read: `GET /v1/{dashboard/summary,dashboard/cash-flow?days=,invoices,invoices/:id,payments,clients,contracts,contracts/:id,disputes,disputes/:providerId,documents,workspace,paypal/connection}`.
Write: `POST/PATCH /v1/clients`, `POST /v1/invoices` (with `Idempotency-Key`), `POST /v1/invoices/:id/{send,remind,cancel}`, `POST /v1/contracts`, `POST /v1/contracts/:id/milestones`, `PATCH /v1/milestones/:id`, `POST /v1/milestones/:id/bill`, `PATCH /v1/workspace`, `PUT/DELETE /v1/paypal/connection`, documents upload flow, dispute sync, evidence-pack and message routes.

No new endpoints or migrations are required.

## How numbers are defined

- **Balance** = invoice amount minus successful payments, never below zero. Drafts and cancelled invoices have no balance.
- **Status** (one per invoice): cancelled, draft, paid, overdue (past due with a balance, even if part-paid), partially paid, sent.
- **Collected** is by payment date. **Invoiced** is by issue date. **Outstanding** uses the API summary when it matches the selected currency.
- **Forecast** is arithmetic, not prediction: open balances land in the week of their due date, shifted by a client's median days late when they have two or more fully paid invoices. Overdue balances are shown separately. Amounts in different currencies are never combined.
- Aggregations run in the browser over the invoice, payment, client and contract lists. For very large workspaces, add server-side aggregation.

## Not included, and why

- Backend, migrations, workspace-isolation and webhook tests: the backend was not part of this upload.
- `/milestones`, `/activity`, `/payments/:id`: no list endpoint for milestones, no audit endpoint, no payment detail endpoint exists in the contract used here.
- Forgot password, remember me, OAuth, profile editing, password change, session list, notification preferences, client archive: the API calls for them are not in the current contract.
- Reminder history and dispute timeline: not returned by the API.
- Contract PDF/DOCX extraction and confidence scores: no extraction endpoint is exposed. Documents are stored and verified only.

# Settle React frontend (v0.13.1)

This is the React + Vite replacement frontend. The existing Fastify API and database schema remain in place. It uses React Router browser URLs, the existing bearer-token + `x-workspace-id` API contract, and responsive CSS based on the supplied Universal Dashboard Design prompt.

## Local development

1. Start the existing API on port 4000 using the project's normal `.env` and database setup.
2. From the repository root run `npm install` for the backend dependencies if needed.
3. Run `npm install --prefix frontend-react`.
4. Run `npm run frontend:dev` and open `http://localhost:5173`.
5. If your API is elsewhere, set `VITE_SETTLE_API_URL` before starting Vite, e.g. `VITE_SETTLE_API_URL=http://localhost:4000 npm run frontend:dev`.

## Production build

`npm run frontend:build` creates `frontend-react/dist`. Serve it through a static host configured to fall back to `index.html` for frontend routes, while keeping `/v1/*`, `/webhooks/*`, and asset paths routed appropriately. Vite preview (`npm --prefix frontend-react run preview`) supports SPA history fallback for local smoke tests.

## Included workflows

- URL routes: `/dashboard`, `/clients`, `/invoices`, `/invoices/:id`, `/contracts`, `/contracts/:id`, `/payments`, `/disputes`, `/documents`, `/cashflow`, `/settings`, `/login`, `/register`.
- Client creation and editing using `POST /v1/clients` and the new workspace-scoped `PATCH /v1/clients/:id` route.
- Invoice create/detail, send through the existing `POST /v1/invoices/:id/send`, reminder, and cancel actions.
- Contract detail, milestone creation, completion and billing through existing milestone endpoints.
- Responsive layouts, keyboard-closable dialogs, loading/error/empty states, and API error messages.

## PayPal account connection limitation

Invoice sending is wired to the existing backend route. Seller-specific PayPal account onboarding is **not** simulated: production-quality connect-your-own-account support requires PayPal partner/merchant onboarding credentials and consent configuration, plus secure persistence of the merchant association. The Settings page explains this rather than showing a fake connected state.

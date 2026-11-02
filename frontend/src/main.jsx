import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import './styles/tokens.css';
import './styles/app.css';
import './styles/marketing.css';
import { AppShell } from './components/AppShell.jsx';
import { Button, PanelSkeleton, ToastProvider } from './components/ui.jsx';
import {
  isSignedIn,
  refreshSession,
} from './services/api.js';

import Landing from './features/marketing/Landing.jsx';
import Auth from './features/auth/Auth.jsx';
import Dashboard from './features/dashboard/Dashboard.jsx';

// Product pages other than the dashboard are split out so the first load stays small.
const Onboarding = lazy(() => import('./features/auth/Onboarding.jsx'));
const Invoices = lazy(() => import('./features/invoices/Invoices.jsx'));
const InvoiceDetail = lazy(() => import('./features/invoices/InvoiceDetail.jsx'));
const Payments = lazy(() => import('./features/payments/Payments.jsx'));
const Cashflow = lazy(() => import('./features/cashflow/Cashflow.jsx'));
const Documents = lazy(() => import('./features/documents/Documents.jsx'));
const Reports = lazy(() => import('./features/reports/Reports.jsx'));
const Settings = lazy(() => import('./features/settings/Settings.jsx'));
const Clients = lazy(() => import('./features/clients/Clients.jsx').then((m) => ({ default: m.Clients })));
const ClientDetail = lazy(() => import('./features/clients/Clients.jsx').then((m) => ({ default: m.ClientDetail })));
const Contracts = lazy(() => import('./features/contracts/Contracts.jsx').then((m) => ({ default: m.Contracts })));
const ContractDetail = lazy(() => import('./features/contracts/Contracts.jsx').then((m) => ({ default: m.ContractDetail })));
const Disputes = lazy(() => import('./features/disputes/Disputes.jsx').then((m) => ({ default: m.Disputes })));
const DisputeDetail = lazy(() => import('./features/disputes/DisputeDetail.jsx').then((m) => ({ default: m.DisputeDetail })));

const page = (el) => <Suspense fallback={<PanelSkeleton rows={6} />}>{el}</Suspense>;


function Guard() {
  const location = useLocation();

  const [checking, setChecking] = useState(!isSignedIn());
  const [authenticated, setAuthenticated] = useState(isSignedIn());

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      if (isSignedIn()) {
        setAuthenticated(true);
        setChecking(false);
        return;
      }

      setChecking(true);

      const restored = await refreshSession();

      if (!active) return;

      setAuthenticated(restored && isSignedIn());
      setChecking(false);
    }

    restoreSession();

    return () => {
      active = false;
    };
  }, []);

  if (checking) {
    return <PanelSkeleton rows={6} />;
  }

  if (!authenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: {
            pathname: location.pathname,
            search: location.search,
          },
        }}
      />
    );
  }

  return <AppShell />;
}


function NotFound() {
  return (
    <div className="not-found">
      <h1>Page not found</h1>
      <p className="muted">This address does not exist in Settle.</p>
      <Button variant="primary" to="/dashboard">Back to overview</Button>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/landing', element: <Navigate to="/" replace /> },
  { path: '/login', element: <Auth mode="login" /> },
  { path: '/register', element: <Auth mode="register" /> },
  {
    element: <Guard />,
    children: [
      { path: 'onboarding', element: page(<ToastProvider><Onboarding /></ToastProvider>) },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'clients', element: page(<Clients />) },
      { path: 'clients/new', element: page(<Clients openNew />) },
      { path: 'clients/:id', element: page(<ClientDetail />) },
      { path: 'contracts', element: page(<Contracts />) },
      { path: 'contracts/new', element: page(<Contracts openNew />) },
      { path: 'contracts/:id', element: page(<ContractDetail />) },
      { path: 'invoices', element: page(<Invoices />) },
      { path: 'invoices/new', element: page(<Invoices openNew />) },
      { path: 'invoices/:id', element: page(<InvoiceDetail />) },
      { path: 'payments', element: page(<Payments />) },
      { path: 'cashflow', element: page(<Cashflow />) },
      { path: 'disputes', element: page(<Disputes />) },
      { path: 'disputes/:id', element: page(<DisputeDetail />) },
      { path: 'documents', element: page(<Documents />) },
      { path: 'reports', element: page(<Reports />) },
      { path: 'settings', element: page(<Settings />) },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);

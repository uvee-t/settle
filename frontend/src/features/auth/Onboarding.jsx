import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../../components/Brand.jsx";
import {
  Button,
  Notice,
  SelectField,
  TextField,
} from "../../components/ui.jsx";
import { api, session, updateWorkspaceCache } from "../../services/api.js";
import { invalidate } from "../../lib/hooks.js";

const STEPS = ["Workspace", "First client", "PayPal"];

/**
 * Uses only existing endpoints: PATCH /v1/workspace, POST/PATCH /v1/clients, PUT /v1/paypal/connection.
 * Retrying a step never creates a duplicate: the client id from the first success is kept and later saves become PATCH.
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ws, setWs] = useState(session().workspace?.name || "");
  const [client, setClient] = useState({
    name: "",
    email: "",
    company_name: "",
  });
  const [pp, setPp] = useState({
    environment: "sandbox",
    clientId: "",
    clientSecret: "",
    webhookId: "",
  });
  const clientId = useRef(null);
  const next = () => {
    setError("");
    setStep((s) => s + 1);
  };

  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const saveWorkspace = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/v1/workspace", {
        method: "PATCH",
        body: JSON.stringify({ name: ws.trim() }),
      });
      updateWorkspaceCache({ name: ws.trim() });
      next();
    });
  };
  const saveClient = (e) => {
    e.preventDefault();
    run(async () => {
      const body = {
        name: client.name.trim(),
        email: client.email.trim() || undefined,
        company_name: client.company_name.trim() || undefined,
      };
      if (clientId.current)
        await api(`/v1/clients/${clientId.current}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      else {
        const c = await api("/v1/clients", {
          method: "POST",
          body: JSON.stringify(body),
        });
        clientId.current = c?.id || c?.client?.id || "saved";
        if (clientId.current === "saved") clientId.current = null;
      }
      invalidate("/v1/clients");
      next();
    });
  };
  const savePaypal = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/v1/paypal/connection", {
        method: "PUT",
        body: JSON.stringify({
          clientId: pp.clientId,
          clientSecret: pp.clientSecret,
          webhookId: pp.webhookId || undefined,
          environment: pp.environment,
        }),
      });
      setPp((s) => ({ ...s, clientSecret: "", webhookId: "" }));
      navigate("/dashboard", { replace: true });
    });
  };

  return (
    <div
      className="auth-main"
      style={{
        minHeight: "100vh",
        alignContent: "start",
        justifyItems: "center",
      }}
    >
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <Brand to="/dashboard" />
        <ol className="steps" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={i === step ? "on" : i < step ? "done" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span>{i < step ? "✓" : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <Notice>{error}</Notice>

        {step === 0 && (
          <form className="form" onSubmit={saveWorkspace}>
            <h1>Name your workspace</h1>
            <p className="muted">
              This appears on your invoices and in the sidebar.
            </p>
            <TextField
              label="Workspace name"
              required
              value={ws}
              onChange={(e) => setWs(e.target.value)}
              data-autofocus
            />
            <SelectField
              label="Currency"
              value="USD"
              disabled
              options={["USD"]}
              hint="Each invoice sets its own currency. A workspace default is not yet configurable."
            />
            <div className="form-actions">
              <Button onClick={next} disabled={busy}>
                Skip
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={busy}
                disabled={!ws.trim()}
              >
                Continue
              </Button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form className="form" onSubmit={saveClient}>
            <h1>Add your first client</h1>
            <p className="muted">
              Clients are who you contract with and invoice. You can add more
              later.
            </p>
            <TextField
              label="Contact name"
              required
              value={client.name}
              onChange={(e) => setClient({ ...client, name: e.target.value })}
              data-autofocus
            />
            <TextField
              label="Email"
              type="email"
              value={client.email}
              onChange={(e) => setClient({ ...client, email: e.target.value })}
              hint="Needed to send invoices through PayPal."
            />
            <TextField
              label="Company"
              value={client.company_name}
              onChange={(e) =>
                setClient({ ...client, company_name: e.target.value })
              }
            />
            <div className="form-actions">
              <Button onClick={next} disabled={busy}>
                Skip
              </Button>
              <Button
                variant="primary"
                type="submit"
                loading={busy}
                disabled={!client.name.trim()}
              >
                Save and continue
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <form className="form" onSubmit={savePaypal}>
            <h1>Connect PayPal</h1>
            <p className="muted">
              Optional. You can explore Settle first. Credentials are validated
              and encrypted on the server and are never shown again.
            </p>
            <SelectField
              label="Environment"
              value={pp.environment}
              onChange={(e) => setPp({ ...pp, environment: e.target.value })}
              options={[
                ["sandbox", "Sandbox (testing)"],
                ["live", "Live"],
              ]}
            />
            <TextField
              label="Client ID"
              required
              value={pp.clientId}
              onChange={(e) => setPp({ ...pp, clientId: e.target.value })}
              autoComplete="off"
            />
            <TextField
              label="Client secret"
              required
              type="password"
              minLength={8}
              value={pp.clientSecret}
              onChange={(e) => setPp({ ...pp, clientSecret: e.target.value })}
              autoComplete="new-password"
            />
            <TextField
              label="Webhook ID (optional)"
              type="password"
              value={pp.webhookId}
              onChange={(e) => setPp({ ...pp, webhookId: e.target.value })}
              autoComplete="off"
            />
            <div className="form-actions">
              <Button
                onClick={() => navigate("/dashboard", { replace: true })}
                disabled={busy}
              >
                Skip for now
              </Button>
              <Button variant="primary" type="submit" loading={busy}>
                Validate and finish
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { Brand } from "../../components/Brand.jsx";
import { Button, Field, Notice, TextField } from "../../components/ui.jsx";
import { HeroArt } from "../marketing/HeroArt.jsx";
import { api, isSignedIn, saveSession } from "../../services/api.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PasswordInput({ id, show, onToggle, ...props }) {
  return (
    <div className="pw">
      <input id={id} type={show ? "text" : "password"} {...props} />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function validate(mode, v) {
  const e = {};
  if (mode === "register" && !v.name.trim()) e.name = "Enter your full name.";
  if (!v.email.trim()) e.email = "Enter your email address.";
  else if (!EMAIL.test(v.email.trim()))
    e.email = "Enter a valid email address.";
  if (!v.password) e.password = "Enter your password.";
  else if (mode === "register" && v.password.length < 10)
    e.password = "Use at least 10 characters.";
  if (mode === "register") {
    if (!v.workspace_name.trim()) e.workspace_name = "Name your workspace.";
    if (v.confirm !== v.password) e.confirm = "Passwords do not match.";
  }
  return e;
}

export default function Auth({ mode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const from = location.state?.from;
  const target =
    from?.pathname && !["/login", "/register", "/"].includes(from.pathname)
      ? `${from.pathname}${from.search || ""}`
      : "/dashboard";
  const [v, setV] = useState({
    name: "",
    email: "",
    password: "",
    confirm: "",
    workspace_name: "",
  });
  const [touched, setTouched] = useState({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    location.state?.expired
      ? "Your session expired. Sign in again to continue."
      : "",
  );
  const errors = validate(mode, v);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const err = (k) => (touched[k] || touched.all ? errors[k] : undefined);

  useEffect(() => {
    document.title =
      mode === "login" ? "Sign in · Settle" : "Create account · Settle";
    setError(
      location.state?.expired && mode === "login"
        ? "Your session expired. Sign in again to continue."
        : "",
    );
    setTouched({});
  }, [mode, location.state]);

  if (isSignedIn()) return <Navigate to={target} replace />;

  async function submit(e) {
    e.preventDefault();
    setTouched({ all: true });
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError("");
    const body =
      mode === "register"
        ? {
            name: v.name.trim(),
            email: v.email.trim(),
            password: v.password,
            workspace_name: v.workspace_name.trim(),
          }
        : { email: v.email.trim(), password: v.password };
    try {
      const p = await api(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      saveSession(p);
      navigate(mode === "register" ? "/onboarding" : target, { replace: true });
    } catch (ex) {
      setError(
        mode === "login" && (ex.status === 401 || ex.status === 400)
          ? "The email or password is incorrect."
          : ex.message,
      );
    } finally {
      setBusy(false);
    }
  }

  const rules = [["10+ characters", v.password.length >= 10]];

  return (
    <div className="auth">
      <aside className="auth-side">
        <Brand />
        <div>
          <HeroArt compact />
          <h2>From signed contract to money received.</h2>
          <p>Milestones, invoices, payments and cash flow in one workspace.</p>
        </div>
        <span className="tiny">Settle</span>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <Brand />
          <h1>{mode === "login" ? "Sign in" : "Create your workspace"}</h1>
          <p>
            {mode === "login"
              ? "Welcome back. Enter your details to continue."
              : "Set up an account and a workspace. You can connect PayPal later."}
          </p>
          <form className="form" onSubmit={submit} noValidate>
            <Notice>{error}</Notice>
            {mode === "register" && (
              <TextField
                label="Full name"
                required
                autoComplete="name"
                value={v.name}
                onChange={set("name")}
                onBlur={blur("name")}
                error={err("name")}
                data-autofocus
              />
            )}
            <TextField
              label={mode === "register" ? "Work email" : "Email"}
              required
              type="email"
              autoComplete="email"
              inputMode="email"
              value={v.email}
              onChange={set("email")}
              onBlur={blur("email")}
              error={err("email")}
              autoFocus={mode === "login"}
            />
            <Field
              label="Password"
              required
              error={err("password")}
              hint={mode === "register" ? undefined : undefined}
            >
              {(a) => (
                <PasswordInput
                  {...a}
                  show={show}
                  onToggle={() => setShow(!show)}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={v.password}
                  onChange={set("password")}
                  onBlur={blur("password")}
                />
              )}
            </Field>
            {mode === "register" && (
              <>
                <div className="pw-rules">
                  {rules.map(([t, ok]) => (
                    <span key={t} className={ok ? "ok" : ""}>
                      {ok ? "✓" : "○"} {t}
                    </span>
                  ))}
                </div>
                <Field label="Confirm password" required error={err("confirm")}>
                  {(a) => (
                    <PasswordInput
                      {...a}
                      show={show}
                      onToggle={() => setShow(!show)}
                      autoComplete="new-password"
                      value={v.confirm}
                      onChange={set("confirm")}
                      onBlur={blur("confirm")}
                    />
                  )}
                </Field>
                <TextField
                  label="Workspace name"
                  required
                  autoComplete="organization"
                  value={v.workspace_name}
                  onChange={set("workspace_name")}
                  onBlur={blur("workspace_name")}
                  error={err("workspace_name")}
                  hint="Your business or studio name. You can change it later."
                />
              </>
            )}
            <Button
              variant="primary"
              type="submit"
              loading={busy}
              className="lg"
              style={{ width: "100%", height: 42 }}
            >
              {busy
                ? mode === "login"
                  ? "Signing in…"
                  : "Creating workspace…"
                : mode === "login"
                  ? "Sign in"
                  : "Create workspace"}
            </Button>
          </form>
          <p className="auth-alt">
            {mode === "login" ? (
              <>
                New to Settle? <Link to="/register">Create an account</Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link to="/login" state={location.state}>
                  Sign in
                </Link>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}

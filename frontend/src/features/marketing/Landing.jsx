import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, CheckCircle2, FileText, Menu, Scale, TrendingUp, X } from 'lucide-react';
import { Brand } from '../../components/Brand.jsx';
import { HeroArt } from './HeroArt.jsx';
import { isSignedIn } from '../../services/api.js';

const STAGES = [
  ['Capture the contract', 'Upload the signed agreement or statement of work to the workspace. Files are hashed and stored behind time-limited URLs.'],
  ['Define milestones and terms', 'Break the scope into dated, priced milestones. You enter and confirm every value, so nothing becomes a term by accident.'],
  ['Generate and send invoices', 'Complete a milestone and Settle drafts the invoice. Sending goes through your own PayPal app, and Settle only reports success when PayPal does.'],
  ['Track payments and follow up', 'Invoices move between sent, overdue and paid as records change. Send a reminder from the invoice when one is late.'],
  ['Forecast and prepare evidence', 'See scheduled inflow by week, and assemble contracts, invoices and payment history into a reviewable dispute evidence pack.'],
];

const DEMO_ROWS = [
  ['Northwind Studio', 'SET-1042', '$8,400', 'Overdue', 'danger'],
  ['Halvorsen & Co', 'SET-1047', '$5,200', 'Sent', 'primary'],
  ['Pale Orbit Labs', 'SET-1049', '$9,800', 'Partially paid', 'violet'],
  ['Tandem Health', 'SET-1052', '$12,500', 'Paid', 'success'],
];

function PreviewChart() {
  const pts = [28, 34, 30, 44, 40, 52, 48, 60];
  const w = 520, h = 150, step = w / (pts.length + 3);
  const xy = (v, i) => [20 + i * step, h - 14 - v * 1.7];
  const path = pts.map((v, i) => `${i ? 'L' : 'M'}${xy(v, i).join(' ')}`).join('');
  const fut = [64, 70, 66].map((v, i) => xy(v, pts.length + i));
  const last = xy(pts.at(-1), pts.length - 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="prev-chart" role="img" aria-label="Sample cash-flow chart: weekly collections rising, with a dashed projection">
      {[0, 1, 2, 3].map((i) => <line key={i} x1="20" x2={w - 10} y1={14 + i * 40} y2={14 + i * 40} stroke="var(--border)" strokeDasharray="2 4" />)}
      <path d={`${path}L${last[0]} ${h - 14}L20 ${h - 14}Z`} fill="var(--primary)" opacity=".1" />
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" />
      <path d={`M${last.join(' ')}${fut.map((p) => `L${p.join(' ')}`).join('')}`} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeDasharray="5 4" />
      {fut.map((p, i) => <rect key={i} x={p[0] - 9} y={p[1] + 18} width="18" height={h - 14 - p[1] - 18} fill="var(--cyan)" opacity=".25" />)}
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="var(--primary)" />
    </svg>
  );
}

function ProductPreview() {
  return (
    <div className="prev" aria-label="Product preview with sample data">
      <div className="prev-bar"><i /><i /><i /><span>Overview</span><em>Sample data</em></div>
      <div className="prev-kpis">
        {[['Outstanding', '$35,900', '4 unpaid invoices'], ['Collected', '$48,200', 'last 30 days'], ['Overdue', '$8,400', '1 invoice'], ['Expected inflow', '$27,500', 'due in 30 days']].map(([a, b, c]) => (
          <div key={a}><small>{a}</small><b>{b}</b><span>{c}</span></div>
        ))}
      </div>
      <div className="prev-main">
        <div className="prev-card">
          <div className="prev-h"><b>Cash flow</b><span><i className="l1" />Collected <i className="l2" />Expected</span></div>
          <PreviewChart />
        </div>
        <div className="prev-card">
          <div className="prev-h"><b>Milestones</b><span>Northwind Studio</span></div>
          <ol className="prev-ms">
            {[['Kickoff', 'Paid', 1], ['Design review', 'Invoiced', 1], ['Build', 'In progress', 0], ['Delivery', 'Planned', 0]].map(([t, s, on]) => (
              <li key={t} className={on ? 'on' : ''}><span />{t}<em>{s}</em></li>
            ))}
          </ol>
        </div>
      </div>
      <div className="prev-table">
        {DEMO_ROWS.map(([c, n, a, s, tone]) => (
          <div key={n}><span>{c}</span><span className="mono">{n}</span><span className="num">{a}</span><span className={`badge tone-${tone}`}>{s}</span></div>
        ))}
      </div>
    </div>
  );
}

function MiniRemind() {
  return (
    <div className="mini">
      <div className="mini-row"><span className="badge tone-danger">Overdue</span><b>SET-1042</b><span className="tiny">12 days late</span></div>
      <div className="mini-row"><Bell size={14} /> <span>Reminder sent</span><span className="tiny mono">Oct 22</span></div>
      <div className="mini-row"><Bell size={14} /> <span>Reminder sent</span><span className="tiny mono">Oct 15</span></div>
      <div className="mini-row"><FileText size={14} /> <span>Invoice sent via PayPal</span><span className="tiny mono">Oct 1</span></div>
    </div>
  );
}
function MiniForecast() {
  const bars = [30, 44, 22, 58, 40, 70, 36, 52];
  return (
    <div className="mini">
      <svg viewBox="0 0 320 110" width="100%" role="img" aria-label="Sample weekly scheduled inflow">
        {bars.map((v, i) => <rect key={i} x={12 + i * 38} y={100 - v} width="24" height={v} rx="2" fill={i < 3 ? 'var(--primary)' : 'var(--cyan)'} opacity={i < 3 ? 1 : 0.7} />)}
        <line x1="8" x2="312" y1="100" y2="100" stroke="var(--border-strong)" />
      </svg>
      <p className="tiny">Past weeks in indigo. Scheduled weeks in cyan, placed by due date.</p>
    </div>
  );
}
function MiniEvidence() {
  return (
    <div className="mini">
      {[['Signed contract', 'Document', true], ['Milestone completed', 'Contract record', true], ['Invoice SET-1042', 'Invoice', true], ['Delivery confirmation', 'Not yet attached', false]].map(([a, b, ok]) => (
        <div className="mini-row" key={a}><CheckCircle2 size={14} style={{ color: ok ? 'var(--success)' : 'var(--border-strong)' }} /><span>{a}</span><span className="tiny">{b}</span></div>
      ))}
    </div>
  );
}
function MiniDoc() {
  return (
    <div className="mini">
      <div className="mini-row"><FileText size={14} /><b>sow-northwind.pdf</b><span className="badge tone-success">Verified</span></div>
      {[['Total value', '$42,000'], ['Payment terms', 'Net 30'], ['Milestones', '3']].map(([a, b]) => <div className="mini-row" key={a}><span className="tiny">{a}</span><b className="num">{b}</b><span className="tiny">Entered by you</span></div>)}
    </div>
  );
}
function MiniMilestone() {
  return (
    <div className="mini">
      {[['Kickoff', 30, 0, 1], ['Design review', 40, 22, 1], ['Delivery', 30, 56, 0]].map(([t, w, l, d]) => (
        <div className="tl-row" key={t}><span>{t}</span><div className="tl-track"><div className={`tl-bar ${d ? 'done' : ''}`} style={{ left: `${l}%`, width: `${w}%` }} /></div></div>
      ))}
    </div>
  );
}
function MiniPaypal() {
  return (
    <div className="mini">
      <div className="mini-row"><b>SET-1049</b><span className="badge tone-primary">Sent</span><span className="tiny mono">PayPal INV2-…</span></div>
      <div className="mini-row"><span className="tiny">Provider response</span><span>Invoice created and sent</span></div>
      <p className="tiny">Settle shows the real PayPal result. A failed send stays a failed send.</p>
    </div>
  );
}

const FEATURES = [
  ['Contract and document intelligence', 'Keep the signed document next to the numbers that came from it. Each upload is checksummed, scoped to your workspace and verified before it can be used as evidence.', MiniDoc],
  ['Milestone management', 'Plan delivery as dated, priced milestones. Completing one drafts the invoice, and invoices that were already sent are never rewritten behind your back.', MiniMilestone],
  ['PayPal invoicing', 'Connect your own PayPal app per workspace, in sandbox or live. Credentials are validated and encrypted on the server and never returned to the browser.', MiniPaypal],
  ['Payment reminders', 'Overdue invoices are surfaced where you work. Send a reminder from the invoice and see the history in one place.', MiniRemind],
  ['Cash-flow forecasting', 'A transparent model: open balances land on their due date, shifted by each client’s typical delay once there is enough history. It is arithmetic on your own records, and it says so.', MiniForecast],
  ['Dispute evidence', 'Sync PayPal disputes, generate an evidence pack from your contracts, invoices and payments, and approve each item before anything is submitted.', MiniEvidence],
];

export default function Landing() {
  const [menu, setMenu] = useState(false);
  const authed = isSignedIn();
  useEffect(() => { document.title = 'Settle · From signed contracts to money in the bank'; }, []);
  return (
    <div className="mk">
      <header className="mk-nav">
        <div className="mk-wrap mk-nav-in">
          <Brand />
          <nav className={menu ? 'open' : ''} aria-label="Site">
            <a href="#product" onClick={() => setMenu(false)}>Product</a>
            <a href="#how" onClick={() => setMenu(false)}>How it works</a>
            <a href="#features" onClick={() => setMenu(false)}>Features</a>
          </nav>
          <div className="mk-nav-cta">
            <Link to={authed ? '/dashboard' : '/login'} className="btn ghost">{authed ? 'Open app' : 'Sign in'}</Link>
            {!authed && <Link to="/register" className="btn primary">Get started</Link>}
            <button type="button" className="icon-btn mk-burger" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? <X size={17} /> : <Menu size={17} />}</button>
          </div>
        </div>
      </header>

      <main>
        <section className="mk-wrap mk-hero">
          <div>
            <p className="mk-eyebrow">Contract-to-cash for freelancers and agencies</p>
            <h1>From signed contracts to money in the bank.</h1>
            <p className="mk-lead">Manage milestones, automate invoicing, track payments, and understand your future cash flow in one connected workspace.</p>
            <div className="mk-cta">
              <Link to="/register" className="btn primary lg">Get started <ArrowRight size={16} /></Link>
              <a href="#how" className="btn lg">Explore the workflow</a>
            </div>
          </div>
          <HeroArt />
        </section>

        <section className="mk-wrap mk-section" id="product">
          <div className="mk-sec-head"><p className="mk-eyebrow">Product preview</p><h2>Everything owed, and when it lands.</h2></div>
          <ProductPreview />
          <p className="tiny mk-fine">Preview built from sample data to show the layout. These figures are not customer results.</p>
        </section>

        <section className="mk-wrap mk-section" id="how">
          <div className="mk-sec-head"><p className="mk-eyebrow">How it works</p><h2>One path from scope to settled invoice.</h2></div>
          <ol className="mk-steps">
            {STAGES.map(([t, d], i) => (
              <li key={t}><span className="mk-num">{String(i + 1).padStart(2, '0')}</span><h3>{t}</h3><p>{d}</p></li>
            ))}
          </ol>
        </section>

        <section className="mk-wrap mk-section" id="features">
          <div className="mk-sec-head"><p className="mk-eyebrow">Capabilities</p><h2>Built around the questions that decide whether you get paid.</h2></div>
          <div className="mk-features">
            {FEATURES.map(([t, d, Mini]) => (
              <article key={t}><div><h3>{t}</h3><p>{d}</p></div><Mini /></article>
            ))}
          </div>
        </section>

        <section className="mk-wrap">
          <div className="mk-final">
            <div><h2>Know what you are owed, and when.</h2><p>Create a workspace, add a client, and have your first invoice drafted today. PayPal is optional until you are ready to send.</p></div>
            <Link to="/register" className="btn primary lg">Create your workspace <ArrowRight size={16} /></Link>
          </div>
        </section>
      </main>

      <footer className="mk-wrap mk-foot">
        <Brand />
        <span className="tiny">Contract-to-cash workspace for freelancers and agencies.</span>
        <div><Link to="/login">Sign in</Link><Link to="/register">Create account</Link></div>
      </footer>
    </div>
  );
}

export { Scale, TrendingUp };

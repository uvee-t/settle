import { Link } from 'react-router-dom';

/** Two overlapping sheets, one marked: a contract that became a receivable. */
export function Mark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.5" y="3" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="var(--bg)" />
      <path d="M11.5 12.5h6M11.5 9.5h3" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ to = '/', name = true }) {
  return (
    <Link to={to} className="brand" aria-label="Settle home">
      <Mark />
      {name && <span className="brand-name">Settle</span>}
    </Link>
  );
}

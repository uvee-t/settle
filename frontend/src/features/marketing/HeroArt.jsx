/** Original Settle illustration: a contract becomes milestones, an invoice, and a cash-flow line. Pure SVG. */
export function HeroArt({ compact = false }) {
  const stroke = 'var(--fg)';
  return (
    <svg className="hero-art" viewBox="0 0 560 440" role="img" aria-label="A contract document splitting into milestones, an invoice and a cash-flow line" style={compact ? { maxHeight: 300 } : undefined}>
      <defs>
        <linearGradient id="gA" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--cyan)' }} />
          <stop offset=".55" style={{ stopColor: 'var(--violet)' }} />
          <stop offset="1" style={{ stopColor: 'var(--pink)' }} />
        </linearGradient>
        <linearGradient id="gB" x1="0" x2="1">
          <stop offset="0" style={{ stopColor: 'var(--cyan)' }} />
          <stop offset="1" style={{ stopColor: 'var(--violet)' }} />
        </linearGradient>
        <linearGradient id="gFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--violet)', stopOpacity: 0.28 }} />
          <stop offset="1" style={{ stopColor: 'var(--violet)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>

      {/* layered contract sheets */}
      <g transform="rotate(-7 160 150)"><rect x="34" y="36" width="190" height="250" rx="4" fill="url(#gA)" opacity=".16" stroke="url(#gA)" strokeWidth="1.2" /></g>
      <g transform="rotate(-3 160 150)"><rect x="46" y="30" width="190" height="250" rx="4" fill="var(--bg)" stroke="url(#gB)" strokeWidth="1.2" /></g>
      <rect x="58" y="24" width="190" height="250" rx="4" fill="var(--bg)" stroke={stroke} strokeWidth="1.3" />
      <text x="76" y="56" style={{ fontFamily: 'var(--mono)', fontSize: 10, fill: 'var(--text-3)', letterSpacing: '.08em' }}>STATEMENT OF WORK</text>
      {[76, 92, 108].map((y, i) => <rect key={y} x="76" y={y} width={[140, 120, 132][i]} height="5" rx="2.5" fill="var(--border-strong)" />)}
      <rect x="76" y="132" width="150" height="26" rx="3" fill="url(#gA)" opacity=".18" />
      <rect x="76" y="132" width="150" height="26" rx="3" fill="none" stroke="url(#gA)" strokeWidth="1.2" />
      <text x="84" y="149" style={{ fontFamily: 'var(--mono)', fontSize: 10, fill: 'var(--fg)' }}>Net 30 · 3 milestones</text>
      {[176, 192, 208, 224].map((y, i) => <rect key={y} x="76" y={y} width={[136, 100, 128, 70][i]} height="5" rx="2.5" fill="var(--border-strong)" />)}
      <path d="M76 254h60" stroke={stroke} strokeWidth="1.2" /><path d="M76 254c8-10 12 6 22-4" stroke="none" />

      {/* connectors */}
      <g fill="none" stroke="url(#gB)" strokeWidth="1.2" strokeDasharray="3 4">
        <path d="M226 145C262 145 262 66 300 66" /><path d="M226 145C262 145 262 122 300 122" /><path d="M226 145C262 145 262 178 300 178" />
      </g>

      {/* milestones */}
      {[['Kickoff', '30%', 66, true], ['Design review', '40%', 122, true], ['Delivery', '30%', 178, false]].map(([t, p, y, done]) => (
        <g key={t}>
          <rect x="300" y={y - 22} width="200" height="44" rx="4" fill="var(--bg)" stroke={stroke} strokeWidth="1.2" />
          <circle cx="320" cy={y} r="6" fill={done ? 'var(--success)' : 'none'} stroke={done ? 'var(--success)' : stroke} strokeWidth="1.3" />
          {done && <path d={`M317 ${y}l2.2 2.2 4-4.4`} stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
          <text x="336" y={y + 4} style={{ fontFamily: 'var(--sans)', fontSize: 12, fill: 'var(--fg)' }}>{t}</text>
          <text x="488" y={y + 4} textAnchor="end" style={{ fontFamily: 'var(--mono)', fontSize: 11, fill: 'var(--text-2)' }}>{p}</text>
        </g>
      ))}

      {/* invoice */}
      <path d="M400 202v18" stroke="url(#gB)" strokeWidth="1.2" strokeDasharray="3 4" fill="none" />
      <rect x="318" y="222" width="182" height="82" rx="4" fill="var(--bg)" stroke={stroke} strokeWidth="1.3" />
      <text x="334" y="244" style={{ fontFamily: 'var(--mono)', fontSize: 10, fill: 'var(--text-3)', letterSpacing: '.08em' }}>INVOICE</text>
      <rect x="440" y="232" width="48" height="16" rx="3" fill="var(--primary-bg)" /><text x="464" y="244" textAnchor="middle" style={{ fontFamily: 'var(--sans)', fontSize: 10, fill: 'var(--primary)', fontWeight: 500 }}>Sent</text>
      <rect x="334" y="256" width="90" height="5" rx="2.5" fill="var(--border-strong)" />
      <rect x="334" y="270" width="60" height="5" rx="2.5" fill="var(--border-strong)" />
      <rect x="334" y="284" width="150" height="1" fill="var(--border)" />
      <rect x="418" y="291" width="66" height="7" rx="3" fill="url(#gA)" />

      {/* cash flow */}
      <path d="M40 330H520" stroke="var(--border-strong)" strokeWidth="1" />
      <path d="M40 410L100 392L160 398L220 372L280 380L340 348L400 358L460 336L520 342V410Z" fill="url(#gFill)" />
      <path d="M40 410L100 392L160 398L220 372L280 380L340 348L400 358L460 336" fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M460 336L520 342" fill="none" stroke="url(#gA)" strokeWidth="1.6" strokeDasharray="4 4" />
      <circle cx="460" cy="336" r="4" fill="var(--bg)" stroke={stroke} strokeWidth="1.4" />
      <text x="40" y="326" style={{ fontFamily: 'var(--mono)', fontSize: 10, fill: 'var(--text-3)', letterSpacing: '.08em' }}>CASH FLOW</text>
      <path d="M514 226v94" stroke="none" />
    </svg>
  );
}

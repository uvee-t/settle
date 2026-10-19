import Script from 'next/script';

export default function Home() {
  return <><div id="app"><div className="boot-screen"><div className="brand-mark">s.</div><p>Getting Settle ready…</p></div></div><Script src="/app.js" strategy="afterInteractive" /></>;
}

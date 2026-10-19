import '../styles.css';
import Script from 'next/script';
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settle — Contract to cash',
  description: 'Contracts, invoices, and payment follow-ups in one calm workspace.',
};

export default function RootLayout({ children }) {
  const apiUrl = process.env.SETTLE_API_URL || 'http://localhost:4000';
  const config = `window.SETTLE_API_URL = ${JSON.stringify(apiUrl).replace(/</g, '\\u003c')};`;
  return <html lang="en"><body><Script id="settle-config" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: config }} />{children}</body></html>;
}

import type { Metadata } from 'next';
import './globals.css';
import TopNav from '@/components/TopNav';

export const metadata: Metadata = {
  title: 'HOME Intelligence Layer',
  description:
    'Prototype intelligence layer over a synthetic book of UAE mortgage cases. Synthetic data, not affiliated with Holo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <TopNav />
        {children}
        <footer className="mx-auto max-w-[1180px] px-6 py-8 text-xs text-slate-400">
          Synthetic data. Built as a working proposal by Swathi Naik — not affiliated with
          Holo. No live data, no API calls in this deployment.
        </footer>
      </body>
    </html>
  );
}

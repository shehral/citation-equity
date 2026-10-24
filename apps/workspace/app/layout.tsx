import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { THEME_SCRIPT } from '@/components/theme-toggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'Citation Equity',
  description:
    'A writing workspace that checks a draft against the GEO design of Prof. Akram Bayat, shows the evidence behind every check, and never rewrites without a click.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed inline script sets the theme before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}

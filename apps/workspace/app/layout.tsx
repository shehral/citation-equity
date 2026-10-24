import type { Metadata } from 'next';
import { Instrument_Sans, JetBrains_Mono, Newsreader } from 'next/font/google';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { THEME_SCRIPT } from '@/lib/theme';
import { cn } from '@/lib/utils';
import './globals.css';

// next/font downloads the font files at build time and serves them from the static export
// (under the base path), so the page makes no request to Google at runtime. Each font sets a
// CSS variable on <html>; app/globals.css maps them to font-serif, font-sans and font-mono.
const newsreader = Newsreader({
  subsets: ['latin'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-newsreader',
});
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
  // Only the HTML paste box and code use it; no need to preload it on every page.
  preload: false,
});

export const metadata: Metadata = {
  title: 'Citation Equity',
  description:
    'Paste a draft, fix what makes it hard for AI search to quote, check your page and see who AI cites. It suggests; you decide.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(newsreader.variable, instrumentSans.variable, jetbrainsMono.variable)}
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed inline script sets the theme before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

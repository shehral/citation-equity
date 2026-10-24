'use client';

import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { setLastView } from '@/lib/store';
import { viewForPathname } from '@/lib/views';
import { AboutDialog } from './about-dialog';
import { Footer } from './footer';
import { Header } from './header';

const ABOUT_HASH = '#about';

/**
 * The frame around every page (app/layout.tsx): header, the page, footer and the About dialog.
 *
 * - Pages render their own <main>; the shell adds none.
 * - The shell records the current view with setLastView after each navigation. React runs a
 *   page's effects before the shell's, so a page can read the previous getLastView() on mount
 *   (the home's "land on the last view" rule relies on this).
 * - About is a dialog. It opens from the footer, the More menu, or any URL ending in #about
 *   (the /about/ redirect); the hash is then removed so a reload does not reopen it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const view = viewForPathname(pathname);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (view) setLastView(view);
  }, [view]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check the hash after each navigation
  useEffect(() => {
    function openFromHash() {
      if (window.location.hash !== ABOUT_HASH) return;
      setAboutOpen(true);
      const { pathname: path, search } = window.location;
      window.history.replaceState(window.history.state, '', `${path}${search}`);
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [pathname]);

  const openAbout = () => setAboutOpen(true);
  return (
    <>
      <Header view={view} onAbout={openAbout} />
      <div className="flex flex-1 flex-col">{children}</div>
      <Footer onAbout={openAbout} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}

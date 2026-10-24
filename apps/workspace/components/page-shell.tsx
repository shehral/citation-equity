import type { ReactNode } from 'react';

/**
 * The reading column of the text pages (/site, /cited, /research). The header and footer come
 * from the app shell (components/shell/app-shell.tsx).
 */
export function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-base sm:px-6">
      <h1 className="font-medium font-serif text-4xl tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

export const textLink =
  'rounded-sm text-brand underline underline-offset-2 outline-none hover:text-brand-hover focus-visible:ring-[3px] focus-visible:ring-ring';

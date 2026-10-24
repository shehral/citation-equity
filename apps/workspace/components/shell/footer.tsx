import Link from 'next/link';
import { REPO_URL } from '@/lib/links';
import { cn } from '@/lib/utils';
import { RESEARCH_HREF } from '@/lib/views';

const item = cn(
  'rounded-sm text-ink-soft outline-none transition-colors hover:text-foreground hover:underline',
  'underline-offset-4 focus-visible:ring-[3px] focus-visible:ring-ring',
);

/** The one-line footer on every page: About · Research · GitHub. */
export function Footer({ onAbout }: { onAbout(): void }) {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-5 text-sm sm:px-6">
        <button type="button" onClick={onAbout} className={item}>
          About
        </button>
        <span aria-hidden="true" className="text-ink-faint">
          ·
        </span>
        <Link href={RESEARCH_HREF} prefetch={false} className={item}>
          Research
        </Link>
        <span aria-hidden="true" className="text-ink-faint">
          ·
        </span>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={item}>
          GitHub
        </a>
      </div>
    </footer>
  );
}

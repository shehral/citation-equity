// The dashboard's views and their routes. Routes end in "/" because the static
// export uses trailingSlash; next/link adds the base path.
import type { ViewId } from './store';

export const VIEW_HREF: Record<ViewId, string> = {
  home: '/',
  draft: '/draft/',
  site: '/site/',
  cited: '/cited/',
};

/** Where the home's Next up deep-links: the draft view's Start here list, the site view's first failing row. */
export const START_HERE_ID = 'start-here';
export const FIRST_ISSUE_ID = 'first-issue';

/** Pages that are not views but are linked from the shell. */
export const RESEARCH_HREF = '/research/';
/** The home with the About dialog open (the /about/ redirect target). */
export const ABOUT_HREF = '/#about';

/** The view a pathname shows (as usePathname returns it, without the base path), or null. */
export function viewForPathname(pathname: string | null): ViewId | null {
  if (pathname === null) return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  for (const [view, href] of Object.entries(VIEW_HREF) as [ViewId, string][]) {
    if ((href.replace(/\/+$/, '') || '/') === path) return view;
  }
  return null;
}

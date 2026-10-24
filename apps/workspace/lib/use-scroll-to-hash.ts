'use client';

import { useEffect, useRef } from 'react';

/**
 * Scrolls to the element with `id` once, when the page's URL hash names it and the element is
 * on the page (`ready`). The home's Next up links to anchors that appear only after a view has
 * worked something out (the draft's Start here, the site's first failing row), so the browser's
 * own jump to the hash finds nothing; this jumps when the anchor arrives, and never again.
 */
export function useScrollToHash(id: string, ready: boolean): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || window.location.hash !== `#${id}`) return;
    const el = document.getElementById(id);
    if (!el) return;
    done.current = true;
    el.scrollIntoView?.({ block: 'start' });
  }, [id, ready]);
}

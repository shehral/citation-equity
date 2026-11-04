'use client';

import { useEffect } from 'react';
import { migrateStore } from '@/lib/migrate';

/**
 * Brings an older build's stored values to this build's shapes (lib/migrate.ts). The app shell
 * renders it first and the root layout mounts the shell once, so it runs once per page load,
 * and its effect runs before the page's: React runs an earlier sibling's effects first.
 */
export function StoreMigration() {
  useEffect(() => {
    migrateStore();
  }, []);
  return null;
}

import type { Metadata } from 'next';
import { DraftView } from '@/components/draft/draft-view';

export const metadata: Metadata = { title: 'Your draft | Citation Equity' };

/** Your draft: the paper editor and the fix rail, on the store's active slot. */
export default function DraftPage() {
  return <DraftView />;
}

// What an older build stored, brought to this build's shapes once per page load (by
// components/shell/store-migration.tsx, before any page reads the store), so no screen shows a
// score or a pass count. The steps:
//
// (4) My post's question list, when it holds only heading questions and the store still holds an
//     older build's summary or a score baseline: that build saved its heading prefill as soon as
//     the draft opened, so the author never chose those questions. The key goes, and the page's
//     own questions are measured. Any other list is kept, since the author worked with it. A
//     heading list saved by this build (the author's click) is never touched: this build stores
//     no old summary and no baseline, and steps (1) to (3) remove them on the first run, so the
//     trace ends there.
// (1) An older build's draft summary (a score) is removed, then replaced by one computed from the
//     stored draft and questions (none when that draft is empty). Removed first, so a write that
//     fails (a full quota) still leaves no older shape for the next load to read. Runs after (4),
//     so it measures what the draft view will.
// (2) An older build's site summary (pass counts) is removed: the pasted page was never stored,
//     so it cannot be recomputed.
// (3) Every score baseline (`ce:v1:baseline:*`) is removed.
//
// Idempotent: a second run finds nothing to change. Subscribers hear of it once. With storage
// blocked it does nothing (nothing old can be there), and it never throws.

import { refreshDraftSummary } from './draft-summary';
import { MY_DRAFT_SLUG } from './samples';
import { forgetQuestions, loadQuestions } from './storage';
import { batch, clearSummary, getActiveSlot, hasStaleSummary } from './store';

const BASELINE_PREFIX = 'ce:v1:baseline:';

/** True while any score baseline is stored: only an older build wrote them. */
function hasBaselines(): boolean {
  try {
    const s = window.localStorage;
    for (let i = 0; i < s.length; i++) if (s.key(i)?.startsWith(BASELINE_PREFIX)) return true;
  } catch {
    // Storage unavailable: no baseline can be stored there.
  }
  return false;
}

/** My post's list as the older build saved it on open: heading questions only. */
function isHeadingPrefill(): boolean {
  const saved = loadQuestions(MY_DRAFT_SLUG);
  return saved !== null && saved.length > 0 && saved.every((q) => q.source === 'draft-heading');
}

function removeBaselines(): void {
  try {
    const s = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key?.startsWith(BASELINE_PREFIX)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  } catch {
    // Storage unavailable: no baseline can be stored there.
  }
}

/** Brings the stored values of an older build to this build's shapes; see the steps above. */
export function migrateStore(at: Date = new Date()): void {
  try {
    batch(() => {
      const oldDraft = hasStaleSummary('draft');
      const oldBuild = oldDraft || hasStaleSummary('site') || hasBaselines();
      if (oldBuild && isHeadingPrefill()) forgetQuestions(MY_DRAFT_SLUG);
      if (oldDraft) {
        clearSummary('draft');
        refreshDraftSummary(getActiveSlot(), at);
      }
      if (hasStaleSummary('site')) clearSummary('site');
      removeBaselines();
    });
  } catch {
    // A failed update must never stop the page; what is left reads as no summary.
  }
}

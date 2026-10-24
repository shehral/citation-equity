// Pure helpers of the E1 TypeScript steps (experiments/PREREG_E1.md): the GEO-bench query filter,
// Wayback snapshot URLs, fetch statuses and the engine-based applicability rules.
import type { EngineJson } from './engine_json';

/** Interrogative words that open a question (PREREG_E1 Data 2: "starts with a question word"). */
const QUESTION_WORD = /^(?:what|why|how|when|where|which|who|whom|whose)\b/i;
/** Phrases that mark a how-to or explanation request anywhere in the query. */
const REQUEST = /\b(?:how to|why|what is|explain|difference between)\b/i;

/**
 * Data 2: an informational, non-sensitive query that is a question (starts with a question word)
 * or a how-to or explanation request. Queries about named private individuals are dropped by id
 * in fetch_geobench.ts (PRIVATE_INDIVIDUAL_QUERY_IDS), since no rule can find them.
 */
export function keepQuery(query: string, tags: string[]): boolean {
  if (!tags.includes('informational') || tags.includes('sensitive')) return false;
  const q = query.trim();
  return QUESTION_WORD.test(q) || REQUEST.test(q);
}

/** A list as is, a string that parses as a JSON list parsed, anything else null. */
function listOf(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A GEO-bench row's tags; missing or malformed tags become an empty list (never kept). */
export function normalizeTags(raw: unknown): string[] {
  return (listOf(raw) ?? []).filter((t): t is string => typeof t === 'string');
}

/** A GEO-bench row's source URLs, or null when sources are missing or malformed (a bad row). */
export function normalizeSources(raw: unknown): string[] | null {
  const list = listOf(raw);
  if (!list) return null;
  const urls: string[] = [];
  for (const s of list) {
    const url = s !== null && typeof s === 'object' ? (s as { url?: unknown }).url : undefined;
    if (typeof url !== 'string') return null;
    urls.push(url);
  }
  return urls;
}

export interface GeoRow {
  query: string;
  tags: string[];
  urls: string[];
}

/**
 * One datasets-server row, normalized once where rows are read. Null is a bad row: no string
 * query or unusable sources. The `val` and `train` splits (config `train`) carry only query, dset
 * and sugg_idx, so every row there is a bad row.
 */
export function readGeoRow(row: unknown): GeoRow | null {
  if (row === null || typeof row !== 'object') return null;
  const r = row as { query?: unknown; tags?: unknown; sources?: unknown };
  const urls = normalizeSources(r.sources);
  if (typeof r.query !== 'string' || urls === null) return null;
  return { query: r.query, tags: normalizeTags(r.tags), urls };
}

/** The closest 2023 Wayback snapshot, raw HTML without the toolbar (Data 3). */
export const waybackUrl = (url: string): string => `https://web.archive.org/web/2023id_/${url}`;

/** The HTTP status a fetch ended with: 200 when the page was used, else read from the skip reason. */
export function statusOf(reason: string | null): number | null {
  if (reason === null) return 200;
  const m = /HTTP (\d{3})/.exec(reason);
  return m ? Number(m[1]) : null;
}

export const ENGINE_CHECK: Record<string, string> = {
  '1': 'standalone-paragraphs',
  '2': 'question-headings',
  '3': 'lists',
  '4': 'tables',
  '5': 'statistics',
  '6': 'expert-quotes',
  '7': 'cited-sources',
  '8': 'direct-answer-lead',
  '9': 'question-coverage',
  '10': 'comparisons',
};
export const DONOR_ARMS = new Set(['5', '6', '7']);
/** Arms run on the C-SEO replication set (ALL there is ALL-text, steps 8, 9, 5, 6, 7). */
export const REPLICATION_ARMS = new Set(['5', '6', '7', '9', '11', '12', '14']);
export const ALL_ORDER = ['3', '4', '2', '1', '8', '9', '10', '5', '6', '7'];
export const ALL_TEXT_ORDER = ['8', '9', '5', '6', '7'];
const OPENER = 'points back to earlier text';

export interface Applicability {
  applicable: boolean;
  reason: string | null;
}
export interface ApplicabilityRow extends Applicability {
  query_id: string;
  arm: string;
}

/**
 * Arms 1-10 (Applicability): not applicable when the check returns applicable = false or scores
 * 0.9 or more on the original, when it reports no span to edit, and (arms 5-7) when there is no
 * donor. Arm 4 also needs the check's own edit (a Key: value list it can turn into a table).
 */
export function engineArmApplicability(
  arm: string,
  eng: EngineJson,
  hasDonor: boolean,
): Applicability {
  const id = ENGINE_CHECK[arm];
  const c = id ? eng.checks[id] : undefined;
  const no = (reason: string): Applicability => ({ applicable: false, reason });
  if (!id || !c?.applicable) return no(`the ${id} check is not applicable`);
  if (c.score >= 0.9) return no(`the ${id} check scores ${c.score.toFixed(3)} (0.9 or more)`);
  if (DONOR_ARMS.has(arm) && !hasDonor) return no('no donor (four-page query)');
  if (arm === '4') {
    if (!c.suggestions.some((s) => s.kind === 'edit' && s.after !== undefined))
      return no('no Key: value list for the tables check to convert');
  } else if (arm === '1') {
    if (!c.findings.some((f) => f.message.includes(OPENER)))
      return no('no paragraph opens with a pointer to earlier text');
  } else if (c.findings.length === 0) {
    return no(`the ${id} check reports no span`);
  }
  return { applicable: true, reason: null };
}

/** The frozen applicability rows of one target: arms 1-14 and ALL. */
export function allApplicability(
  queryId: string,
  set: string,
  eng: EngineJson,
  hasDonor: boolean,
  features: { arm: string; applicable: boolean; reason: string | null }[],
): ApplicabilityRow[] {
  const rows: ApplicabilityRow[] = [];
  for (let n = 1; n <= 14; n++) {
    const arm = String(n);
    let a: Applicability;
    if (set === 'replication' && !REPLICATION_ARMS.has(arm)) {
      a = { applicable: false, reason: 'not run on the replication set' };
    } else if (n <= 10) {
      a = engineArmApplicability(arm, eng, hasDonor);
    } else {
      const f = features.find((x) => x.arm === arm);
      a = f
        ? { applicable: f.applicable, reason: f.reason }
        : { applicable: false, reason: 'no feature row' };
    }
    rows.push({ query_id: queryId, arm, ...a });
  }
  // ALL may use a step even where it is not run as a single arm (arm 8 on the replication set).
  const order = set === 'replication' ? ALL_TEXT_ORDER : ALL_ORDER;
  const any = order.some((arm) => engineArmApplicability(arm, eng, hasDonor).applicable);
  rows.push({
    query_id: queryId,
    arm: 'ALL',
    applicable: any,
    reason: any ? null : 'no applicable step',
  });
  return rows;
}

/**
 * Targets and applicable (query, arm) pairs per set. The timing-smoke query (PREREG_E1 r3
 * amendment 8) is a set of its own, so it never adds to the main set's counts.
 */
export function applicableCounts(targets: { set: string; rows: ApplicabilityRow[] }[]): {
  targets: Record<string, number>;
  applicable: Record<string, Record<string, number>>;
} {
  const counts: Record<string, number> = {};
  const applicable: Record<string, Record<string, number>> = {};
  for (const { set, rows } of targets) {
    counts[set] = (counts[set] ?? 0) + 1;
    const perArm = applicable[set] ?? {};
    applicable[set] = perArm;
    for (const r of rows) if (r.applicable) perArm[r.arm] = (perArm[r.arm] ?? 0) + 1;
  }
  return { targets: counts, applicable };
}

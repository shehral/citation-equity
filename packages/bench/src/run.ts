import { CAVEAT, REMOTE_CAVEAT } from './caveat';
import { meanInterval, pawcShares, signFlipP, wilson } from './metrics';
import { buildPrompt, parseAnswer } from './prompt';
import { retrieve } from './retrieve';
import { shuffle } from './rng';
import type {
  BenchDraft,
  BenchReport,
  BenchSettings,
  Comparison,
  EngineAdapter,
  Pack,
  PackDocument,
  ReportSettings,
  RunRecord,
} from './types';
import { DEFAULT_SETTINGS, DRAFT_DOC_ID } from './types';

/**
 * Merges `settings` over DEFAULT_SETTINGS and validates the result. Entries that are explicitly
 * `undefined` (an omitted CLI flag passed straight through) or null (a report's numCtx when its
 * adapter could not send one) are dropped first, so they fall back to the default instead.
 */
function resolveSettings(settings: Partial<ReportSettings> | undefined): BenchSettings {
  const given = Object.fromEntries(
    Object.entries(settings ?? {}).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<BenchSettings>;
  const s: BenchSettings = { ...DEFAULT_SETTINGS, ...given };
  if (!Number.isInteger(s.runs) || s.runs < 1) throw new RangeError('runs must be an integer >= 1');
  if (!Number.isInteger(s.k) || s.k < 1) throw new RangeError('k must be an integer >= 1');
  if (!Number.isSafeInteger(s.baseSeed)) throw new RangeError('baseSeed must be a safe integer');
  if (typeof s.temperature !== 'number' || !Number.isFinite(s.temperature) || s.temperature < 0) {
    throw new RangeError('temperature must be a finite number >= 0');
  }
  if (typeof s.model !== 'string' || s.model.trim() === '') {
    throw new TypeError('model must be a non-empty string');
  }
  if (!Number.isInteger(s.numCtx) || s.numCtx < 1) {
    throw new RangeError('numCtx must be an integer >= 1');
  }
  return s;
}

/**
 * Runs `draft` through every query of `pack`: insert the draft as a document, BM25 top-k, shuffle
 * the retrieved sources with the run's seed, ask the adapter for a cited answer, and score the draft.
 * Seeds are `baseSeed + 1000 * queryIndex + run`, so two drafts run on the same pack and settings
 * share their seeds (the pairing `compareReports` relies on). Generations run one at a time.
 * The report carries the adapter's caveat (CAVEAT when it names none). An adapter that cannot
 * send a context window (`sendsNumCtx: false`) gets no numCtx, and the report records it as null.
 */
export async function runBench(
  pack: Pack,
  draft: BenchDraft,
  adapter: EngineAdapter,
  settings?: Partial<ReportSettings>,
  onProgress?: (done: number, total: number) => void,
  now: () => string = () => new Date().toISOString(),
): Promise<BenchReport> {
  const s = resolveSettings(settings);
  const sendsNumCtx = adapter.sendsNumCtx !== false;
  const recorded: ReportSettings = { ...s, numCtx: sendsNumCtx ? s.numCtx : null };

  const draftDoc: PackDocument = {
    docId: DRAFT_DOC_ID,
    title: draft.title,
    text: draft.markdown,
    synthetic: false,
  };
  const total = pack.queries.length * s.runs;
  const records: RunRecord[] = [];

  for (const [queryIndex, q] of pack.queries.entries()) {
    const retrieved = retrieve([...q.documents, draftDoc], q.query, s.k);
    for (let run = 0; run < s.runs; run++) {
      const seed = s.baseSeed + 1000 * queryIndex + run;
      const order = shuffle(retrieved, seed);
      const answer = await adapter.generate(buildPrompt(q.query, order), {
        model: s.model,
        seed,
        temperature: s.temperature,
        ...(sendsNumCtx ? { numCtx: s.numCtx } : {}),
      });
      const parsed = parseAnswer(answer);
      const cited = new Set<string>();
      let validCitations = 0;
      for (const sentence of parsed.sentences) {
        for (const n of sentence.citations) {
          if (n >= 1 && n <= order.length) {
            cited.add(order[n - 1].docId);
            validCitations++;
          }
        }
      }
      const draftPos = order.findIndex((d) => d.docId === DRAFT_DOC_ID);
      records.push({
        queryId: q.queryId,
        run,
        seed,
        order: order.map((d) => d.docId),
        retrievedDocIds: retrieved.map((d) => d.docId),
        draftRetrieved: draftPos >= 0,
        answer,
        citedDocIds: [...cited],
        draftCited: cited.has(DRAFT_DOC_ID),
        draftPawc: draftPos >= 0 ? pawcShares(parsed, order.length)[draftPos] : 0,
        validCitations,
        formatFailure: validCitations === 0,
      });
      onProgress?.(records.length, total);
    }
  }

  const valid = records.filter((r) => !r.formatFailure);
  const perQueryPawc = [...groupByQuery(records).values()].map((rs) =>
    mean(rs.map((r) => r.draftPawc)),
  );
  const perQueryValidPawc = [...groupByQuery(valid).values()].map((rs) =>
    mean(rs.map((r) => r.draftPawc)),
  );
  return {
    schemaVersion: 2,
    packId: pack.packId,
    draftId: draft.id,
    adapter: adapter.name,
    createdAt: now(),
    settings: recorded,
    runs: records,
    summary: {
      retrieved: wilson(
        count(records, (r) => r.draftRetrieved),
        records.length,
      ),
      validRuns: valid.length,
      formatFailures: wilson(records.length - valid.length, records.length),
      citedAmongValid: wilson(
        count(valid, (r) => r.draftCited),
        valid.length,
      ),
      pawcAmongValid: { mean: mean(perQueryValidPawc), interval: meanInterval(perQueryValidPawc) },
      // A valid run cites at least one source, so it has at least one.
      chanceShare: mean(valid.map((r) => 1 / r.retrievedDocIds.length)),
      cited: wilson(
        count(records, (r) => r.draftCited),
        records.length,
      ),
      meanPawc: mean(perQueryPawc),
      pawcInterval: meanInterval(perQueryPawc),
    },
    caveat: adapter.caveat ?? CAVEAT,
  };
}

/**
 * Before/after deltas of two reports on the same pack and settings. Per query, the change in the
 * cited rate and in mean PAWC over valid runs (answers with a valid citation) feed a two-sided
 * sign-flip test; a query with no valid run on either side is left out of the test and listed in
 * `excludedQueries`. Throws if a report is not schemaVersion 2 or the reports are not paired.
 */
export function compareReports(before: BenchReport, after: BenchReport): Comparison {
  for (const report of [before, after]) {
    if (report.schemaVersion !== 2) {
      throw new Error(
        `Cannot compare schemaVersion ${String(report.schemaVersion)} reports: they predate the format-failure split. Re-run the bench to get schemaVersion 2 reports.`,
      );
    }
  }
  if (before.packId !== after.packId) {
    throw new Error(
      `Cannot compare reports from different packs: packId "${before.packId}" vs "${after.packId}"`,
    );
  }
  // numCtx is null on both sides for an adapter that cannot send it, which still pairs.
  const keys = Object.keys(DEFAULT_SETTINGS) as (keyof BenchSettings)[];
  const differing = keys.filter((key) => before.settings[key] !== after.settings[key]);
  if (differing.length > 0) {
    throw new Error(`Cannot compare reports run with different settings: ${differing.join(', ')}`);
  }
  const beforeQ = groupByQuery(before.runs);
  const afterQ = groupByQuery(after.runs);
  const ids = [...beforeQ.keys()];
  const afterIds = [...afterQ.keys()];
  if (ids.length !== afterIds.length || ids.some((id, i) => afterIds[i] !== id)) {
    throw new Error('Cannot compare reports over different queries: query ids differ');
  }

  const validOf = (rs: RunRecord[] | undefined) => (rs ?? []).filter((r) => !r.formatFailure);
  const paired = ids.map((id) => ({
    id,
    before: validOf(beforeQ.get(id)),
    after: validOf(afterQ.get(id)),
  }));
  const tested = paired.filter((q) => q.before.length > 0 && q.after.length > 0);
  const citedRate = (rs: RunRecord[]) => mean(rs.map((r) => (r.draftCited ? 1 : 0)));
  const meanPawc = (rs: RunRecord[]) => mean(rs.map((r) => r.draftPawc));
  const citedDiffs = tested.map((q) => citedRate(q.after) - citedRate(q.before));
  const pawcDiffs = tested.map((q) => meanPawc(q.after) - meanPawc(q.before));

  const b = before.summary;
  const a = after.summary;
  return {
    schemaVersion: 2,
    packId: before.packId,
    beforeId: before.draftId,
    afterId: after.draftId,
    delta: {
      retrieved: a.retrieved.p - b.retrieved.p,
      citedAmongValid: a.citedAmongValid.p - b.citedAmongValid.p,
      pawcAmongValid: a.pawcAmongValid.mean - b.pawcAmongValid.mean,
      formatFailures: a.formatFailures.p - b.formatFailures.p,
    },
    pValue: { citedAmongValid: signFlipP(citedDiffs), pawcAmongValid: signFlipP(pawcDiffs) },
    nQueries: tested.length,
    excludedQueries: paired.filter((q) => !tested.includes(q)).map((q) => q.id),
    // The reports' own caveat; if they disagree, the one that claims less.
    caveat: before.caveat === after.caveat ? before.caveat : REMOTE_CAVEAT,
  };
}

/** Records grouped by queryId, in first-seen order. */
function groupByQuery(records: RunRecord[]): Map<string, RunRecord[]> {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const group = groups.get(r.queryId);
    if (group) group.push(r);
    else groups.set(r.queryId, [r]);
  }
  return groups;
}

function count<T>(xs: T[], pred: (x: T) => boolean): number {
  return xs.reduce((n, x) => n + (pred(x) ? 1 : 0), 0);
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

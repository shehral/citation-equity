export interface PackDocument {
  docId: string;
  title: string;
  text: string;
  url?: string;
  synthetic: boolean;
}
export interface PackQuery {
  queryId: string;
  query: string;
  documents: PackDocument[];
}
export interface Pack {
  schemaVersion: 1;
  packId: string;
  title: string;
  source: string;
  license: string;
  synthetic: boolean;
  queries: PackQuery[];
}
export interface GenerateOptions {
  model: string;
  seed: number;
  temperature: number;
  /** Context window in tokens (Ollama's `num_ctx`); the server's default when omitted. */
  numCtx?: number;
}
export interface EngineAdapter {
  readonly name: string;
  /** The caveat reports made with this adapter carry; CAVEAT (a local model) when omitted. */
  readonly caveat?: string;
  /**
   * False when the adapter has no way to send `numCtx` to the server (OpenAI's Chat Completions
   * API has no such field): runBench then leaves it out of the call and records it as null.
   */
  readonly sendsNumCtx?: boolean;
  generate(prompt: string, opts: GenerateOptions): Promise<string>;
}
export interface BenchDraft {
  id: string;
  title: string;
  markdown: string;
}
export interface BenchSettings {
  k: number;
  runs: number;
  model: string;
  temperature: number;
  baseSeed: number;
  /** Context window per generation. Ollama's 4,096 default truncated the longest prompts. */
  numCtx: number;
}
/** Settings as a report records them: numCtx is null when the adapter could not send it. */
export type ReportSettings = Omit<BenchSettings, 'numCtx'> & { numCtx: number | null };
export const DEFAULT_SETTINGS: BenchSettings = {
  k: 8,
  runs: 8,
  model: 'llama3.2:3b',
  temperature: 0.5,
  baseSeed: 1,
  numCtx: 16384,
};
export interface RunRecord {
  queryId: string;
  run: number;
  seed: number;
  order: string[];
  retrievedDocIds: string[];
  draftRetrieved: boolean;
  answer: string;
  citedDocIds: string[];
  draftCited: boolean;
  draftPawc: number;
  /** [n] markers in the answer that point at one of its sources (duplicates counted). */
  validCitations: number;
  /** The answer has no valid [n] citation at all: a format failure, not a "not cited". */
  formatFailure: boolean;
}
export interface Rate {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}
/**
 * A mean over per-query means, with its 95% t interval (meanInterval). With fewer than two queries
 * there is no interval and `interval` is [mean, mean].
 */
export interface ShareStat {
  mean: number;
  interval: [number, number];
}
export interface BenchReport {
  schemaVersion: 2;
  packId: string;
  draftId: string;
  adapter: string;
  createdAt: string;
  settings: ReportSettings;
  runs: RunRecord[];
  summary: {
    retrieved: Rate;
    /** Runs whose answer has at least one valid citation. */
    validRuns: number;
    formatFailures: Rate;
    /** Draft cited, over valid runs only. */
    citedAmongValid: Rate;
    /** Draft's PAWC share: per-query means over valid runs, then their mean (queries with a valid run). */
    pawcAmongValid: ShareStat;
    /**
     * Mean over valid runs of 1 / retrievedDocIds.length: the share an even split would give each
     * source, so the draft's even-split share when it is retrieved. Valid runs without the draft
     * count 0 in pawcAmongValid but not here; compare the two with `retrieved` in view.
     */
    chanceShare: number;
    /** Kept for continuity with schemaVersion 1; computed over all runs, format failures included. */
    cited: Rate;
    meanPawc: number;
    pawcInterval: [number, number];
  };
  caveat: string;
}
export interface Comparison {
  schemaVersion: 2;
  packId: string;
  beforeId: string;
  afterId: string;
  delta: {
    retrieved: number;
    citedAmongValid: number;
    pawcAmongValid: number;
    formatFailures: number;
  };
  /** Two-sided sign-flip test over per-query means of valid runs. */
  pValue: { citedAmongValid: number; pawcAmongValid: number };
  /** Queries in the paired test. */
  nQueries: number;
  /** Queries left out of the test because one side had no valid run. */
  excludedQueries: string[];
  caveat: string;
}
export const DRAFT_DOC_ID = 'draft';

// ---------- live engines (`ce live`) ----------

/** One source a live engine returned with its answer. */
export interface LiveSource {
  /** The source link as the engine gave it, or where its redirect points once resolved. */
  uri: string;
  /** The engine's title for the source (Gemini gives the site's domain here). */
  title?: string;
  /** Lowercased host without a leading `www.`; '' when unknown. */
  domain: string;
}
export interface LiveAnswer {
  answer: string;
  sources: LiveSource[];
}
/** An engine that searches for its own sources, such as Gemini with Google Search grounding. */
export interface LiveEngine {
  readonly name: string;
  /** Recorded in the report; 'unspecified' when omitted. */
  readonly model?: string;
  ask(question: string, seed: number): Promise<LiveAnswer>;
}
export interface LiveRunRecord {
  question: string;
  /** 1-based; also the seed the engine was asked with. */
  run: number;
  answer: string;
  sources: LiveSource[];
  /**
   * A source's domain equals the target's (`www.` and the port ignored; subdomains do not count).
   * runLive refuses a target whose host has no domain, so '' never matches.
   */
  draftDomainCited: boolean;
  /** A source's URI equals the target URL (scheme, `www.`, trailing slash and fragment ignored). */
  draftUrlCited: boolean;
}
export interface LiveReport {
  schemaVersion: 1;
  engine: string;
  model: string;
  targetUrl: string;
  createdAt: string;
  runs: LiveRunRecord[];
  summary: {
    /** Runs whose sources include the target's domain, over all runs. */
    domainCited: Rate;
    /** Runs whose sources include the target URL, over all runs. */
    urlCited: Rate;
    nQuestions: number;
  };
  /**
   * Present only when the run stopped early on an engine error: `runs` and `summary` then cover
   * the calls that finished (`nQuestions` counts the questions asked at least once).
   */
  incomplete?: {
    /** Calls planned: questions x runs. */
    planned: number;
    /** The error that stopped the run. */
    error: string;
  };
  caveat: string;
}

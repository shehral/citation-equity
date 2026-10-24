import {
  groupByKind,
  hostOf,
  type SourceKind,
  tallyCitedSources,
  urlsFromText,
} from '@citation-equity/engine';
import type { CitedSummary } from '@/lib/store';

/** One question and the answer pasted for it. */
export interface CitedEntry {
  question: string;
  answer: string;
}

export interface CitedReport {
  /** Entries with a non-blank answer. */
  answers: number;
  /** The user's site as a host ('' when none, or not a host). */
  ownDomain: string;
  /** Answers that cite the user's site. */
  ownCitations: number;
  /** The other cited sites by kind, most cited kind first. */
  groups: ReturnType<typeof groupByKind>;
}

/**
 * Tallies pasted answers in the browser with the engine's off-page functions. An entry without
 * an answer counts as nothing; an answer without a question is labelled by its box number.
 */
export function citedReport(entries: CitedEntry[], own: string): CitedReport {
  const answers = entries
    .map((e, i) => ({ ...e, label: e.question.trim() || `Question ${i + 1}` }))
    .filter((e) => e.answer.trim() !== '')
    .map((e) => ({ question: e.label, urls: urlsFromText(e.answer) }));
  const ownDomain = hostOf(own);
  const { domains, ownCitations } = tallyCitedSources(answers, ownDomain || undefined);
  return { answers: answers.length, ownDomain, ownCitations, groups: groupByKind(domains) };
}

/** The summary the home tile reads (lib/store.ts). Results from this page are never examples. */
export function citedSummary(report: CitedReport, at: string): CitedSummary {
  return {
    answers: report.answers,
    citingYou: report.ownCitations,
    ...(report.ownDomain === '' ? {} : { site: report.ownDomain }),
    topKinds: report.groups.map((g): SourceKind => g.kind),
    example: false,
    at,
  };
}

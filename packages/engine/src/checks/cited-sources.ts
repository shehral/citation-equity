/*
 * Claim and source detection adapted from:
 * - geo-lint (https://github.com/IJONIS/geo-lint), src/utils/geo-analyzer.ts
 *   `countSourceCitations` (`CITATION_PHRASES`, http(s) Markdown links, footnote markers),
 *   npm @ijonis/geo-lint 0.2.1, MIT License, Copyright (c) 2026 IJONIS.
 * - aeo-linter (https://github.com/DrowLink/aeo-audit-linter),
 *   src/gather/gatherers/direct-answers-gatherer.ts citation-phrase pattern and
 *   src/audits/direct-answer-density/fact-citation-density.ts (statistics plus external
 *   sources), npm @drowlink/aeo-linter-core 0.3.0, MIT License,
 *   Copyright (c) AEO Linter Contributors.
 * Changes: instead of counting citation markers over the page, each sentence that gives a
 * statistic (see ./statistics) or makes a research claim must have a source in the same
 * sentence or paragraph; only absolute http(s) links and footnote references count as
 * sources; claim words are read from the prose mask, so code never counts; claim words are
 * research phrasing ("a study", "according to", "the survey found") or an attribution verb with
 * "that" ("Gartner reported that"), not a bare "found" or "report" or the author's own "I found
 * that"; a figure in an instruction ("Use 18 g of coffee") or a `Key: value` list item
 * ("Weight: 2 kg") is not a claim on its own.
 */

import nlp from 'compromise/two';
import { unscoredNote } from '../e1';
import { EVIDENCE } from '../evidence';
import type { Artifacts, Paragraph } from '../gather';
import type { CheckResult } from '../types';
import { suggester } from './data-support';
import { findStatistics } from './statistics';
import { splitKeyValue } from './tables';
import { type CheckFn, notApplicable } from './types';

/**
 * Research phrasing: a study, research or a survey, "according to", or a report, data or
 * analysis that found or shows something. "I found that" and "the report button" are not.
 */
const CLAIM =
  /\b(?:stud(?:y|ies)|research(?:ers?)?|surveys?|according\s+to|(?:reports?|data|analys[ie]s|surveys?|researchers?|experiments?|tests?)\s+(?:found|finds|shows?|showed|shown|suggests?|suggested))\b/i;
/**
 * An attribution verb with "that": someone reports a finding ("Gartner reported that",
 * "A Google paper found that", "teams report that").
 */
const ATTRIBUTION =
  /\b(?:reports?|reported|found|finds?|shows?|showed|suggests?|suggested|concludes?|concluded|estimates?|estimated|reveals?|revealed)\s+that\b/gi;
/**
 * Subjects that make an attribution the author's own remark, not a claim to source: "I found
 * that", "You may find that", "This shows that". Checked in the two words before the verb.
 */
const OWN_REMARK = new Set(['i', 'we', 'you', 'it', 'this', 'that', 'which', 'what']);

/** True when the sentence attributes a finding to someone other than the author or reader. */
function attributes(plain: string): boolean {
  for (const m of plain.matchAll(ATTRIBUTION)) {
    const before = (
      plain
        .slice(0, m.index)
        .toLowerCase()
        .replace(/’/g, "'")
        .match(/[\p{L}']+/gu) ?? []
    )
      .slice(-2)
      .map((w) => w.split("'")[0] ?? '');
    if (!before.some((w) => OWN_REMARK.has(w))) return true;
  }
  return false;
}

/** Openers that can precede an imperative verb ("Then pour 36 g"). */
const INSTRUCTION_ADVERB = /^(?:then|now|next|first|always|never|just|simply|finally)$/i;
const EXTERNAL_URL = /^(?:https?:)?\/\//i;
const FOOTNOTE = /\[\^[^\]\s]+\](?!:)/g;
const MAX_SUGGESTIONS = 5;

/**
 * True when a sentence is an instruction ("Use 18 g of coffee", "Then pour 36 g"): its first
 * verb is an imperative (compromise part-of-speech tags). Its figures are directions, not claims.
 */
function isInstruction(plain: string): boolean {
  const terms =
    (nlp(plain.trim()).json() as { terms: { text: string; tags: string[] }[] }[])[0]?.terms ?? [];
  const [first, second] = terms;
  if (first?.tags.includes('Imperative')) return true;
  return (
    first !== undefined &&
    INSTRUCTION_ADVERB.test(first.text) &&
    (second?.tags.includes('Infinitive') ?? false)
  );
}

/** True when the paragraph holds an absolute link or a footnote reference. */
function hasSource(a: Artifacts, p: Paragraph): boolean {
  const inside = (start: number) => start >= p.range.start && start < p.range.end;
  if (a.links.some((l) => inside(l.range.start) && EXTERNAL_URL.test(l.url))) return true;
  // A footnote reference is masked out of `plain`; inline code holding `[^1]` is masked too,
  // so tell them apart by the raw text: only a real reference starts outside code spans.
  for (const m of p.text.matchAll(FOOTNOTE)) {
    const before = p.text.slice(0, m.index);
    if ((before.match(/`/g)?.length ?? 0) % 2 === 0) return true;
  }
  return false;
}

export const check: CheckFn = (a: Artifacts): CheckResult => {
  const claims: { sentence: Paragraph['sentences'][number]; sourced: boolean }[] = [];
  for (const p of a.paragraphs) {
    // A footnote definition (`[^1]: Source.`, on one line or on continuation lines) is a source.
    if (p.inFootnote) continue;
    // A spec line in a list ("Weight: 2 kg") states a value; only research phrasing makes it a claim.
    const specItem = p.inListItem && splitKeyValue(p.text) !== null;
    let sourced: boolean | undefined;
    for (const sentence of p.sentences) {
      const claim =
        CLAIM.test(sentence.plain) ||
        attributes(sentence.plain) ||
        (!specItem && findStatistics(sentence.plain).length > 0 && !isInstruction(sentence.plain));
      if (!claim) continue;
      sourced ??= hasSource(a, p);
      claims.push({ sentence, sourced });
    }
  }
  if (claims.length === 0) return notApplicable('cited-sources');

  const unsourced = claims.filter((c) => !c.sourced);
  const result: CheckResult = {
    checkId: 'cited-sources',
    applicable: true,
    score: (claims.length - unsourced.length) / claims.length,
    findings: [],
    suggestions: [],
    metrics: {
      claims: claims.length,
      sourced: claims.length - unsourced.length,
      unsourced: unsourced.length,
    },
  };
  const build = suggester('cited-sources');
  const message = 'This sentence gives a figure or a research claim with no source next to it.';
  for (const [i, { sentence }] of unsourced.entries()) {
    result.findings.push({ checkId: 'cited-sources', range: sentence.range, message });
    if (i >= MAX_SUGGESTIONS) continue;
    result.suggestions.push(
      build({
        kind: 'advisory',
        range: sentence.range,
        before: sentence.text,
        title: 'Link the source of this claim',
        rationale: `${message} Link the study, report or dataset it comes from in the same sentence or paragraph, so a reader can check it. Link only a real source that supports this exact claim; internal (relative) links do not count. If you cannot find one, reword or drop the claim. In the larger studies, adding references for their own sake did not raise citation rank (C-SEO Bench). Evidence grade: ${EVIDENCE['cited-sources'].grade}. ${unscoredNote(EVIDENCE['cited-sources'].e1)}`,
      }),
    );
  }
  return result;
};

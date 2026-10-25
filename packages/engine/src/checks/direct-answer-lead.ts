// Adapted from geo-lint (https://github.com/IJONIS/geo-lint),
// src/utils/geo-analyzer.ts (analyzeLeadSentences, WEAK_LEAD_STARTS), v0.2.1,
// commit b2d79319d1d0d4d4fc5d6abbc4ce5156afc5d14b, MIT License, Copyright (c)
// 2026 IJONIS. Kept: each H2/H3 section's first sentence must not be a
// question or open with filler, empty sections are skipped, and the English
// weak-lead phrases. Changed: "it depends" added, a word window of 8 to 40
// (in place of a 20-character floor), sections and sentences from the
// gathered artifacts instead of regex splits, the section's first prose
// paragraph is judged even when a list, table or quote comes before it (a
// section with no prose paragraph at all fails), and a per-section advisory.

import { unscoredNote } from '../e1';
import { EVIDENCE } from '../evidence';
import type { Paragraph } from '../gather';
import { countWords } from '../text';
import type { Range } from '../types';
import { isProse, issueCollector, words } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const MIN_WORDS = 8;
const MAX_WORDS = 40;

/** Openings that put off the answer. */
const HEDGES = [
  'it depends',
  'there are many',
  'in this article',
  'there are several',
  'there are a number of',
  'in this section',
  'in this post',
  'in this guide',
  'in the following',
  'this article',
  'this section',
  'this post',
  'this guide',
  'the following',
  'as we discussed',
  'as mentioned',
  'as noted',
  'it is important to',
  'it should be noted',
  'it is worth noting',
  'we will discuss',
  'we will explore',
  "let's",
];
const HEDGE = new RegExp(String.raw`^(?:${HEDGES.join('|')})(?![\p{L}\p{N}])`, 'iu');
const LEADING_PUNCTUATION = /^[\s"'“‘(]+/u;

const TITLE = 'Lead this section with a direct answer';
/** Direct answer first is an unscored note (E3 found no effect larger than δ); its suggestions say so. */
const RATIONALE = `Readers and answer engines often take the first sentence under a heading as its answer. One plain sentence of 8 to 40 words that answers the heading, before any detail, gives them that. ${unscoredNote(EVIDENCE['direct-answer-lead'].e1)}`;

export const check: CheckFn = (a) => {
  const out = issueCollector('direct-answer-lead', a.markdown);
  let sections = 0;
  let directLeads = 0;

  for (const [index, section] of a.sections.entries()) {
    const heading = section.headingIndex === null ? undefined : a.headings[section.headingIndex];
    if (!heading) continue;

    // The section's first prose paragraph answers the heading, even after a list, table or
    // quote (the brief judges the first paragraph). Image-only paragraphs are skipped.
    const paragraphs = section.paragraphIndices
      .map((i) => a.paragraphs[i])
      .filter((p): p is Paragraph => p !== undefined && countWords(p.plain) > 0);
    const first = paragraphs.find(isProse);
    // Without one, the section's first other block, in source order.
    const others: { start: number; kind: 'list' | 'table' | 'quote' }[] = [];
    for (const p of paragraphs)
      if (p.inBlockquote && !p.inListItem) others.push({ start: p.range.start, kind: 'quote' });
    for (const l of a.lists)
      if (l.sectionIndex === index) others.push({ start: l.range.start, kind: 'list' });
    for (const t of a.tables)
      if (t.sectionIndex === index) others.push({ start: t.range.start, kind: 'table' });
    const other = others.sort((x, y) => x.start - y.start)[0];
    if (!first && !other) continue;
    sections++;

    let range: Range = heading.range;
    let message: string;
    if (first) {
      range = first.range;
      const sentence = first.sentences[0];
      const plain = sentence?.plain.replace(LEADING_PUNCTUATION, '').replace(/’/g, "'") ?? '';
      const n = countWords(plain);
      const hedge = HEDGE.exec(plain)?.[0];
      if (hedge) {
        message = `The section opens with "${hedge}", which puts off the answer.`;
      } else if (plain.trimEnd().endsWith('?')) {
        message = 'The section opens with a question instead of answering one.';
      } else if (n < MIN_WORDS || n > MAX_WORDS) {
        message = `The first sentence has ${words(n)}; a direct answer runs ${MIN_WORDS} to ${MAX_WORDS}.`;
      } else {
        directLeads++;
        continue;
      }
    } else {
      message = `The section has a ${other?.kind ?? 'list'} but no sentence that answers the heading.`;
    }
    out.add({ range, message, title: TITLE, rationale: RATIONALE });
  }

  if (sections === 0) return notApplicable('direct-answer-lead');
  return {
    checkId: 'direct-answer-lead',
    applicable: true,
    score: directLeads / sections,
    findings: out.findings,
    suggestions: out.suggestions,
    metrics: { sections, directLeads },
  };
};

import type { CheckId } from '../types';
import { check as citedSources } from './cited-sources';
import { check as comparisons } from './comparisons';
import { check as directAnswerLead } from './direct-answer-lead';
import { check as expertQuotes } from './expert-quotes';
import { check as lists } from './lists';
import { check as questionCoverage } from './question-coverage';
import { check as questionHeadings } from './question-headings';
import { check as standaloneParagraphs } from './standalone-paragraphs';
import { check as statistics } from './statistics';
import { check as tables } from './tables';
import type { CheckFn } from './types';

/** Every check function, keyed in CHECK_IDS order. */
export const CHECKS: Record<CheckId, CheckFn> = {
  'standalone-paragraphs': standaloneParagraphs,
  'question-headings': questionHeadings,
  lists,
  statistics,
  tables,
  'expert-quotes': expertQuotes,
  'cited-sources': citedSources,
  'direct-answer-lead': directAnswerLead,
  'question-coverage': questionCoverage,
  comparisons,
};

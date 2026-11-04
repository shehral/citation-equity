// A draft as the draft view opens it, for every view that reads a draft it has not opened (the
// home's ticks and step card, Results, the migration): its saved text and questions, else the
// example's own (none for My post). One place, so the ticks, the card and the draft view never
// disagree on what a draft holds.

import { gather, parseDraft } from '@citation-equity/engine';
import { initialQuestions, type WorkspaceQuestion } from './questions';
import { sampleFor, startingText } from './samples';
import { loadDraft, loadQuestions } from './storage';

/** The draft's saved text, else its starting text (the example's before draft, or empty). */
export const draftTextFor = (key: string): string => loadDraft(key) ?? startingText(key);

/** The draft's saved questions (an empty list is a saved choice), else its starting ones. */
export const draftQuestionsFor = (key: string): WorkspaceQuestion[] =>
  loadQuestions(key) ?? initialQuestions(sampleFor(key));

/**
 * True when a draft has nothing to measure: blank, or no words outside code, front matter and
 * HTML (the engine counts none there). The draft card then has no summary, and Results asks for
 * a draft.
 */
export const isEmptyDraft = (text: string): boolean =>
  text.trim() === '' || gather(parseDraft(text)).wordCount === 0;

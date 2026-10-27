import nlp from 'compromise/two';
import {
  isRelativeClauseHeading,
  readsAsQuestion,
  startsWithInterrogative,
} from './checks/question-headings';
import { type Artifacts, gather } from './gather';
import { parseDraft } from './parse';

/** Where a target question came from. */
export type QuestionSource =
  | 'draft-heading'
  | 'template'
  | 'local-model'
  | 'search-console'
  | 'bing-ai'
  | 'keywords'
  | 'user';
export interface TargetQuestion {
  text: string;
  source: QuestionSource;
}

/**
 * Where in the draft a generated question comes from: the title (an H1 that reads as a
 * question), an H2/H3 subheading (as written, or rewritten by a template), or the page's topic
 * ("What is <topic>?", "How does <topic> work?"). Title and topic questions are about the page
 * as a whole; subheading questions are about one section.
 */
export type QuestionOrigin = 'title' | 'subheading' | 'topic';
export interface GeneratedQuestion extends TargetQuestion {
  origin: QuestionOrigin;
}

const DEFAULT_MAX = 8;

/** The H1 (or '') and the first prose paragraph (or ''), the only text the generators read. */
export function questionContext(markdown: string): { title: string; intro: string } {
  return contextOf(gather(parseDraft(markdown)));
}

function contextOf(a: Artifacts): { title: string; intro: string } {
  const title = a.headings.find((h) => h.depth === 1)?.text.trim() ?? '';
  const first = a.paragraphs.find((p) => !p.inListItem && !p.inBlockquote && !p.inFootnote);
  return { title, intro: first ? first.plain.replace(/\s+/g, ' ').trim() : '' };
}

/**
 * The draft's prose, read only for how it capitalises a word (a name written "a Chemex"
 * mid-sentence keeps its capital in a question); never a source of questions.
 */
const proseOf = (a: Artifacts): string =>
  a.paragraphs
    .filter((p) => !p.inFootnote)
    .map((p) => p.plain)
    .join('\n');

/** "Does grind size matter" -> "Does grind size matter?": first letter up, one "?" at the end. */
export function asQuestion(text: string): string {
  const t = text.trim().replace(/[\s.:;,!?]+$/u, '');
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}?`;
}

/** Strips the closing punctuation a declarative heading may carry ("Benefits of X:"). */
const bare = (text: string): string => text.trim().replace(/[\s.:;,!]+$/u, '');

/**
 * Template rewrites of a declarative heading, or null when no template fits. `lower` puts a
 * Title Case word in the case the draft writes it ("How to Make Cold Brew" -> "How do you
 * make cold brew?"). A heading that opens with a question word never becomes "X or Y: which is
 * better?", and "Why it matters" (a subject after the question word) is not a question.
 */
function fromTemplate(heading: string, lower: (text: string) => string): string | null {
  const h = bare(heading);
  let m = /^how to\s+(.+)$/i.exec(h);
  if (m) return `How do you ${lower(m[1])}?`;
  m = /^(?:the\s+)?benefits of\s+(.+)$/i.exec(h);
  if (m) return `What are the benefits of ${lower(m[1])}?`;
  m = /^why\s+(.+)$/i.exec(h);
  if (m) return isRelativeClauseHeading(h) ? null : `Why ${lower(m[1])}?`;
  if (startsWithInterrogative(h)) return null;
  m = /^(.+?)\s+(?:vs\.?|versus|or)\s+(.+)$/i.exec(h);
  if (m) return `${m[1]} or ${lower(m[2])}: which is better?`;
  return null;
}

// ---------- topic ----------

interface Term {
  text: string;
  /** Punctuation and spaces after the term; a comma or colon ends a noun phrase. */
  post: string;
  tags: string[];
  /** Offsets of `text` in the tagged string. */
  start: number;
  end: number;
}
interface CompromiseTerm {
  text: string;
  post: string;
  tags: string[];
  offset: { start: number; length: number };
}
interface Phrase {
  /** The tagged string the terms index into. */
  source: string;
  terms: Term[];
}

/** Words that name the kind of page, not its topic ("guide", "primer", "explained"). */
const GENERIC = new Set(
  (
    'guide guides primer overview introduction intro tutorial basics tips explainer handbook ' +
    'post article ultimate complete beginner beginners quick'
  ).split(' '),
);

function tagTerms(text: string): Term[] {
  const sentences = nlp(text).json({ offset: true }) as { terms: CompromiseTerm[] }[];
  return sentences.flatMap((s) =>
    s.terms.map((t) => ({
      text: t.text,
      post: t.post,
      tags: t.tags,
      start: t.offset.start,
      end: t.offset.start + t.offset.length,
    })),
  );
}

/**
 * Tags a title. compromise reads every capitalised word of a Title Case title as a proper noun
 * ("How I Built a Sourdough Starter" tags "Built" a noun), so a capitalised word takes the tags
 * it gets in the lowercased title when those say it is not a noun ("built" is a verb).
 */
function tagTitle(title: string): Term[] {
  const terms = tagTerms(title);
  const lowered = title.toLowerCase();
  if (lowered.length !== title.length) return terms;
  const byStart = new Map(tagTerms(lowered).map((t) => [t.start, t]));
  return terms.map((t) => {
    const lower = byStart.get(t.start);
    if (!lower || !t.tags.includes('ProperNoun') || !/^\p{Lu}/u.test(t.text)) return t;
    return lower.tags.includes('Noun') ? t : { ...t, tags: lower.tags };
  });
}

const isNoun = (t: Term) =>
  t.tags.includes('Noun') && !t.tags.includes('Pronoun') && !t.tags.includes('Possessive');
const inPhrase = (t: Term) =>
  isNoun(t) || (t.tags.includes('Adjective') && !t.tags.includes('Determiner'));
const isGeneric = (t: Term) => GENERIC.has(t.text.toLowerCase());

/** Drops leading terms that fail `keep`, then trailing ones that fail it or are not nouns. */
function trim(terms: Term[], keep: (t: Term) => boolean): Term[] {
  let from = 0;
  let to = terms.length;
  while (from < to && !keep(terms[from])) from++;
  while (to > from && (!keep(terms[to - 1]) || !isNoun(terms[to - 1]))) to--;
  return terms.slice(from, to);
}

/** Runs of nouns and adjectives that end in a noun, minus page-kind words at either end. */
function nounPhrases(source: string, tag: (text: string) => Term[] = tagTerms): Phrase[] {
  const phrases: Phrase[] = [];
  let run: Term[] = [];
  const close = () => {
    const terms = trim(run, (t) => !isGeneric(t));
    if (terms.length > 0) phrases.push({ source, terms });
    run = [];
  };
  for (const t of tag(source)) {
    if (inPhrase(t)) {
      run.push(t);
      if (/[,:;.?!()]/.test(t.post)) close();
    } else close();
  }
  close();
  return phrases;
}

/** Superlatives make a ranking query, not a definition: "What is best espresso grinder?" */
const RANKING = new Set(['best', 'worst', 'top']);

/**
 * Whether `text` is a single noun phrase: nouns and adjectives with no break between them,
 * ending in a noun ("espresso grind size", "cold brew"). Returns whether its last noun is
 * plural, or null when it is not one ("espresso vs drip", "best grinder", "grind finer").
 */
export function singleNounPhrase(text: string): { plural: boolean } | null {
  const terms = tagTerms(text.replace(/\s+/g, ' ').trim());
  const last = terms[terms.length - 1];
  if (!last || !isNoun(last)) return null;
  for (const [i, t] of terms.entries()) {
    if (!inPhrase(t) || t.tags.includes('Superlative') || RANKING.has(t.text.toLowerCase())) {
      return null;
    }
    if (i < terms.length - 1 && /[,:;.?!()]/.test(t.post)) return null;
  }
  return { plural: last.tags.includes('Plural') };
}

const lowerWords = (text: string): Set<string> =>
  new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The main topic of the page: the H1 noun phrase that shares the most words with the first
 * paragraph (the first on a tie), cut to the words the paragraph also uses when it shares any;
 * else the first noun phrase of the first paragraph. A word is lowercased when the title,
 * headings or paragraph also write it in lowercase, so a sentence-initial "Cold" becomes
 * "cold" while "Kubernetes" keeps its capital; a Title Case title is read in lowercase unless
 * a word is a proper noun. Null when no topic question would read naturally (see articleOf).
 */
function topicOf(title: string, intro: string, headings: string[], prose: string): Topic | null {
  const introWords = lowerWords(intro);
  const inIntro = (t: Term) => introWords.has(t.text.toLowerCase());
  let best: Phrase | undefined;
  let bestScore = 0;
  for (const phrase of nounPhrases(title, tagTitle)) {
    const score = phrase.terms.filter(inIntro).length;
    if (best === undefined || score > bestScore) {
      best = phrase;
      bestScore = score;
    }
  }
  if (best && bestScore > 0) {
    const shared = trim(best.terms, inIntro);
    if (shared.length > 0) best = { source: best.source, terms: shared };
  }
  best ??= nounPhrases(intro)[0];
  if (!best) return null;

  const written = [title, intro, ...headings].join('\n');
  const { source, terms } = best;
  const text = caseAsWritten(
    source.slice(terms[0].start, terms[terms.length - 1].end),
    written,
    source === title && isTitleCase(title),
    prose,
  );
  const last = terms[terms.length - 1];
  const plural = last.tags.includes('Plural') && text.endsWith(last.text.toLowerCase());
  const article = plural ? '' : articleOf(text, written);
  if (article === null) return null;
  const named = terms.some((t) => t.tags.some((tag) => NOT_A_MECHANISM.has(tag)));
  return { text: article === '' ? text : `${article} ${text}`, plural, mechanism: !named };
}

interface Topic {
  /** The topic as it goes into a question, with "a" or "an" when the draft uses one. */
  text: string;
  plural: boolean;
  /** False for a place, person, organisation or time: "How does Lisbon work?" makes no sense. */
  mechanism: boolean;
}

/** Tags of a topic that names something with no workings to ask about. */
const NOT_A_MECHANISM = new Set(['Place', 'Person', 'Organization', 'Date', 'Duration']);

/** Words after which a noun phrase stands bare ("in Lisbon", "with cold brew"). */
const BARE_BEFORE = new Set(
  (
    'in on of with for about to from at by into over under without through and or than like ' +
    'is are was were be use using make making try'
  ).split(' '),
);

/**
 * The article a singular topic takes, from how the title, headings and first paragraph write
 * it: "a" or "an" when they write "a road bike"; "" when they write it bare, at the start of a
 * sentence or after a preposition ("Cold brew is", "in Lisbon"); "the" when they write it only
 * after "the" ("The French press makes"); null when they write it only after another
 * determiner ("This paragraph"), so no topic question reads naturally.
 */
function articleOf(topic: string, written: string): 'a' | 'an' | 'the' | '' | null {
  const lower = written.toLowerCase();
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(topic.toLowerCase())}(?![\\p{L}\\p{N}])`,
    'gu',
  );
  let bare = false;
  let definite = false;
  for (const m of lower.matchAll(re)) {
    // "A Kubernetes guide": the topic modifies a noun after it, so the article is not its own.
    const lineStart = lower.lastIndexOf('\n', m.index) + 1;
    const lineEnd = lower.indexOf('\n', m.index);
    const line = lower.slice(lineStart, lineEnd < 0 ? undefined : lineEnd);
    const after = m.index - lineStart + m[0].length;
    const next = tagTerms(line).find((t) => t.start >= after);
    if (next && next.start - after <= 1 && isNoun(next)) continue;
    const prev = /([\p{L}\p{N}]+)[^\S\n]+$/u.exec(lower.slice(0, m.index))?.[1];
    if (prev === 'a' || prev === 'an') return prev;
    if (prev === undefined || BARE_BEFORE.has(prev)) bare = true;
    if (prev === 'the') definite = true;
  }
  if (bare) return '';
  return definite ? 'the' : null;
}

/** True when `prose` writes `word`, capitalised as given, after another word of a sentence. */
function writtenMidSentence(word: string, prose: string): boolean {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'gu');
  for (const m of prose.matchAll(re)) {
    if (/[\p{L}\p{N},;)'"’”][^\S\n]+$/u.test(prose.slice(0, m.index))) return true;
  }
  return false;
}

/**
 * `text` with each capitalised word put in the case the draft writes it. A word the prose
 * capitalises mid-sentence ("Visual Studio Code is", "a Chemex") is a name and keeps its
 * capital; otherwise it is lowercased when `written` also writes it in lowercase. With
 * `titleCase` (the text comes from a Title Case heading), any other capitalised word is
 * lowercased too, unless it is an acronym, compromise reads it as a proper noun in lowercase
 * ("lisbon", "steve"), or it stands next to such a name ("Steve Jobs", "Google Analytics").
 */
function caseAsWritten(text: string, written: string, titleCase = false, prose = ''): string {
  type Case = 'keep' | 'name' | 'lower' | 'title';
  const words = [...text.matchAll(/\p{L}[\p{L}\p{N}'’]*/gu)];
  const cases: Case[] = words.map(([word]) => {
    const lower = word.toLowerCase();
    if (word === lower) return 'keep';
    if (writtenMidSentence(word, prose)) return 'name';
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(lower)}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(written)) return 'lower';
    if (!titleCase || word === word.toUpperCase()) return 'keep';
    return tagTerms(lower)[0]?.tags.includes('ProperNoun') ? 'name' : 'title';
  });
  /** True when words i and j are neighbours (only spaces between) and j is a name. */
  const nextToName = (i: number, j: number): boolean => {
    const [a, b] = i < j ? [words[i], words[j]] : [words[j], words[i]];
    if (cases[j] !== 'name' || a === undefined || b === undefined) return false;
    return /^\s+$/u.test(text.slice((a.index ?? 0) + a[0].length, b.index));
  };
  let out = '';
  let at = 0;
  for (const [i, m] of words.entries()) {
    const word = m[0];
    const lowered =
      cases[i] === 'lower' ||
      (cases[i] === 'title' && !nextToName(i, i - 1) && !nextToName(i, i + 1));
    out += text.slice(at, m.index) + (lowered ? word.toLowerCase() : word);
    at = (m.index ?? 0) + word.length;
  }
  return out + text.slice(at);
}

/** True for a Title Case heading: most words of four or more letters are capitalised. */
function isTitleCase(heading: string): boolean {
  const long = heading.match(/\p{L}{4,}/gu) ?? [];
  const capitalised = long.filter((w) => /^\p{Lu}/u.test(w)).length;
  return long.length >= 2 && capitalised * 2 > long.length;
}

// ---------- generator ----------

/**
 * Target questions for a draft, from its title, headings and first paragraph only (never the
 * body, which would make every question look answered). In order, deduplicated ignoring case:
 * (1) the H1 when it is a question; (2) H2/H3 headings already phrased as questions;
 * (3) template rewrites of declarative H2/H3 headings ("How to X" -> "How do you X?",
 * "Benefits of X" -> "What are the benefits of X?", "X vs Y" / "X or Y" -> "X or Y: which is
 * better?" unless it opens with a question word, "Why X" -> "Why X?" unless a subject follows
 * "why"); (4) "What is <topic>?" and "How does <topic> work?" for the main noun phrase of the
 * H1 and first paragraph, with the article the draft gives it ("a road bike", "the French
 * press"), dropped when the draft only writes it after another determiner ("This paragraph"); "How does ... work?"
 * is skipped for a place, person, organisation or time ("Lisbon"). At most `max` (default 8).
 * Template questions are suggestions: callers score them only once the author accepts them.
 */
export function generateQuestions(markdown: string, opts: { max?: number } = {}): TargetQuestion[] {
  const max = opts.max ?? DEFAULT_MAX;
  return dedupe(candidates(gather(parseDraft(markdown))))
    .slice(0, Math.max(0, max))
    .map(({ text, source }) => ({ text, source }));
}

/**
 * The page-level questions of a draft, with their origin: the title's question (when the H1
 * reads as one), then the topic questions, deduplicated ignoring case. Never a subheading's
 * question, so adding a section never changes them. The reader-words check measures these
 * when the author has no questions of their own.
 */
export function pageQuestions(markdown: string): GeneratedQuestion[] {
  return pageQuestionsOf(gather(parseDraft(markdown)));
}

/** `pageQuestions` for an already gathered draft. */
export function pageQuestionsOf(a: Artifacts): GeneratedQuestion[] {
  return dedupe(candidates(a).filter((q) => q.origin !== 'subheading'));
}

/** `questions` without repeats, ignoring case and spacing; the first one is kept. */
function dedupe(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  const seen = new Set<string>();
  return questions.filter((q) => {
    const key = q.text.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every generated question of a draft, in the order generateQuestions lists them. */
function candidates(a: Artifacts): GeneratedQuestion[] {
  const out: GeneratedQuestion[] = [];
  const { title, intro } = contextOf(a);
  if (title !== '' && readsAsQuestion(title))
    out.push({ text: asQuestion(title), source: 'draft-heading', origin: 'title' });
  const sub = a.headings.filter((h) => h.depth === 2 || h.depth === 3).map((h) => h.text);
  for (const h of sub)
    if (readsAsQuestion(h))
      out.push({ text: asQuestion(h), source: 'draft-heading', origin: 'subheading' });
  const written = [title, intro, ...sub].join('\n');
  const prose = proseOf(a);
  for (const h of sub) {
    if (readsAsQuestion(h)) continue;
    const q = fromTemplate(h, (text) => caseAsWritten(text, written, isTitleCase(h), prose));
    if (q) out.push({ text: q, source: 'template', origin: 'subheading' });
  }
  const topic = topicOf(title, intro, sub, prose);
  if (topic) {
    const what = asQuestion(`${topic.plural ? 'What are' : 'What is'} ${topic.text}`);
    out.push({ text: what, source: 'template', origin: 'topic' });
    if (topic.mechanism) {
      const how = asQuestion(`How ${topic.plural ? 'do' : 'does'} ${topic.text} work`);
      out.push({ text: how, source: 'template', origin: 'topic' });
    }
  }
  return out;
}

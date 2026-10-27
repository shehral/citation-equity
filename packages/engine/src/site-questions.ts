// Questions for a whole site: the author's keywords (one per line, optionally with a search
// volume) or imported Search Console and Bing rows (import-queries.ts), turned into a ranked list
// of reader questions. Pure and browser-safe. The templates are conservative: a keyword becomes a
// question only when its pattern is unambiguous, and otherwise stays exactly as written (a
// keyword is a fine query for an AI engine). A question as written stays as it is. A template adds
// only its own few words, never a claim: "weight loss pills safe" asks "Are weight loss pills
// safe?", never "Why are ...".
import nlp from 'compromise/two';
import { readsAsQuestion, startsWithInterrogative } from './checks/question-headings';
import { countOf, csvRecords, isNumeric, normHeader } from './csv';
import { type ImportedQuery, questionKey } from './import-queries';
import { asQuestion } from './questions';

/** A keyword the author listed, with its search volume when given. */
export interface KeywordRow {
  text: string;
  volume?: number;
}

/** Where a site question came from: the keyword list, an export, or the local model. */
export type SiteQuestionSource = 'keywords' | 'search-console' | 'bing-ai' | 'local-model';

/** How a keyword became its question. */
export type SiteQuestionTemplate =
  | 'as-written'
  | 'what-is'
  | 'how-to'
  | 'how-it-works'
  | 'comparison'
  | 'best'
  | 'yes-no'
  | 'kept';

export interface SiteQuestion {
  text: string;
  /** The keyword or query it was made from, spacing tidied. */
  keyword: string;
  source: SiteQuestionSource;
  template: SiteQuestionTemplate;
  /** The keyword's search volume, or a Search Console query's impressions. */
  volume?: number;
  /** A Bing AI Performance query's citations. */
  citations?: number;
}

/** The most questions the list holds. */
export const SITE_QUESTIONS_MAX = 50;

/** A keyword of up to this many words may become "What are <keyword>?". */
const SHORT_WORDS = 3;

const KEYWORD_HEADERS = new Set([
  'keyword',
  'keywords',
  'query',
  'queries',
  'top queries',
  'search term',
  'search terms',
  'term',
  'terms',
]);
const VOLUME_HEADERS = new Set([
  'volume',
  'search volume',
  'searches',
  'monthly searches',
  'avg monthly searches',
  'avg monthly search volume',
  'impressions',
]);

const words = (list: string) => new Set(list.trim().split(/\s+/));

/** Words of a navigational or task keyword, which stays as written. */
const NAVIGATIONAL = words(`
  chart charts calculator login price prices pricing cost costs review reviews download pdf app
  template templates coupon coupons deal deals sale map hours menu number phone address signup
  website online free tutorial recipe recipes
`);

/** Words of a local keyword ("dentist near me"), which stays as written. */
const LOCAL = words('near nearby me open now delivery closest local');

/**
 * Words that name a service or a place of business ("houston plumber"): such a keyword is a
 * search for a provider, not a concept, so it stays as written.
 */
const SERVICE = words(`
  plumber plumbers dentist dentists lawyer lawyers attorney attorneys electrician electricians
  contractor contractors doctor doctors salon salons restaurant restaurants store stores shop
  shops hotel hotels clinic clinics service services company companies agency agencies mechanic
  mechanics realtor realtors roofer roofers locksmith vet vets pharmacy bank banks gym gyms
`);

/**
 * The verbs a keyword may open with to become "How to X?". Explicit and short on purpose: each
 * is rarely the first word of a noun compound, so "stock market crash", "tax deductions",
 * "clean eating" or "build quality" never become how-tos.
 */
export const HOW_TO_VERBS: ReadonlySet<string> = words(`
  make fix descale dial tamp choose install uninstall adjust calibrate froth remove replace
  measure reduce improve prevent avoid learn cook bake repair troubleshoot unclog backflush reuse
  recycle sharpen lose apply cancel calculate convert delete create invest save write become
`);

/**
 * Judgment words a keyword may end with ("weight loss pills safe"), which make it a yes-or-no
 * question ("Are weight loss pills safe?"). Never "Why ...", which would assert the judgment.
 */
const JUDGMENTS = [
  'worth it',
  'safe',
  'unsafe',
  'healthy',
  'unhealthy',
  'cheap',
  'expensive',
  'good',
  'bad',
  'legit',
  'legal',
  'illegal',
  'reliable',
  'effective',
  'dangerous',
  'toxic',
  'harmful',
  'necessary',
  'accurate',
];

/** Words that leave only a question stem ("how to", "what is"): such a keyword stays as written. */
const STEM = words('how to what why when where which who is are does do can should the a an');

/** Words that end in "s" but are singular. */
const SINGULAR_S = words(
  'news physics economics mathematics politics ethics series species kubernetes analytics gas bus lens chaos',
);

const unquote = (s: string) =>
  s
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/** "espresso shot time, 1900" or "espresso shot time<TAB>1,900": a keyword and its volume. */
const LINE = /^(.*?)\s*[,\t]\s*"?(\d{1,3}(?:,\d{3})+|\d+)"?\s*$/;

/**
 * The keyword list as rows: one keyword per line, with an optional search volume after a comma
 * or a tab ("espresso shot time, 1900"), blank lines and `#` lines skipped. A table with a
 * header row naming a keyword column ("Keyword", "Query", "Search term") and optionally a volume
 * column ("Volume", "Search volume", "Impressions"), as keyword tools export it, is read by
 * those columns.
 */
export function parseKeywordList(text: string): KeywordRow[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  if (lines.length === 0) return [];
  const table = fromTable(lines.join('\n'));
  if (table) return table;
  const out: KeywordRow[] = [];
  for (const line of lines) {
    const m = LINE.exec(line);
    const keyword = unquote(m ? m[1] : line.replace(/\t/g, ' '));
    if (keyword === '') continue;
    out.push(m ? { text: keyword, volume: countOf(m[2]) } : { text: keyword });
  }
  return out;
}

/** The rows of a keyword table, or null when the first row is not its header. */
function fromTable(text: string): KeywordRow[] | null {
  const [head, ...rows] = csvRecords(text);
  const names = (head ?? []).map(normHeader);
  const keywordAt = names.findIndex((n) => KEYWORD_HEADERS.has(n));
  if (keywordAt < 0) return null;
  const volumeAt = names.findIndex((n) => VOLUME_HEADERS.has(n));
  const out: KeywordRow[] = [];
  for (const r of rows) {
    const keyword = unquote(r[keywordAt] ?? '');
    if (keyword === '') continue;
    const raw = volumeAt >= 0 ? (r[volumeAt] ?? '').trim() : '';
    out.push(
      raw !== '' && isNumeric(raw) ? { text: keyword, volume: countOf(raw) } : { text: keyword },
    );
  }
  return out;
}

/** Lowercase "i" as a word becomes "I". */
const capitaliseI = (text: string): string =>
  text.replace(/(?<![\p{L}\p{N}'’])i(?=$|[\s'’?.!,])/gu, 'I');

/** compromise's tags for each word of `text`. */
const termTags = (text: string): string[][] =>
  (nlp(text).json() as { terms: { tags: string[] }[] }[]).flatMap((s) =>
    s.terms.map((t) => t.tags),
  );

/** Tags that mark a name: a place, a person, an organisation or a provider ("plumber"). */
const NAME_TAGS = ['Place', 'Person', 'Organization', 'ProperNoun', 'Actor'];

/**
 * True when the phrase's last word is plural: tagged plural after "the" ("the best practices"),
 * or an English plural ending the tagger misreads as a verb ("index funds", "mortgage rates").
 */
export function isPluralPhrase(phrase: string): boolean {
  const last = phrase.toLowerCase().split(/\s+/).at(-1) ?? '';
  if (SINGULAR_S.has(last)) return false;
  const tags = termTags(`the ${phrase}`).at(-1) ?? [];
  if (tags.includes('Plural')) return true;
  return /[^su']s$/.test(last) && last.length > 3;
}

/** True when a keyword is a local, navigational or service search, or names a place or a brand. */
function isNamedOrLocal(lower: string[], phrase: string): boolean {
  if (lower.some((w) => LOCAL.has(w) || NAVIGATIONAL.has(w) || SERVICE.has(w))) return true;
  return termTags(phrase).some((t) => NAME_TAGS.some((n) => t.includes(n)));
}

/**
 * A plural noun phrase of 2 or 3 words that reads as a concept ("espresso beans", "index
 * funds"): only nouns and adjectives, no name, place, service or local word. A singular one
 * ("credit score") would need an article this cannot choose reliably, so it stays as written.
 */
function pluralConcept(phrase: string, lower: string[]): boolean {
  if (lower.length < 2 || lower.length > SHORT_WORDS || !isPluralPhrase(phrase)) return false;
  // "weight watchers", "sneakers": a plural of people or a brand more often than a concept.
  if (/ers$/.test(lower[lower.length - 1] ?? '')) return false;
  if (isNamedOrLocal(lower, phrase) || HOW_TO_VERBS.has(lower[0] ?? '')) return false;
  const tags = termTags(`the ${phrase}`).slice(1);
  if (tags.length !== lower.length) return false;
  return tags.every(
    (t, i) =>
      (t.includes('Noun') ||
        t.includes('Adjective') ||
        (i === tags.length - 1 && t.includes('Verb'))) &&
      !t.includes('Pronoun') &&
      !t.includes('Gerund') &&
      !t.includes('Determiner') &&
      !t.includes('Preposition'),
  );
}

/**
 * The question a keyword becomes, and the template that made it, under conservative rules; any
 * keyword no rule fits stays exactly as written. In order:
 * - a keyword that is only a question stem ("how to") stays as written;
 * - "X vs Y" becomes "Which is better: X or Y?", each item as typed;
 * - a question as written (it ends in "?", or opens with a question word or an auxiliary) keeps
 *   its words, with a capital and one "?";
 * - "X safe", "X worth it" and other judgment words become a yes-or-no question ("Are weight
 *   loss pills safe?", "Is bitcoin legit?"), never "Why ..."; a singular thing of several words
 *   stays as written, as it would need an article;
 * - "best X" becomes "What is the best X?" or "What are the best X?" by the head noun
 *   ("best practices for react" -> "What are the best practices for react?"), a closing year
 *   reading "in 2026"; not "best of ...", a brand ("best buy") or a local search;
 * - "X explained" becomes "How does X work?" ("How do" for a plural);
 * - a keyword that opens with one of HOW_TO_VERBS becomes "How to X?";
 * - a plural noun phrase of 2 or 3 words that reads as a concept becomes "What are X?".
 * Local, navigational, service, place and brand keywords stay as written.
 */
export function keywordQuestion(keyword: string): { text: string; template: SiteQuestionTemplate } {
  const text = capitaliseI(keyword.replace(/\s+/g, ' ').trim());
  const kept = { text, template: 'kept' as const };
  const bare = text.replace(/[\s.:;,!?]+$/u, '');
  const lower = (bare.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) ?? []).map((w) =>
    w.replace(/’/g, "'"),
  );
  if (lower.length === 0 || lower.every((w) => STEM.has(w))) return kept;

  let m = /^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i.exec(bare);
  if (m && !startsWithInterrogative(m[1])) {
    const [a, b] = [m[1].trim(), m[2].trim()];
    if (/\b(?:vs\.?|versus)\b/i.test(b) || a === '' || b === '') return kept;
    return { text: `Which is better: ${a} or ${b}?`, template: 'comparison' };
  }

  if (readsAsQuestion(text) || startsWithInterrogative(text)) {
    return { text: asQuestion(text), template: 'as-written' };
  }
  if (/[,;:]/.test(bare)) return kept;

  for (const judgment of JUDGMENTS) {
    const re = new RegExp(
      `^(.+?)\\s+(${judgment})((?:\\s+(?:for|during|while|with|to|in|on|after|before)\\s+.+)?)$`,
      'i',
    );
    m = re.exec(bare);
    if (!m) continue;
    const subject = m[1];
    const subjectWords = subject.toLowerCase().split(' ');
    if (subjectWords.some((w) => LOCAL.has(w)) || subjectWords.every((w) => STEM.has(w))) {
      return kept;
    }
    // A singular thing of several words needs an article ("the keto diet") this cannot choose.
    if (subjectWords.length > 1 && !isPluralPhrase(subject)) return kept;
    const verb = isPluralPhrase(subject) ? 'Are' : 'Is';
    return { text: `${verb} ${subject} ${m[2]}${m[3]}?`, template: 'yes-no' };
  }

  if (lower[0] === 'best' && lower.length >= 2) {
    const rest = bare.split(' ').slice(1).join(' ');
    // Tagged after "the best", where "practices" and "running" read as the nouns they are.
    const next = termTags(`the best ${rest}`)[2] ?? [];
    const opensWithNoun = next.includes('Noun') || next.includes('Adjective');
    if (!opensWithNoun || next.includes('Preposition') || isNamedOrLocal(lower, rest)) return kept;
    if (next.includes('Verb') && !next.includes('Noun')) return kept;
    let phrase = rest;
    const year = /^(.*\S)\s+((?:19|20)\d{2})$/.exec(phrase);
    if (year) phrase = `${year[1]} in ${year[2]}`;
    const head = phrase.split(/\s+(?:for|in|under|with|to|of|on)\s+/i)[0] ?? phrase;
    if (!/\p{L}/u.test(head)) return kept;
    return {
      text: `What ${isPluralPhrase(head) ? 'are' : 'is'} the best ${phrase}?`,
      template: 'best',
    };
  }

  m = /^(.+?)\s+explained$/i.exec(bare);
  if (m && !isNamedOrLocal(lower, m[1])) {
    return {
      text: `How ${isPluralPhrase(m[1]) ? 'do' : 'does'} ${m[1]} work?`,
      template: 'how-it-works',
    };
  }

  if (lower.length >= 2 && HOW_TO_VERBS.has(lower[0] ?? '') && !lower.some((w) => LOCAL.has(w))) {
    return { text: `How to ${bare}?`, template: 'how-to' };
  }

  if (pluralConcept(bare, lower)) return { text: `What are ${bare}?`, template: 'what-is' };
  return kept;
}

interface Candidate extends Omit<SiteQuestion, 'text' | 'template'> {
  order: number;
}

/**
 * The site's reader questions, ranked: by citations (Bing rows), then by volume (a keyword's
 * search volume or a Search Console query's impressions), then in input order (keywords, then
 * imported rows, then `suggested`), so with no numbers the list keeps the order given. A
 * question is listed once (ignoring case, spacing and the closing "?"), at its best rank. At most
 * `max` (default 50). `suggested` are questions from the local model, kept as written.
 */
export function siteQuestions(input: {
  keywords?: string | KeywordRow[];
  queries?: ImportedQuery[];
  suggested?: string[];
  max?: number;
}): SiteQuestion[] {
  const max = Math.max(0, input.max ?? SITE_QUESTIONS_MAX);
  const rows =
    typeof input.keywords === 'string' ? parseKeywordList(input.keywords) : (input.keywords ?? []);
  const candidates: Candidate[] = [];
  const push = (c: Omit<Candidate, 'order'>) => candidates.push({ ...c, order: candidates.length });
  for (const r of rows) {
    push({
      keyword: r.text.replace(/\s+/g, ' ').trim(),
      source: 'keywords',
      ...(r.volume === undefined ? {} : { volume: r.volume }),
    });
  }
  for (const q of input.queries ?? []) {
    push({
      keyword: q.text.replace(/\s+/g, ' ').trim(),
      source: q.source,
      ...(q.impressions === undefined ? {} : { volume: q.impressions }),
      ...(q.citations === undefined ? {} : { citations: q.citations }),
    });
  }
  for (const s of input.suggested ?? []) {
    push({ keyword: s.replace(/\s+/g, ' ').trim(), source: 'local-model' });
  }
  candidates.sort(
    (a, b) =>
      (b.citations ?? 0) - (a.citations ?? 0) ||
      (b.volume ?? 0) - (a.volume ?? 0) ||
      a.order - b.order,
  );
  const seen = new Set<string>();
  const seenKeywords = new Set<string>();
  const out: SiteQuestion[] = [];
  for (const { order: _, ...c } of candidates) {
    if (out.length >= max) break;
    // "espresso vs drip" and "espresso vs drip?" are one keyword.
    const keywordKey = questionKey(c.keyword);
    if (keywordKey === '' || seenKeywords.has(keywordKey)) continue;
    seenKeywords.add(keywordKey);
    const q =
      c.source === 'local-model'
        ? { text: asQuestion(c.keyword), template: 'as-written' as const }
        : keywordQuestion(c.keyword);
    const key = questionKey(q.text);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    const { volume, citations, ...rest } = c;
    out.push({
      text: q.text,
      ...rest,
      template: q.template,
      ...(volume === undefined ? {} : { volume }),
      ...(citations === undefined ? {} : { citations }),
    });
  }
  return out;
}

const count = (n: number, one: string) =>
  `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;

/** A site question's number for display: "Volume 1,900", "2,310 impressions", "52 citations". */
export function siteQuestionNumbers(
  q: Pick<SiteQuestion, 'source'> & Partial<Pick<SiteQuestion, 'volume' | 'citations'>>,
): string {
  if (q.citations !== undefined) return count(q.citations, 'citation');
  if (q.volume === undefined) return '';
  return q.source === 'search-console'
    ? count(q.volume, 'impression')
    : `Volume ${q.volume.toLocaleString('en-US')}`;
}

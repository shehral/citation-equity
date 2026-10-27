// The searches an answer engine is likely to run behind a question ("fan-out"): when an AI
// search engine answers, it often runs several web searches first (3 to 10 per question), and
// a page that covers them has more to be found by. These are deterministic templates by the
// kind of question, built only from the question's own key words, never padded with others.
// Guidance only: nothing here is a score or a check, and none of it was tested for citation.
import nlp from 'compromise/two';
import { isPluralPhrase } from './site-questions';

/** The kind of question, which picks the search templates. */
export type QuestionType =
  | 'comparison'
  | 'how-to'
  | 'how-it-works'
  | 'how-long'
  | 'how-much'
  | 'cost'
  | 'best'
  | 'causes'
  | 'pros-cons'
  | 'safety'
  | 'definition'
  | 'other';

const MAX = 8;

const set = (words: string) => new Set(words.split(/\s+/));

/** Words that carry no topic: articles, auxiliaries, pronouns, question words, fillers. */
const STOP = set(
  'a an the is are was were be been being am do does did can could should would will may ' +
    'might must shall have has had i me my mine you your yours we us our it its they them ' +
    'their he she his her him this that these those what whats why how when where which who ' +
    'whom whose really actually ever very just',
);
/** Words a search never starts or ends with ("to", "of", "and"); kept inside one. */
const EDGE = set('for to of in on with at by from about than or and into vs versus as');
const COST = set(
  'cost costs price prices pricing cheap cheaper cheapest expensive afford affordable budget spend pay',
);
const SAFETY = set(
  'safe safety unsafe dangerous danger risk risks risky toxic harmful healthy unhealthy health',
);
const PROS_CONS = set('pros cons worth benefits advantages disadvantages downsides drawbacks');
/** Words the how-long templates replace with "time". */
const DURATION = set('long take takes last lasts need needs');
/** Words that mean a reader's own problem, so "how to fix" is a likely search. */
const PERSONAL = set('my our mine too');

interface Token {
  /** As the search writes it: lowercased, unless the question writes it as a name. */
  shown: string;
  lower: string;
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

/**
 * How each word is written in searches: lowercased, except a word capitalised after the first
 * word of the question ("Is the Breville Bambino worth it?") or written in capitals ("AI"),
 * which is a name and keeps its case.
 */
function caseMap(question: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [i, m] of [...question.matchAll(WORD)].entries()) {
    const word = m[0];
    const lower = word.toLowerCase();
    const named = word !== lower && (i > 0 || (word.length > 1 && word === word.toUpperCase()));
    if (named) map.set(lower, word);
    else if (!map.has(lower)) map.set(lower, lower);
  }
  return map;
}

const tokensOf = (text: string, cases: Map<string, string>): Token[] =>
  [...text.matchAll(WORD)].map((m) => {
    const lower = m[0].toLowerCase().replace(/’/g, "'");
    return { lower, shown: cases.get(m[0].toLowerCase()) ?? lower };
  });

/** The topic words of `text`: no STOP words or `drop` words, no EDGE word at either end. */
function keyWords(text: string, cases: Map<string, string>, drop?: Set<string>): Token[] {
  const kept = tokensOf(text, cases).filter(
    (t) => !STOP.has(t.lower.replace(/'s$/, '')) && !drop?.has(t.lower),
  );
  let from = 0;
  let to = kept.length;
  while (from < to && EDGE.has(kept[from].lower)) from++;
  while (to > from && EDGE.has(kept[to - 1].lower)) to--;
  return kept.slice(from, to);
}

const join = (tokens: Token[]) => tokens.map((t) => t.shown).join(' ');

/** "X or Y", "X vs Y", "difference between X and Y", "X stronger than Y": the two items. */
function comparedItems(question: string): [string, string] | null {
  const q = question.trim().replace(/[\s?.!]+$/u, '');
  const beforeColon = q.split(':')[0] ?? q;
  const patterns: [string, RegExp][] = [
    [q, /\bdifference between (.+?) and (.+)$/i],
    [q, /^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i],
    [q, /\b(?:better|best)\b[,:]?\s+(.+?)\s+or\s+(.+)$/i],
    [q, /^(?:is|are|does|do|was|were)\s+(.+?)\s+(?:\w+er|more\s+\w+|less\s+\w+)\s+than\s+(.+)$/i],
  ];
  if (q.includes(':')) patterns.push([beforeColon, /^(.+?)\s+or\s+(.+)$/i]);
  for (const [text, re] of patterns) {
    const m = re.exec(text);
    if (m) return [m[1], m[2]];
  }
  return null;
}

const lowerWords = (q: string) =>
  (q.toLowerCase().match(WORD) ?? []).map((w) => w.replace(/’/g, "'"));
const hasAny = (words: string[], of: Set<string>) => words.some((w) => of.has(w));

const HOW_TO =
  /^(?:how\s+(?:to|(?:do|can|should|would|could)\s+(?:i|you|we))|what(?:'s|’s| is) the best way to)\s+(.+)$/i;
const HOW_WORKS = /^how\s+(?:does|do)\s+(.+?)\s+work$/i;

/** The kind of question, from its opening words and the words it uses. */
export function questionType(question: string): QuestionType {
  const q = question.trim().replace(/[\s?.!]+$/u, '');
  const w = lowerWords(q);
  if (comparedItems(q)) return 'comparison';
  if (HOW_TO.test(q)) return 'how-to';
  if (HOW_WORKS.test(q)) return 'how-it-works';
  if (w[0] === 'how' && w[1] === 'long') return 'how-long';
  if (w[0] === 'how' && (w[1] === 'much' || w[1] === 'many'))
    return hasAny(w, COST) ? 'cost' : 'how-much';
  if (w.includes('best') || (w[0] === 'top' && w.length > 1)) return 'best';
  if (w[0] === 'why') return 'causes';
  if (hasAny(w, PROS_CONS) || /^should\s+(?:i|you|we)\s+(?:buy|get|use|try)\b/i.test(q))
    return 'pros-cons';
  if ((w[0] === 'is' || w[0] === 'are') && hasAny(w, JUDGED)) return 'pros-cons';
  if (hasAny(w, COST)) return 'cost';
  if (hasAny(w, SAFETY)) return 'safety';
  if (w[0] === 'what' || w[0] === "what's") return 'definition';
  return 'other';
}

/** compromise's tags for each word of `text`. */
const tagsOf = (text: string): string[][] =>
  (nlp(text).json() as { terms: { tags: string[] }[] }[]).flatMap((s) =>
    s.terms.map((t) => t.tags),
  );

/** Verbs a yes-or-no question ends with ("Does grind size matter?"); not part of its thing. */
const PREDICATE = set(
  'matter matters work works help helps hurt hurts change changes affect affects exist',
);
/** Judgment words of a yes-or-no question that asks for pros and cons ("Is keto good?"). */
const JUDGED = set('good bad legit reliable effective necessary accurate');
/** Words that name a kind of advice, not a product: no "reviews" or "compared" for them. */
const ABSTRACT = set(
  'practices practice ways way tips ideas things strategies methods examples options places ' +
    'time times reasons steps habits resources approaches advice books',
);
/** "Can I", "Should you", "Do we": the reader's own action follows. */
const ASKS_ACTION = /^(?:can|could|should|do|would|may)\s+(?:i|you|we)\b/i;
/** Words of a local search ("best pizza near me"): no template fits it. */
const LOCAL = set('near nearby');

/** The question's key words without the closing verb of a yes-or-no question ("matter"). */
function mainThing(tokens: Token[]): Token[] {
  let thing = tokens;
  while (thing.length > 1 && PREDICATE.has(thing[thing.length - 1].lower))
    thing = thing.slice(0, -1);
  return thing;
}

/** True when every word is a noun or an adjective and the last a noun, none a number. */
function isNounPhrase(tokens: Token[]): boolean {
  if (tokens.length === 0 || tokens.some((t) => /^\p{N}/u.test(t.lower) || EDGE.has(t.lower)))
    return false;
  const tags = tagsOf(`the ${tokens.map((t) => t.lower).join(' ')}`).slice(1);
  if (tags.length !== tokens.length) return false;
  const last = tags[tags.length - 1] ?? [];
  return (
    (last.includes('Noun') || isPluralPhrase(join(tokens))) &&
    tags.every(
      (t, i) =>
        (t.includes('Noun') || t.includes('Adjective') || i === tags.length - 1) &&
        !t.includes('Pronoun') &&
        !t.includes('Gerund'),
    )
  );
}

const isAre = (phrase: string) => (isPluralPhrase(phrase) ? 'are' : 'is');

/** The templates of each kind; each search is the question's own words and fixed words only. */
function templates(type: QuestionType, question: string, cases: Map<string, string>): string[] {
  const q = question.trim().replace(/[\s?.!]+$/u, '');
  const w = lowerWords(q);
  const words = (text: string, drop?: Set<string>) => join(keyWords(text, cases, drop));
  switch (type) {
    case 'comparison': {
      const [a, b] = comparedItems(q) ?? ['', ''];
      const x = words(a);
      const y = words(b);
      if (x === '' || y === '') return [];
      return [
        `${x} vs ${y}`,
        `difference between ${x} and ${y}`,
        `${x} pros and cons`,
        `${y} pros and cons`,
      ];
    }
    case 'how-to': {
      const a = words(HOW_TO.exec(q)?.[1] ?? '');
      return a === '' ? [] : [`how to ${a}`, `${a} step by step`, `${a} tips`];
    }
    case 'how-it-works': {
      const x = words(HOW_WORKS.exec(q)?.[1] ?? '');
      if (x === '') return [];
      return [`how ${x} ${isPluralPhrase(x) ? 'work' : 'works'}`, `${x} explained`];
    }
    case 'how-long': {
      const t = words(q, DURATION);
      return t === '' ? [] : [`how long ${t}`, `${t} time`];
    }
    case 'how-much': {
      const tokens = keyWords(q, cases, set('much many'));
      if (tokens.length === 0) return [];
      const t = join(tokens);
      const out = [t, `how ${w[1]} ${t}`];
      if (isNounPhrase(tokens)) out.push(`${t} amount`);
      return out;
    }
    case 'cost': {
      const t = words(q, new Set([...COST, 'much', 'many']));
      return t === '' ? [] : [`${t} cost`, `${t} price`];
    }
    case 'best': {
      // "best of 2026": nothing follows "best" to rank, so no template fits.
      const after = w[w.indexOf('best') + 1] ?? w[1] ?? '';
      if (after === '' || EDGE.has(after)) return [];
      const rest = keyWords(q, cases, set('best top'));
      if (rest.length === 0 || !rest.some((t) => /\p{L}/u.test(t.lower))) return [];
      const at = rest.findIndex((t, i) => i > 0 && EDGE.has(t.lower));
      const head = at > 0 ? rest.slice(0, at) : rest;
      const out = [`best ${join(rest)}`];
      // Reviews and comparisons are of things, so only for a product-like head noun.
      const last = head[head.length - 1]?.lower ?? '';
      if (isNounPhrase(head) && !ABSTRACT.has(last)) {
        out.push(`${join(head)} reviews`, `${join(head)} compared`);
      }
      return out;
    }
    case 'causes': {
      const content = keyWords(q, cases);
      if (content.length === 0) return [];
      // A judgment ("Why are weight loss pills safe?") is not a cause to look up: the safety
      // and cost searches cover it, and nothing here repeats its claim.
      if (content.some((c) => SAFETY.has(c.lower) || COST.has(c.lower) || JUDGED.has(c.lower))) {
        return [];
      }
      // "Why is my espresso bitter?" searches "bitter espresso": a quality moves before its thing.
      const copula = ['is', 'are', 'was', 'were'].includes(w[1] ?? '');
      const tags = tagsOf(content.map((c) => c.lower).join(' '));
      const last = tags[tags.length - 1] ?? [];
      const thing = content.slice(0, -1).filter((c) => c.lower !== 'too' && c.lower !== 'so');
      if (
        !copula ||
        content.length < 2 ||
        tags.length !== content.length ||
        !last.includes('Adjective') ||
        !isNounPhrase(thing)
      ) {
        return [join(content)];
      }
      const t = `${content[content.length - 1].shown} ${join(thing)}`;
      const out = [t, `${t} causes`, `what causes ${t}`];
      if (hasAny(w, PERSONAL)) out.push(`how to fix ${t}`);
      return out;
    }
    case 'pros-cons': {
      // "Is react worth learning?" is about learning react.
      const worthDoing = /^(?:is|are)\s+(.+?)\s+worth\s+(\p{L}+ing)\b/iu.exec(q);
      const x = worthDoing
        ? `${words(worthDoing[2])} ${words(worthDoing[1])}`
        : words(q, new Set([...PROS_CONS, ...JUDGED, 'buy', 'get', 'use', 'try']));
      if (x.trim() === '') return [];
      const out = [`${x} pros and cons`, `${x} benefits`, `${x} downsides`];
      if (w.includes('worth')) out.push(`${isAre(x)} ${x} worth it`);
      return out;
    }
    case 'safety': {
      const tokens = keyWords(q, cases, SAFETY);
      if (tokens.length === 0) return [];
      const t = join(tokens);
      // "Is it safe to eat raw eggs?": an action, so the searches are about what it acts on.
      const action = new RegExp(
        `\\b(?:${[...SAFETY].join('|')})\\s+to\\s+${tokens[0].lower}\\b`,
        'i',
      );
      if (action.test(q)) {
        const object = tokens.slice(1);
        if (!isNounPhrase(object)) return [t];
        return [t, `${join(object)} risks`, `${join(object)} safety`];
      }
      if (!isNounPhrase(tokens)) return [t];
      return [t, `${isAre(t)} ${t} safe`, `${t} risks`, `${t} safety`];
    }
    case 'definition': {
      const tokens = keyWords(q, cases);
      // A long or clause-like "what" question ("What is the right grind for espresso") is not a
      // definition: it gets the plain searches instead.
      if (tokens.length === 0) return [];
      if (tokens.length > 4 || !isNounPhrase(tokens)) return plain(tokens, false);
      const x = join(tokens);
      return [`${x} definition`, `${x} explained`];
    }
    case 'other':
      return plain(keyWords(q, cases), ASKS_ACTION.test(q));
  }
}

/**
 * Any question: its key words, the main thing it is about, and that thing explained. After "Can
 * I" or "Should you" (`action`) the key words open with the reader's verb ("deduct home
 * office"), so nothing is "explained".
 */
function plain(tokens: Token[], action: boolean): string[] {
  if (tokens.length === 0) return [];
  const t = join(tokens);
  const thingTokens = mainThing(tokens);
  const thing = join(thingTokens);
  const out = [t];
  if (thing !== t) out.push(thing);
  if (!action && isNounPhrase(thingTokens)) out.push(`${thing} explained`);
  return out;
}

const searchKey = (s: string) => (s.toLowerCase().match(WORD) ?? []).join(' ');

/**
 * Up to 8 searches an answer engine is likely to run before answering `question`, from
 * templates for its kind (questionType): a definition, the steps of a how-to, how long or how
 * much, causes, a comparison, the best options, pros and cons, and cost or safety when the
 * question asks about them. Each search is made of the question's own key words and the
 * template's fixed words only, none repeats the question, and a template that would not read
 * as a search is left out, so a question may get fewer than three, or none (a local search, or
 * a question without key words). The same question always gives the same searches.
 */
export function fanOutSearches(question: string): string[] {
  const q = question.trim();
  if (q === '') return [];
  const w = lowerWords(q);
  if (hasAny(w, LOCAL)) return [];
  const cases = caseMap(q);
  const type = questionType(q);
  const candidates = templates(type, q, cases);
  if (type !== 'cost' && hasAny(w, COST)) candidates.push(...templates('cost', q, cases));
  if (type !== 'safety' && hasAny(w, SAFETY)) candidates.push(...templates('safety', q, cases));

  const asked = searchKey(q);
  const seen = new Set<string>([asked]);
  const out: string[] = [];
  for (const s of candidates) {
    const text = s.replace(/\s+/g, ' ').trim();
    const key = searchKey(text);
    if (key === '' || seen.has(key) || out.length >= MAX) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

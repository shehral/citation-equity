/*
 * Quote and attribution detection adapted from:
 * - aiseo-audit (https://github.com/agencyenterprise/aiseo-audit),
 *   src/modules/grounding-signals/patterns.ts `QUOTED_ATTRIBUTION_PATTERNS`, npm aiseo-audit
 *   2.1.2, MIT License, Copyright (c) 2026 aiseo-audit contributors.
 * - geo-lint (https://github.com/IJONIS/geo-lint), src/utils/geo-analyzer.ts `hasExpertQuote`
 *   (blockquote with an em-dash or double-dash name, "said/says Name"), npm @ijonis/geo-lint
 *   0.2.1, MIT License, Copyright (c) 2026 IJONIS.
 * Changes: quotes are read from the prose mask (code, HTML and front matter never count) and
 * need at least 3 words; blockquotes are grouped across their paragraphs; the attribution must
 * sit next to the quote (not inside it) and name someone (a capitalised name, not a pronoun)
 * or give a role at an organisation with a speech verb; a bare ", role at Org" counts only
 * right after a full name ("Jane Doe, head roaster at Example Coffee") that does not start with
 * a sentence opener, while a name next to a speech verb or dash may ("But Jane Doe says",
 * "says An Nguyen"); plural and indefinite subjects ("Experts said") name no one; callout
 * blockquotes (`> [!NOTE]`, `> **Note:**`) are not quotes; more speech verbs;
 * unattributed quotes score 0.5 and are pointed at one by one.
 */
import { EVIDENCE } from '../evidence';
import type { Artifacts, Paragraph } from '../gather';
import { countWords } from '../text';
import type { CheckResult, Range } from '../types';
import { suggester } from './data-support';
import { topOfDraft } from './structure-issues';
import { type CheckFn, notApplicable } from './types';

const VERBS = [
  'said',
  'says',
  'explained',
  'explains',
  'noted',
  'notes',
  'added',
  'adds',
  'told',
  'tells',
  'wrote',
  'writes',
  'recalled',
  'recalls',
  'argued',
  'argues',
  'observed',
  'observes',
  'warned',
  'warns',
  'according\\s+to',
];
/** A speech verb, lower case or capitalised at a sentence start. */
const SPEECH = `(?:${VERBS.map((v) => `[${v[0]?.toUpperCase()}${v[0]}]${v.slice(1)}`).join('|')})`;
const NAME_WORD = String.raw`\p{Lu}[\p{L}'’-]*\.?`;
const NAME = String.raw`(?<name>(?:(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+)?${NAME_WORD}(?:\s+${NAME_WORD})*)`;
/** A role at an organisation: "the head roaster at Example Coffee", "a chemist at Example Lab". */
const ROLE = String.raw`(?:the\s+|an?\s+)?\p{Ll}[\p{L}-]*(?:\s+\p{Ll}[\p{L}-]*){0,3}\s+(?:at|of|from)\s+\p{Lu}`;
/**
 * A person named well enough to carry a bare `, role at Org`: two or more capitalised words,
 * or an honorific and one. A single capitalised word is too often a sentence opener.
 */
const PERSON = String.raw`(?<person>(?:(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+${NAME_WORD}|${NAME_WORD}(?:\s+${NAME_WORD})+))`;
/** Organisation words after the capital that ends ROLE. */
const ORG_TAIL = String.raw`[\p{L}'’&-]*(?:\s+\p{Lu}[\p{L}'’&-]*)*`;
const LEAD = String.raw`^\s*[,.;:!?]?\s*`;
const DASH = '(?:—|–|--)';
const GRADE = `Evidence grade: ${EVIDENCE['expert-quotes'].grade}.`;

/** Attribution right after a quote: `," says Jane Doe`, `" Jane Doe said`, `" — Jane Doe`. */
const AFTER = [
  new RegExp(`${LEAD}${SPEECH}\\s+${NAME}`, 'u'),
  new RegExp(`${LEAD}${NAME}\\s+${SPEECH}\\b`, 'u'),
  new RegExp(`${LEAD}${DASH}\\s*${NAME}`, 'u'),
  new RegExp(`${LEAD}${SPEECH}\\s+${ROLE}`, 'u'),
  new RegExp(String.raw`${LEAD}${PERSON},\s*${ROLE}`, 'u'),
  new RegExp(String.raw`${LEAD}${ROLE}${ORG_TAIL},?\s+${SPEECH}\b`, 'u'),
];
/** Attribution right before a quote: `According to Jane Doe, "`, `Jane Doe says: "`. */
const BEFORE = [
  new RegExp(String.raw`${SPEECH}\s+${NAME}\s*[,:]?\s*$`, 'u'),
  new RegExp(String.raw`${NAME}\s+${SPEECH}\s*[,:]?\s*$`, 'u'),
];
/** Attribution anywhere in a blockquote (outside quotation marks). */
const INSIDE_BLOCKQUOTE = [
  new RegExp(String.raw`(?:^|\s)${DASH}\s*${NAME}`, 'u'),
  new RegExp(`${SPEECH}\\s+${NAME}`, 'u'),
  new RegExp(`${NAME}\\s+${SPEECH}\\b`, 'u'),
  new RegExp(`${SPEECH}\\s+${ROLE}`, 'u'),
  new RegExp(String.raw`(?:^|[.!?]["”]?\s+)${PERSON},\s*${ROLE}`, 'u'),
];
/** Capitalised words that do not name a speaker. */
const PRONOUNS = new Set([
  'He',
  'She',
  'They',
  'It',
  'We',
  'I',
  'You',
  'One',
  'Someone',
  'Somebody',
  'Everyone',
  'This',
  'That',
  'These',
  'Those',
  'Then',
  // Plural and indefinite subjects: "Many said", "Experts noted" name no one.
  'Many',
  'Most',
  'Some',
  'Several',
  'Others',
  'Few',
  'All',
  'Experts',
  'Researchers',
  'Scientists',
  'Analysts',
  'Critics',
  'People',
  'Studies',
  'Sources',
  'Officials',
]);
/**
 * Capitalised sentence openers. A PERSON (which carries a bare `, role at Org`) must not start
 * with one ("In New York, most beans from Kenya ..."). A NAME next to a speech verb or a dash
 * may: its leading opener is skipped ("But Jane Doe says"), and a name such as "An Nguyen",
 * "No Hong-chul" or "The Lancet" keeps its first word as part of the name.
 */
const OPENERS = new Set([
  'A',
  'An',
  'The',
  'In',
  'On',
  'At',
  'For',
  'From',
  'With',
  'By',
  'If',
  'When',
  'After',
  'Before',
  'But',
  'And',
  'So',
  'Yes',
  'No',
  'However',
]);

const INLINE_QUOTE = /"([^"\n]+)"|“([^”\n]+)”/g;
const WINDOW = 120;

/** The words of a matched name, honorific dropped and trailing periods trimmed. */
const words = (name: string) =>
  name
    .replace(/^(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?\s+/, '')
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''));

/** A NAME: skip one leading opener when more words follow, then reject a pronoun. */
function isName(name: string): boolean {
  const w = words(name);
  const first = w.length > 1 && OPENERS.has(w[0] ?? '') ? w[1] : w[0];
  return !PRONOUNS.has(first ?? '');
}

/** A PERSON: neither a pronoun nor a sentence opener may start it. */
function isPerson(person: string): boolean {
  const first = words(person)[0] ?? '';
  return !PRONOUNS.has(first) && !OPENERS.has(first);
}

function names(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => {
    const m = re.exec(text);
    if (!m) return false;
    const { name, person } = m.groups ?? {};
    if (person !== undefined) return isPerson(person);
    if (name !== undefined) return isName(name);
    return true;
  });
}

/** `text` with the inside of every quotation blanked, so its words never attribute it. */
const blankQuotes = (text: string) =>
  text.replace(INLINE_QUOTE, (q) => `${q[0]}${' '.repeat(q.length - 2)}${q[q.length - 1]}`);

interface Quote {
  range: Range;
  attributed: boolean;
}

function inlineQuotes(p: Paragraph): Quote[] {
  const context = blankQuotes(p.plain);
  const quotes: Quote[] = [];
  for (const m of p.plain.matchAll(INLINE_QUOTE)) {
    if (countWords(m[1] ?? m[2] ?? '') < 3) continue;
    const start = m.index;
    const end = start + m[0].length;
    const before = context.slice(Math.max(0, start - WINDOW), start);
    const after = context.slice(end, end + WINDOW);
    quotes.push({
      range: { start: p.range.start + start, end: p.range.start + end },
      attributed: names(AFTER, after) || names(BEFORE, before),
    });
  }
  return quotes;
}

/** A callout, not a quotation: `> [!NOTE]` (GitHub alerts) or `> **Note:** ...`. */
const CALLOUT = /^\s*(?:\[!|(\*\*|__)[^*_\n]{1,40}?(?::\1|\1:))/;

/** Consecutive blockquote paragraphs, split where anything but `>` and spaces lies between. */
function blockquoteGroups(markdown: string, paragraphs: Paragraph[]): Paragraph[][] {
  const groups: Paragraph[][] = [];
  for (const p of paragraphs) {
    if (!p.inBlockquote) continue;
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (group && last && /^[\s>]*$/.test(markdown.slice(last.range.end, p.range.start))) {
      group.push(p);
    } else {
      groups.push([p]);
    }
  }
  return groups;
}

export const check: CheckFn = (a: Artifacts): CheckResult => {
  if (a.wordCount < 300) return notApplicable('expert-quotes');

  const quotes: Quote[] = [];
  for (const p of a.paragraphs) if (!p.inBlockquote) quotes.push(...inlineQuotes(p));
  for (const group of blockquoteGroups(a.markdown, a.paragraphs)) {
    const plain = group.map((p) => p.plain).join(' ');
    if (countWords(plain) < 3) continue;
    const first = group[0];
    const last = group[group.length - 1];
    if (!first || !last || CALLOUT.test(first.text)) continue;
    quotes.push({
      range: { start: first.range.start, end: last.range.end },
      attributed: names(INSIDE_BLOCKQUOTE, blankQuotes(plain)),
    });
  }
  quotes.sort((x, y) => x.range.start - y.range.start);

  const attributed = quotes.filter((q) => q.attributed).length;
  const score = attributed > 0 ? 1 : quotes.length > 0 ? 0.5 : 0;
  const result: CheckResult = {
    checkId: 'expert-quotes',
    applicable: true,
    score,
    findings: [],
    suggestions: [],
    metrics: { quotes: quotes.length, attributed, unattributed: quotes.length - attributed },
  };
  if (score === 1) return result;

  const build = suggester('expert-quotes');
  const slice = (r: Range) => a.markdown.slice(r.start, r.end);
  if (quotes.length > 0) {
    for (const q of quotes.slice(0, 5)) {
      const message = 'This quotation does not say who said it.';
      result.findings.push({ checkId: 'expert-quotes', range: q.range, message });
      result.suggestions.push(
        build({
          kind: 'advisory',
          range: q.range,
          before: slice(q.range),
          title: 'Name who said this',
          rationale: `${message} Add the speaker's name and role next to the quote, for example "says Jane Doe, head roaster at Example Coffee", so a reader can judge the source. Name only the person who really said it. ${GRADE}`,
        }),
      );
    }
    return result;
  }

  // Draft-wide advice sits at the top of the draft, so its id survives edits to the text below.
  const range = topOfDraft(a);
  const message = 'The draft has no quotation from a named person.';
  result.findings.push({ checkId: 'expert-quotes', range, message });
  result.suggestions.push(
    build({
      kind: 'advisory',
      range,
      before: slice(range),
      title: 'Add a quote from a named expert',
      rationale: `${message} A short quote from someone with first-hand experience, with their name and role, adds a voice a reader can check. Only quote what a real person actually said. In the larger studies, adding quotations for their own sake did not raise citation rank (C-SEO Bench). ${GRADE}`,
    }),
  );
  return result;
};

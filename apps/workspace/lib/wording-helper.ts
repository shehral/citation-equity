import type { EngineAdapter } from '@citation-equity/bench';
import type { CheckId, Suggestion } from '@citation-equity/engine';

/**
 * Checks whose advice is to add real material (a figure, a named speaker, a source). A small
 * model asked to address them invents that material (a "Jane Doe", a "study by the ... Association",
 * an "extraction time of 20-30 seconds"), so the helper is never offered for them: only the
 * author can supply the real thing.
 */
const DATA_SUPPORT_CHECKS = new Set<CheckId>(['statistics', 'expert-quotes', 'cited-sources']);

/**
 * Advice only, by design: a model asked to work the reader's words in would stuff them in, so
 * this check never gets a written edit; the author decides where a word fits.
 */
const ADVICE_ONLY_CHECKS = new Set<CheckId>(['reader-words']);

/** True when the card may offer the local wording helper for `s`. */
export function offersWordingHelper(s: Suggestion): boolean {
  return (
    s.kind === 'advisory' &&
    !DATA_SUPPORT_CHECKS.has(s.checkId) &&
    !ADVICE_ONLY_CHECKS.has(s.checkId) &&
    s.before.trim() !== ''
  );
}

/**
 * The rationale without its worked examples: a sentence that quotes something or gives an
 * example ("for example", "such as", "e.g.") is dropped, since a small model copies the example
 * into the draft as if it were a fact.
 */
export function rationaleForPrompt(rationale: string): string {
  return rationale
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/["“”]|\bfor example\b|\bsuch as\b|\be\.g\./i.test(sentence))
    .join(' ')
    .trim();
}

/** Low temperature and a fixed seed: the same span and model give the same proposal. */
const WORDING_OPTIONS = { seed: 1, temperature: 0.2 } as const;

/**
 * The prompt for the local wording helper: rewrite only `s.before` so it
 * addresses the check, keeping meaning, facts and voice, with no new facts or
 * numbers. The section is context only. Missing facts become [placeholders].
 */
export function buildWordingPrompt(s: Suggestion, sectionText: string): string {
  return [
    'You help an author revise one passage of their draft. Rewrite ONLY the passage below so it addresses the writing check. Do not rewrite anything else.',
    '',
    `Check: ${s.title}`,
    ...(rationaleForPrompt(s.rationale) === '' ? [] : [`Why: ${rationaleForPrompt(s.rationale)}`]),
    '',
    'Rules:',
    "- Keep the passage's meaning, its facts and the author's voice.",
    '- Do not add new facts, numbers, names, quotations or sources. If the check asks for something the passage does not contain (a source, a speaker, a figure), write a placeholder in square brackets, such as [source] or [name, role], instead of inventing it.',
    '- Keep any Markdown the passage uses (heading marks, list marks, links).',
    '- Return only the rewritten text: no explanation, no label, no quotation marks around it, no code fence.',
    '',
    'The section the passage sits in, for context only:',
    '<<<',
    sectionText.trim(),
    '>>>',
    '',
    'The passage to rewrite:',
    '<<<',
    s.before.trim(),
    '>>>',
  ].join('\n');
}

const FENCE = /^```[\w-]*\n([\s\S]*?)\n?```$/;
const LABEL = /^(?:rewritten(?: text| passage)?|revised(?: text| passage)?|passage)\s*:\s*/i;

/** Removes wrappers small models add despite the prompt: a code fence, a label, quotes. */
function clean(answer: string, before: string): string {
  let text = answer.trim();
  text = (FENCE.exec(text)?.[1] ?? text).trim();
  text = text.replace(LABEL, '').trim();
  const quoted = (t: string) => t.length > 1 && t.startsWith('"') && t.endsWith('"');
  if (quoted(text) && !quoted(before.trim())) text = text.slice(1, -1).trim();
  return text;
}

/** Text in [square brackets]: placeholders the prompt asks for, never facts. */
const PLACEHOLDER = /\[[^\]\n]*\]/g;
const NUMBER = /\d+(?:[.,:]\d+)*/g;
const QUOTE_MARK = /["“”]/g;
/** A capitalised word that does not open a sentence, a line or a Markdown block. */
const NAME = /[A-Z][\p{L}'’-]*/gu;
const OPENS = /(?:^|[.!?:]\s+|\n)[\t ]*(?:(?:[#>*+-]+|\d+[.)])[\t ]*)?["“'‘(*_]*$/;

/**
 * What `after` adds that `before` does not have: numbers, quotation marks, "according to", or
 * capitalised names. Placeholders in square brackets do not count. Empty when nothing is added.
 */
export function addedFacts(before: string, after: string): string[] {
  const text = after.replace(PLACEHOLDER, '');
  const found: string[] = [];
  const beforeNumbers = new Set(before.match(NUMBER) ?? []);
  if ((text.match(NUMBER) ?? []).some((n) => !beforeNumbers.has(n))) found.push('a number');
  if ((text.match(QUOTE_MARK) ?? []).length > (before.match(QUOTE_MARK) ?? []).length) {
    found.push('a quotation');
  }
  if (/\baccording to\b/i.test(text) && !/\baccording to\b/i.test(before)) found.push('a source');
  const known = new Set(before.toLowerCase().match(/[\p{L}'’-]+/gu) ?? []);
  for (const m of text.matchAll(NAME)) {
    const word = m[0];
    if (word === 'I' || known.has(word.toLowerCase())) continue;
    if (OPENS.test(text.slice(0, m.index))) continue;
    found.push('a name');
    break;
  }
  return found;
}

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Asks a local model for wording that addresses `s`, and returns a copy of
 * `s` as an `edit` whose `after` is that wording, with the same id, range and
 * before. It never applies anything: the caller shows it side by side, and
 * only the author's Apply click changes the draft. A proposal that adds a
 * number, quotation, "according to" or a name the passage lacks is rejected
 * with an Error. Adapter errors pass through.
 */
export async function proposeWording(
  s: Suggestion,
  sectionText: string,
  adapter: EngineAdapter,
  model: string,
): Promise<Suggestion> {
  const answer = await adapter.generate(buildWordingPrompt(s, sectionText), {
    model,
    ...WORDING_OPTIONS,
  });
  const text = clean(answer, s.before);
  if (text === '') throw new Error('The local model returned no text.');
  const added = addedFacts(s.before, text);
  if (added.length > 0) {
    throw new Error(
      `its wording added ${list(added)} that your text does not have, so it is not offered. Facts, names and sources have to come from you.`,
    );
  }
  const lead = /^\s*/.exec(s.before)?.[0] ?? '';
  const trail = /\s*$/.exec(s.before)?.[0] ?? '';
  return { ...s, kind: 'edit', after: `${lead}${text}${trail}` };
}

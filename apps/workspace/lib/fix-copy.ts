// What a fix card says: one title of 6 words or fewer and one reason of 20
// words or fewer, action first. The engine's own titles and rationales stay as they are for the
// CLI and the JSON report; this maps them to the short card copy. The research behind each check
// lives one click away, on the group's grade label.

import type { Suggestion } from '@citation-equity/engine';

export const STALE_MESSAGE = 'Out of date: the text changed.';

export interface FixCopy {
  title: string;
  reason: string;
}

/** `text` cut to at most `max` words, with an ellipsis when cut. */
function clip(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}…`;
}

/** The heading's text without its Markdown marks. */
const headingText = (before: string) => before.replace(/^#+\s*/, '').replace(/\s*#*\s*$/, '');

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Copier = (s: Suggestion, finding: string) => FixCopy;

/** By the engine's suggestion title, which is fixed per kind of fix. */
const BY_TITLE: Record<string, Copier> = {
  'Turn this enumeration into a list': () => ({
    title: 'Turn this into a list',
    reason: 'Three or more items in one sentence. A list is easier to scan and quote.',
  }),
  'Look for steps or options to list': () => ({
    title: 'Look for something to list',
    reason: 'No list yet. Steps or options read better as a list.',
  }),
  'Phrase this heading as a question': (s) => ({
    title: 'Make this heading a question',
    reason: `"${clip(headingText(s.before), 6)}" is a statement. Try the question a reader would type.`,
  }),
  'End this heading with "?", or reword it as a question': () => ({
    title: 'Add "?" or reword it',
    reason: 'Starts with a question word but has no "?". If "?" reads oddly, reword it.',
  }),
  'End this question heading with "?"': () => ({
    title: 'Add "?" to this question',
    reason: 'It already asks a question. A "?" makes that clear.',
  }),
  'Reword this heading as a question': () => ({
    title: 'Reword as a real question',
    reason: 'It reads as a label, not a question. Try the question a reader would ask.',
  }),
  'Make this paragraph stand on its own': (_, finding) => {
    const opener = /opens with "([^"]+)"/.exec(finding)?.[1];
    if (opener) {
      return {
        title: `Say what "${clip(opener, 2)}" refers to`,
        reason: `Opens with "${clip(opener, 2)}". Quoted alone, a reader can't tell what it means.`,
      };
    }
    const n = Number(/It has (\d+)/.exec(finding.replace(/,/g, ''))?.[1]);
    if (/too short/.test(finding)) {
      return {
        title: 'Give this paragraph more context',
        reason: `${Number.isFinite(n) ? plural(n, 'word') : 'Too few words'}, too short to make its point alone. Aim for 40 to 150.`,
      };
    }
    return {
      title: 'Split this long paragraph',
      reason: `${Number.isFinite(n) ? plural(n, 'word') : 'Many words'}. Aim for 40 to 150, one point each.`,
    };
  },
  'Lead this section with a direct answer': (_, finding) => {
    const hedge = /opens with "([^"]+)"/.exec(finding)?.[1];
    const n = /first sentence has (\d+)/.exec(finding)?.[1];
    let reason = 'Open with a plain answer of 8 to 40 words.';
    if (hedge) reason = `Opens with "${clip(hedge, 4)}". Give the answer first.`;
    else if (/opens with a question/.test(finding))
      reason = 'Opens with a question. Answer it first.';
    else if (n)
      reason = `The first sentence is ${plural(Number(n), 'word')}. Open with a plain answer of 8 to 40.`;
    else if (/no sentence/.test(finding))
      reason = 'Add one sentence that answers the heading, before the rest.';
    return { title: 'Lead with the answer', reason };
  },
  'Add a concrete number to this section': () => ({
    title: 'Add a real number',
    reason: 'No specific figure here. Add one you can source, only if it helps the reader.',
  }),
  'Add a comparison table': () => ({
    title: 'Add a comparison table',
    reason: 'This section compares options. A table shows them side by side.',
  }),
  'Turn this list into a table': () => ({
    title: 'Turn this list into a table',
    reason: 'Its "Key: value" items line up better as a two-column table.',
  }),
  'Consider a table for these values': () => ({
    title: 'Try a table here',
    reason: 'Its "Key: value" items may read better as a two-column table.',
  }),
  'Name who said this': () => ({
    title: 'Say who said this',
    reason: 'Add the speaker\'s name and role, like "Jane Doe, head roaster". Only real people.',
  }),
  'Add a quote from a named expert': () => ({
    title: 'Quote a named expert',
    reason: 'No quote from a named person yet. Quote only what someone really said.',
  }),
  'Link the source of this claim': () => ({
    title: 'Link the source',
    reason: 'This claim has no source. Link one that backs it, or cut the claim.',
  }),
  'Compare the options readers choose between': () => ({
    title: 'Compare the options',
    reason: 'Nothing here compares options. Say how the choices really differ.',
  }),
};

/** The first sentence of `text`, at most 20 words. */
const firstSentence = (text: string) => clip(text.split(/(?<=[.!?])\s+/)[0] ?? '', 20);

/**
 * The card copy for a fix. `finding` is what the check found at the fix's text (its finding
 * message), which some reasons quote ("Opens with "This"", "The first sentence is 4 words").
 */
export function fixCopy(s: Suggestion, finding = ''): FixCopy {
  const question = /^Answer "(.+)" directly$/.exec(s.title)?.[1];
  if (question) {
    return {
      title: `Answer "${question}" up front`,
      reason: 'Open the section with one plain sentence (8 to 40 words) that answers it.',
    };
  }
  const copier = BY_TITLE[s.title];
  if (copier) return copier(s, finding);
  return { title: clip(s.title, 6), reason: firstSentence(finding || s.rationale) };
}

/** One line of the draft text a fix is about, for its card. */
export function excerpt(text: string, max = 60): string {
  const line = text
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

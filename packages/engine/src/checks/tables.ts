/*
 * Comparison and Key: value detection adapted from:
 * - geo-lint (https://github.com/IJONIS/geo-lint), src/rules/geo-freshness-rules.ts
 *   `COMPARISON_PATTERNS` and rule `geo-comparison-table`, and src/utils/geo-analyzer.ts
 *   `hasMarkdownTable`, npm @ijonis/geo-lint 0.2.1, MIT License, Copyright (c) 2026 IJONIS.
 * - aiseo-audit (https://github.com/agencyenterprise/aiseo-audit),
 *   src/modules/product-fit/index.ts `COMPARISON_LANGUAGE` and the labeled-bullet idea of
 *   `SPEC_LABEL_LINE`, npm aiseo-audit 2.1.2, MIT License,
 *   Copyright (c) 2026 aiseo-audit contributors.
 * Changes: English patterns only; headings and prose use separate comparison patterns (now
 * in ./comparison-language, shared with the comparisons check); the fixed list of spec
 * labels is replaced by a generic short `Key: value` item rule (bold keys allowed); tables come from the parsed tree, not a regex; the check scores per section and
 * proposes a two-column table for a list made only of Key: value items.
 */
import type { Artifacts, ListBlock } from '../gather';
import type { CheckResult, Range } from '../types';
import { COMPARISON_HEADING, COMPARISON_PROSE } from './comparison-language';
import { type SuggestionDraft, suggester } from './data-support';
import { type CheckFn, notApplicable } from './types';

const BOLD_KEY = /^(\*\*|__)([^*_:\n]+?)(:?)\1(:?)[ \t]*(.*)$/;
const PLAIN_KEY = /^([^:\n]+?):[ \t]+(.*)$/;

interface KeyValue {
  key: string;
  value: string;
}

/**
 * Splits a one-line list item of the form `Key: value`, `**Key:** value` or `**Key**: value`.
 * The key is at most 40 characters and 5 words; the value is not empty.
 */
export function splitKeyValue(item: string): KeyValue | null {
  if (item.includes('\n')) return null;
  let key: string | undefined;
  let value: string | undefined;
  const bold = BOLD_KEY.exec(item);
  if (bold) {
    // Exactly one colon, inside or right after the bold key.
    if ((bold[3] === ':') === (bold[4] === ':')) return null;
    key = bold[2];
    value = bold[5];
  } else {
    const plain = PLAIN_KEY.exec(item);
    key = plain?.[1];
    value = plain?.[2];
  }
  key = key?.trim();
  value = value?.trim();
  if (!key || !value || key.length > 40 || key.split(/\s+/).length > 5) return null;
  return { key, value };
}

const escapeCell = (s: string) => s.replace(/(?<!\\)\|/g, '\\|');

/** A two-column Markdown table (`| Item | Detail |`) of the given pairs. */
function toTable(pairs: KeyValue[]): string {
  return [
    '| Item | Detail |',
    '| --- | --- |',
    ...pairs.map((p) => `| ${escapeCell(p.key)} | ${escapeCell(p.value)} |`),
  ].join('\n');
}

/** True when the list starts its line, so replacing it with a table keeps the structure. */
function startsLine(markdown: string, offset: number): boolean {
  const lineStart = markdown.lastIndexOf('\n', offset - 1) + 1;
  return markdown.slice(lineStart, offset) === '';
}

export const check: CheckFn = (a: Artifacts): CheckResult => {
  const slice = (r: Range) => a.markdown.slice(r.start, r.end);
  const keyValueLists = a.lists
    .map((list) => ({ list, pairs: list.items.map((item) => splitKeyValue(item.text)) }))
    .filter(({ pairs }) => pairs.filter((p) => p !== null).length >= 3);

  /** Per section that needs a table: where the comparison is, and its Key: value lists. */
  const needs: { index: number; comparison: Range | null; lists: typeof keyValueLists }[] = [];
  for (const [index, section] of a.sections.entries()) {
    const heading = section.headingIndex === null ? undefined : a.headings[section.headingIndex];
    let comparison: Range | null = null;
    if (heading && COMPARISON_HEADING.test(heading.text)) comparison = heading.range;
    for (const i of section.paragraphIndices) {
      if (comparison) break;
      const sentence = a.paragraphs[i]?.sentences.find((s) => COMPARISON_PROSE.test(s.plain));
      if (sentence) comparison = sentence.range;
    }
    const lists = keyValueLists.filter(({ list }) => list.sectionIndex === index);
    if (comparison || lists.length > 0) needs.push({ index, comparison, lists });
  }
  if (needs.length === 0) return notApplicable('tables');

  const withTable = needs.filter((n) => a.tables.some((t) => t.sectionIndex === n.index));
  const result: CheckResult = {
    checkId: 'tables',
    applicable: true,
    score: withTable.length / needs.length,
    findings: [],
    suggestions: [],
    metrics: {
      tables: a.tables.length,
      comparisonSections: needs.filter((n) => n.comparison).length,
      keyValueLists: keyValueLists.length,
      sectionsNeedingTable: needs.length,
      sectionsWithTable: withTable.length,
    },
  };

  const build = suggester('tables');
  const suggest = (draft: SuggestionDraft, message: string) => {
    result.findings.push({ checkId: 'tables', range: draft.range, message });
    result.suggestions.push(build(draft));
  };
  const listSuggestion = (list: ListBlock, pairs: (KeyValue | null)[]) => {
    const before = slice(list.range);
    const message = `This list has ${pairs.filter((p) => p !== null).length} "Key: value" items and no table near it.`;
    // A task checkbox or a hard-break backslash would be lost in a table cell, so those lists
    // get advice, not an edit.
    const complete =
      pairs.every((p) => p !== null && !p.value.endsWith('\\')) &&
      list.items.every((item) => item.checked === null);
    if (complete && startsLine(a.markdown, list.range.start)) {
      suggest(
        {
          kind: 'edit',
          range: list.range,
          before,
          after: toTable(pairs as KeyValue[]),
          title: 'Turn this list into a table',
          rationale: `${message} A two-column table keeps each value next to its label, with the same text.`,
        },
        message,
      );
    } else {
      suggest(
        {
          kind: 'advisory',
          range: list.range,
          before,
          title: 'Consider a table for these values',
          rationale: `${message} Laying the labels and values out as a two-column table keeps each value next to its label.`,
        },
        message,
      );
    }
  };

  for (const need of needs) {
    if (withTable.includes(need)) continue;
    for (const { list, pairs } of need.lists) listSuggestion(list, pairs);
    if (need.lists.length === 0 && need.comparison) {
      const message = 'This section compares options but has no table.';
      suggest(
        {
          kind: 'advisory',
          range: need.comparison,
          before: slice(need.comparison),
          title: 'Add a comparison table',
          rationale: `${message} A table with one row per option and one column per property lets a reader compare them at a glance.`,
        },
        message,
      );
    }
  }
  return result;
};

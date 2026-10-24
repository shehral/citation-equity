import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/direct-answer-lead';
import { EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/direct-answer-lead/fail.md?raw';
import pass from '../fixtures/checks/direct-answer-lead/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

describe('direct-answer-lead', () => {
  it('passes sections that open with a direct sentence of 8 to 40 words', () => {
    const r = run(pass);
    expect(r.checkId).toBe('direct-answer-lead');
    expect(r.applicable).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.suggestions).toEqual([]);
    // The lead section under the H1 is not judged.
    expect(r.metrics).toMatchObject({ sections: 3, directLeads: 3 });
  });

  it('flags hedged, short, list-only and question-first openings', () => {
    const r = run(fail);
    expect(r.applicable).toBe(true);
    expect(r.score).toBeLessThanOrEqual(0.2);
    expect(r.metrics).toMatchObject({ sections: 5, directLeads: 0 });
    expect(r.suggestions.map((s) => s.before)).toEqual([
      'It depends on many things, including your beans, your grinder and your machine.',
      'In this article we look at the settings that people change most often.',
      'Yes.',
      // No paragraph opens the section, so the advisory sits on its heading.
      'Which grinder should I buy?',
      'Is your water hard or soft? Hard water dulls flavour and scales the boiler.',
    ]);
    for (const s of r.suggestions) {
      expect(s.kind).toBe('advisory');
      expect(s.grade).toBe(EVIDENCE['direct-answer-lead'].grade);
      expect(slice(fail, s.range)).toBe(s.before);
    }
    const messages = r.findings.map((f) => f.message);
    expect(messages[0]).toMatch(/"It depends"/);
    expect(messages[1]).toMatch(/"In this article"/);
    expect(messages[2]).toMatch(/1 word\b/);
    expect(messages[3]).toMatch(/list/);
    expect(messages[4]).toMatch(/question/);
  });

  it('judges the first prose paragraph when a list, table or quote comes first', () => {
    const answer = 'A burr grinder, a scale and a tamper are all you need to start.';
    const md = [
      `## What do I need?\n\n- A grinder\n- A scale\n\n${answer}\n`,
      `## Which beans?\n\n| Roast | Taste |\n| - | - |\n| Light | Bright |\n\n${answer}\n`,
      `## Who says so?\n\n> Taste every shot.\n\n${answer}\n`,
      '## What else?\n\n- Water\n- Milk\n',
    ].join('\n');
    const r = run(md);
    expect(r.metrics).toMatchObject({ sections: 4, directLeads: 3 });
    expect(r.findings.map((f) => f.message)).toEqual([
      'The section has a list but no sentence that answers the heading.',
    ]);
    // A hedged or question-first paragraph after a list still fails.
    const hedged = run(
      '## What do I need?\n\n- A grinder\n\nIt depends on your budget and taste.\n',
    );
    expect(hedged.findings[0]?.message).toMatch(/"It depends"/);
  });

  it('reads a sentence that opens with an honorific as one sentence', () => {
    const md =
      '## Who should I ask?\n\nDr. Jane Doe, a coffee chemist at Example Lab, says to ask your roaster first.\n';
    expect(run(md).metrics).toMatchObject({ sections: 1, directLeads: 1 });
  });

  it('flags a first sentence over 40 words', () => {
    const long = `## Why?\n\nEspresso ${'tastes bitter when it runs long '.repeat(8)}today.\n`;
    const r = run(long);
    expect(r.metrics).toMatchObject({ sections: 1, directLeads: 0 });
    expect(r.findings[0]?.message).toMatch(/50 words/);
  });

  it('skips a heading with no content of its own', () => {
    const md =
      '## Brewing\n\n### Why grind finer?\n\nA finer grind slows the water and extracts more flavour.\n';
    const r = run(md);
    expect(r.metrics).toMatchObject({ sections: 1, directLeads: 1 });
    expect(r.score).toBe(1);
  });

  it('is not applicable without an H2 or H3 section', () => {
    const r = run('# Title\n\nSome text under the title only.\n');
    expect(r.applicable).toBe(false);
    expect(r.suggestions).toEqual([]);
  });
});

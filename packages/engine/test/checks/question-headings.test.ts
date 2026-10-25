import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/question-headings';
import { analyze, EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/question-headings/fail.md?raw';
import pass from '../fixtures/checks/question-headings/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

describe('question-headings', () => {
  it('still suggests, its heading edit included, and says every suggestion is not scored and why', () => {
    const note =
      'Not scored in Standard or By evidence: our own test (E3) found no effect larger than 0.03 (d -0.016, 90% CI [-0.028, -0.004], n 57, Holm p 0.164).';
    const md = '# Espresso\n\n## How to fix bitter espresso\n\nText.\n\n## Grind size\n\nText.\n';
    const r = run(md);
    expect(r.suggestions.length).toBe(2);
    expect(r.suggestions.some((s) => s.kind === 'edit' && s.after !== undefined)).toBe(true);
    for (const s of r.suggestions) expect(s.rationale).toContain(note);
  });

  it('passes H2/H3 headings phrased as questions', () => {
    const r = run(pass);
    expect(r.checkId).toBe('question-headings');
    expect(r.applicable).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.9);
    expect(r.suggestions).toEqual([]);
    expect(r.metrics).toMatchObject({ headings: 4, questionHeadings: 4 });
  });

  it('advises rephrasing each declarative heading, anchored on its text', () => {
    const r = run(fail);
    expect(r.applicable).toBe(true);
    expect(r.score).toBeLessThanOrEqual(0.2);
    expect(r.metrics).toMatchObject({ headings: 3, questionHeadings: 0 });
    expect(r.suggestions.map((s) => s.before)).toEqual([
      'Grind size',
      'Dose and **yield**',
      'Water temperature',
    ]);
    for (const s of r.suggestions) {
      expect(s.kind).toBe('advisory');
      expect(s.after).toBeUndefined();
      expect(s.grade).toBe(EVIDENCE['question-headings'].grade);
      expect(slice(fail, s.range)).toBe(s.before);
    }
    expect(r.findings).toHaveLength(3);
  });

  it('proposes adding "?" to a heading that starts with an interrogative', () => {
    const md = '## How do I fix bitter espresso\n\nGrind coarser.\n\n## Grind size\n\nText.\n';
    const r = run(md);
    expect(r.score).toBe(0.5);
    const edit = r.suggestions.find((s) => s.kind === 'edit');
    expect(edit).toBeDefined();
    expect(edit?.after).toBe('How do I fix bitter espresso?');
    expect(edit?.before).toBe('How do I fix bitter espresso');
    expect(slice(md, edit?.range ?? { start: 0, end: 0 })).toBe('How do I fix bitter espresso');
    expect(edit?.grade).toBe(EVIDENCE['question-headings'].grade);
    expect(r.suggestions.filter((s) => s.kind === 'advisory').map((s) => s.before)).toEqual([
      'Grind size',
    ]);
    expect(r.metrics.missingQuestionMark).toBe(1);
  });

  it('keeps inline markup and drops trailing punctuation in the edit', () => {
    const r = run('## What is **crema**:\n\nFoam.\n\n## Why do baristas `tamp`\n\nEven.\n');
    expect(r.suggestions.map((s) => [s.before, s.after])).toEqual([
      ['What is **crema**:', 'What is **crema**?'],
      ['Why do baristas `tamp`', 'Why do baristas `tamp`?'],
    ]);
  });

  it('counts auxiliary-led and "?"-ended headings, and edits interrogative-led ones', () => {
    const md = [
      '## Is a burr grinder worth it',
      '## Grinders compared?',
      "## What's crema",
      '## How to dial in a grinder',
      '## Why espresso turns bitter',
      '## How much coffee should I use',
    ].join('\n\nText.\n\n');
    const r = run(md);
    expect(r.metrics).toMatchObject({ headings: 6, questionHeadings: 6, missingQuestionMark: 4 });
    expect(r.score).toBe(1);
    expect(r.suggestions.filter((s) => s.kind === 'advisory')).toEqual([]);
    // "Is ..." starts with an auxiliary, not an interrogative, so it gets no edit.
    expect(r.suggestions.map((s) => [s.before, s.after])).toEqual([
      ["What's crema", "What's crema?"],
      ['How to dial in a grinder', 'How to dial in a grinder?'],
      ['Why espresso turns bitter', 'Why espresso turns bitter?'],
      ['How much coffee should I use', 'How much coffee should I use?'],
    ]);
    for (const s of r.suggestions) expect(slice(md, s.range)).toBe(s.before);
  });

  it('offers no "?" edit for a question word followed by a subject, and does not count it', () => {
    const md = [
      '## What we learned',
      '## Why it matters',
      '## Who we are',
      "## How it's made",
      '## Why your shot runs fast',
      '## How to dial in a grinder',
    ].join('\n\nText.\n\n');
    const r = run(md);
    expect(r.metrics).toMatchObject({ headings: 6, questionHeadings: 1, missingQuestionMark: 1 });
    expect(r.suggestions.map((s) => [s.kind, s.before, s.after])).toEqual([
      ['advisory', 'What we learned', undefined],
      ['advisory', 'Why it matters', undefined],
      ['advisory', 'Who we are', undefined],
      ['advisory', "How it's made", undefined],
      ['advisory', 'Why your shot runs fast', undefined],
      ['edit', 'How to dial in a grinder', 'How to dial in a grinder?'],
    ]);
    expect(r.suggestions[0]?.title).toBe('Reword this heading as a question');
    // Already a question: no advisory.
    expect(run('## What we learned?\n\nA.\n\n## How it works?\n\nB.\n').suggestions).toEqual([]);
  });

  it('reads a contracted question word as a question, not a relative clause', () => {
    const md = ["## What's your budget", "## Who's it for", "## How's your grinder"].join(
      '\n\nText.\n\n',
    );
    const r = run(`${md}\n\nText.\n`);
    expect(r.score).toBe(1);
    expect(r.metrics).toMatchObject({ headings: 3, questionHeadings: 3, missingQuestionMark: 3 });
    expect(r.suggestions.map((s) => [s.kind, s.after])).toEqual([
      ['edit', "What's your budget?"],
      ['edit', "Who's it for?"],
      ['edit', "How's your grinder?"],
    ]);
  });

  it('does not credit labels that open with an auxiliary-like word', () => {
    const r = run(
      '## May 2024 update\n\nA.\n\n## Must-have tools\n\nB.\n\n## Can I use it\n\nC.\n',
    );
    expect(r.metrics).toMatchObject({ headings: 3, questionHeadings: 1 });
    expect(r.suggestions.map((s) => s.before)).toEqual(['May 2024 update', 'Must-have tools']);
  });

  it('offers no edit for a heading that already holds a "?"', () => {
    const r = run('## Why widgets? 🚀 Ünïcödé\n\nA.\n\n## Grind size\n\nB.\n');
    expect(r.metrics).toMatchObject({ headings: 2, questionHeadings: 1, missingQuestionMark: 0 });
    expect(r.suggestions.map((s) => s.before)).toEqual(['Grind size']);
  });

  it('skips an empty heading', () => {
    const r = run('##\n\nA.\n\n## Grind size\n\nB.\n\n## Is it fresh?\n\nC.\n');
    expect(r.metrics).toMatchObject({ headings: 2, questionHeadings: 1 });
    expect(r.suggestions.map((s) => s.before)).toEqual(['Grind size']);
    expect(run('##\n\nA.\n\n## Grind size\n\nB.\n').applicable).toBe(false);
  });

  it('edits a non-inverted interrogative heading and notes it may need rewording', () => {
    const md =
      '## How to fix bitter espresso\n\nGrind coarser.\n\n## Why espresso tastes bitter\n\nHeat.\n';
    const r = run(md);
    expect(r.score).toBe(1);
    expect(r.suggestions.map((s) => [s.kind, s.after])).toEqual([
      ['edit', 'How to fix bitter espresso?'],
      ['edit', 'Why espresso tastes bitter?'],
    ]);
    for (const s of r.suggestions) {
      expect(s.title).toMatch(/reword/);
      expect(slice(md, s.range)).toBe(s.before);
    }
    const inverted = run('## How do I fix bitter espresso\n\nA.\n\n## Grind size\n\nB.\n');
    expect(inverted.suggestions.find((s) => s.kind === 'edit')?.title).not.toMatch(/reword/);
  });

  it('ignores H1 and H4 headings', () => {
    const r = run('# Title\n\n## Grind size\n\n#### Notes\n\n### Is it fresh?\n');
    expect(r.metrics).toMatchObject({ headings: 2, questionHeadings: 1 });
  });

  it('is not applicable with fewer than two H2/H3 headings', () => {
    const r = run('# Title\n\n## Grind size\n\nText.\n\n#### Notes\n');
    expect(r.applicable).toBe(false);
    expect(r.suggestions).toEqual([]);
  });

  it('returns identical suggestion ids across two analyze calls', () => {
    const ids = (md: string) =>
      analyze(md)
        .checks.find((c) => c.checkId === 'question-headings')
        ?.suggestions.map((s) => s.id);
    const first = ids(fail);
    expect(first).toHaveLength(3);
    expect(ids(fail)).toEqual(first);
  });
});

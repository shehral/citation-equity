import { describe, expect, it } from 'vitest';
import { check, contentTerms } from '../../src/checks/question-coverage';
import { analyze, EVIDENCE, gather, parseDraft, questionCoverage } from '../../src/index';
import espresso from '../fixtures/checks/question-coverage/espresso.md?raw';

const run = (md: string, questions?: string[]) =>
  check(gather(parseDraft(md)), questions === undefined ? undefined : { questions });
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

const SHOT = 'How long should an espresso shot take?';
const WATER = 'What water temperature is best?';

describe('question-coverage', () => {
  it('does not apply without target questions', () => {
    expect(run(espresso).applicable).toBe(false);
    expect(run(espresso, []).applicable).toBe(false);
    expect(run(espresso, ['  ', '']).applicable).toBe(false);
    const viaAnalyze = analyze(espresso).checks.find((c) => c.checkId === 'question-coverage');
    expect(viaAnalyze).toMatchObject({ applicable: false, score: 0, suggestions: [] });
  });

  it('covers a question whose matching section opens with a direct answer', () => {
    const r = run(espresso, [SHOT]);
    expect(r).toMatchObject({ checkId: 'question-coverage', applicable: true, score: 1 });
    expect(r.metrics).toEqual({ questions: 1, covered: 1 });
    expect(r.suggestions).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('covers a question answered by a sentence that opens with an honorific', () => {
    const md =
      '## Who roasts the beans?\n\nDr. Jane Doe, a coffee chemist at Example Lab, roasts the beans every week.\n';
    expect(run(md, ['Who roasts the beans?']).metrics).toEqual({ questions: 1, covered: 1 });
  });

  it('advises answering a question the draft does not answer', () => {
    const r = run(espresso, [SHOT, WATER]);
    expect(r.score).toBe(0.5);
    expect(r.metrics).toEqual({ questions: 2, covered: 1 });
    expect(r.suggestions).toHaveLength(1);
    const [s] = r.suggestions;
    expect(s?.title).toBe(`Answer "${WATER}" directly`);
    expect(s?.kind).toBe('advisory');
    expect(s?.grade).toBe(EVIDENCE['question-coverage'].grade);
    expect(s?.after).toBeUndefined();
    expect(slice(espresso, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
    expect(s?.rationale).toContain('What Gets Cited');
    expect(s?.rationale).toContain(`Evidence grade: ${EVIDENCE['question-coverage'].grade}.`);
    // The measured E1 label: effect, interval and models.
    expect(s?.rationale).toContain(
      'Measured in our own test (E1): helps, possibly through length or query-term overlap (d +0.027, 95% CI [+0.010, +0.043], n 54, Holm p 0.006; Gemma-4-12B and Qwen3.8-27B judges, Gemma-edited).',
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.range).toEqual(s?.range);
  });

  it('anchors on the matching heading when its section does not answer', () => {
    const md = [
      '# Espresso',
      '',
      '## Grind size',
      '',
      'Grind size matters.',
      '',
      '## How long should an espresso shot take?',
      '',
      'Is there a right answer for every coffee and every machine at home?',
      '',
    ].join('\n');
    const r = run(md, [SHOT]);
    expect(r.score).toBe(0);
    expect(r.suggestions[0]?.before).toBe(SHOT);
    expect(r.findings[0]?.message).toMatch(/question/);
  });

  it('requires 8 to 40 words and most of the key words in the opening sentence', () => {
    const heading = '## How long should an espresso shot take?\n\n';
    expect(run(`${heading}About 25 to 30 seconds.\n`, [SHOT]).score).toBe(0);
    expect(
      run(`${heading}It depends on the beans you buy and how fresh they are today.\n`, [SHOT])
        .score,
    ).toBe(0);
    const long = `An espresso shot should take ${'many '.repeat(40)}seconds.`;
    expect(run(`${heading}${long}\n`, [SHOT]).score).toBe(0);
  });

  it('falls back to the paragraph whose first sentence matches best', () => {
    const md = [
      '# Notes from the cafe',
      '',
      'Most of the morning goes to steaming milk for regulars.',
      '',
      'A good espresso shot should take 25 to 30 seconds in total.',
      '',
    ].join('\n');
    expect(run(md, [SHOT]).score).toBe(1);
    const miss = run(md, ['Why does steamed milk taste sweet?']);
    expect(miss.score).toBe(0);
    expect(miss.suggestions[0]?.before).toBe(
      'Most of the morning goes to steaming milk for regulars.',
    );
  });

  it('anchors at the top of the draft when nothing matches the question', () => {
    const r = run(espresso, ['Which bank offers the lowest mortgage rate?']);
    expect(r.score).toBe(0);
    expect(r.suggestions[0]?.before).toBe('Pulling a good espresso shot');
  });

  it('gives distinct ids per question, stable when the questions are reordered', () => {
    const a = 'Which bank offers the lowest mortgage rate?';
    const b = 'When do tax returns open?';
    const first = run(espresso, [a, b]).suggestions;
    const second = run(espresso, [b, a]).suggestions;
    expect(first).toHaveLength(2);
    expect(new Set(first.map((s) => s.id)).size).toBe(2);
    const idOf = (list: typeof first, q: string) =>
      list.find((s) => s.title === `Answer "${q}" directly`)?.id;
    expect(idOf(first, a)).toBe(idOf(second, a));
    expect(idOf(first, b)).toBe(idOf(second, b));
  });

  it('extracts lowercased, stemmed content terms without stopwords', () => {
    expect(contentTerms(SHOT)).toEqual(new Set(['long', 'espresso', 'shot', 'tak']));
    expect(contentTerms('Which grinders are taking time?')).toEqual(
      contentTerms('which grinder takes times'),
    );
    expect(contentTerms('What is it?').size).toBeGreaterThan(0);
  });

  it('stems inflected forms to the same term as the base word', () => {
    for (const [a, b] of [
      ['add', 'adding'],
      ['use', 'using'],
      ['use', 'used'],
      ['bring', 'brings'],
      ['need', 'needs'],
      ['stop', 'stopping'],
      ['taste', 'tasted'],
      ['class', 'classes'],
      ['berry', 'berries'],
    ])
      expect(contentTerms(`${b}`), `${a} / ${b}`).toEqual(contentTerms(`${a}`));
  });

  it('reports each question with its status and where it is answered or should be', () => {
    const a = gather(parseDraft(espresso));
    const rows = questionCoverage(a, [SHOT, '  ', WATER]);
    expect(rows.map((r) => [r.question, r.covered])).toEqual([
      [SHOT, true],
      [WATER, false],
    ]);
    expect(slice(espresso, rows[0]?.range ?? { start: 0, end: 0 })).toBe(SHOT);
    expect(rows[0]?.message).toBeNull();
    const advisory = run(espresso, [WATER]).suggestions[0];
    expect(rows[1]?.range).toEqual(advisory?.range);
    expect(rows[1]?.message).toBe(run(espresso, [WATER]).findings[0]?.message);
  });
});

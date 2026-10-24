import { describe, expect, it } from 'vitest';
import { check } from '../../src/checks/tables';
import { analyze, EVIDENCE, gather, parseDraft } from '../../src/index';
import fail from '../fixtures/checks/tables/fail.md?raw';
import pass from '../fixtures/checks/tables/pass.md?raw';

const run = (md: string) => check(gather(parseDraft(md)));
const slice = (md: string, r: { start: number; end: number }) => md.slice(r.start, r.end);

const SETTINGS_TABLE = [
  '| Item | Detail |',
  '| --- | --- |',
  '| Grind | fine |',
  '| Dose | 18 g |',
  '| Time | 28 s |',
].join('\n');

describe('tables check', () => {
  it('passes when every comparison section has a table', () => {
    const result = run(pass);
    expect(result.checkId).toBe('tables');
    expect(result.applicable).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.suggestions).toEqual([]);
    expect(result.metrics).toMatchObject({ tables: 2, comparisonSections: 1, keyValueLists: 1 });
  });

  it('fails a comparison and a Key: value list with no table', () => {
    const result = run(fail);
    expect(result.applicable).toBe(true);
    expect(result.score).toBeLessThanOrEqual(0.2);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    for (const s of result.suggestions) {
      expect(slice(fail, s.range)).toBe(s.before);
      expect(s.grade).toBe(EVIDENCE.tables.grade);
    }
    const [advisory, edit] = result.suggestions;
    expect(advisory?.kind).toBe('advisory');
    expect(advisory?.before).toBe('Moka pot vs espresso machine');
    expect(edit?.kind).toBe('edit');
    expect(edit?.before).toBe('- **Grind:** fine\n- **Dose:** 18 g\n- **Time:** 28 s');
    expect(edit?.after).toBe(SETTINGS_TABLE);
    expect(result.findings).toHaveLength(2);
  });

  it('does not apply to prose with no comparison and no Key: value list', () => {
    const result = run('# Espresso\n\nPull a shot and taste it.\n\n- Grind\n- Tamp\n- Pull\n');
    expect(result.applicable).toBe(false);
  });

  it('turns a plain Key: value list into a two-column table', () => {
    const md = '## Settings\n\n- Grind: fine\n- Dose: 18 g\n- Time: 28 s\n';
    const result = run(md);
    expect(result.applicable).toBe(true);
    expect(result.score).toBe(0);
    expect(result.suggestions).toHaveLength(1);
    const [s] = result.suggestions;
    expect(s?.kind).toBe('edit');
    expect(s?.before).toBe('- Grind: fine\n- Dose: 18 g\n- Time: 28 s');
    expect(slice(md, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
    expect(s?.after).toBe(SETTINGS_TABLE);

    // Applying the edit yields a real table with a header and 3 body rows.
    const applied = md.slice(0, s?.range.start) + s?.after + md.slice(s?.range.end);
    const tables = gather(parseDraft(applied)).tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ rows: 4, cols: 2 });
    // With the list gone nothing asks for a table any more.
    expect(run(applied).applicable).toBe(false);
  });

  it('reads bold keys with the colon inside or outside the bold', () => {
    const md = '- **Grind**: fine\n- __Dose:__ 18 g\n- **Time:** 28 s\n';
    expect(run(md).suggestions[0]?.after).toBe(SETTINGS_TABLE);
  });

  it('keeps inline markup in values and escapes pipes', () => {
    const md = '- Grind: *fine*\n- Dose: 18 g | double\n- Basket: [VST](https://example.org/vst)\n';
    expect(run(md).suggestions[0]?.after).toBe(
      [
        '| Item | Detail |',
        '| --- | --- |',
        '| Grind | *fine* |',
        '| Dose | 18 g \\| double |',
        '| Basket | [VST](https://example.org/vst) |',
      ].join('\n'),
    );
  });

  it('gives advice instead of an edit when not every item is a Key: value pair', () => {
    const md = '- Grind: fine\n- Dose: 18 g\n- Time: 28 s\n- Taste the shot before serving\n';
    const [s] = run(md).suggestions;
    expect(s?.kind).toBe('advisory');
    expect(s?.after).toBeUndefined();
    expect(slice(md, s?.range ?? { start: 0, end: 0 })).toBe(s?.before);
  });

  it('gives advice instead of an edit for task items or a trailing backslash', () => {
    for (const md of [
      '- [x] Grind: fine\n- [ ] Dose: 18 g\n- [x] Time: 28 s\n',
      '- Grind: fine\\\n- Dose: 18 g\n- Time: 28 s\n',
    ]) {
      const [s] = run(md).suggestions;
      expect(s?.kind, md).toBe('advisory');
      expect(s?.after, md).toBeUndefined();
    }
  });

  it('gives advice instead of an edit for a list inside a blockquote', () => {
    const md = '> - Grind: fine\n> - Dose: 18 g\n> - Time: 28 s\n';
    const [s] = run(md).suggestions;
    expect(s?.kind).toBe('advisory');
  });

  it('does not read URLs or clock times as Key: value pairs', () => {
    const md = '- https://example.org/a\n- Opens 7:30 daily\n- Closes 18:00\n';
    expect(run(md).applicable).toBe(false);
  });

  it('flags a comparison sentence in prose', () => {
    const md =
      '## Grinders\n\nA burr grinder compared with a blade grinder gives a far more even grind.\n';
    const result = run(md);
    expect(result.applicable).toBe(true);
    expect(result.score).toBe(0);
    expect(result.suggestions[0]?.before).toBe(
      'A burr grinder compared with a blade grinder gives a far more even grind.',
    );
  });

  it('gives the same suggestion ids on every run', () => {
    const ids = () =>
      analyze(fail)
        .checks.find((c) => c.checkId === 'tables')
        ?.suggestions.map((s) => s.id);
    expect(ids()).toHaveLength(2);
    expect(new Set(ids()).size).toBe(2);
    expect(ids()).toEqual(ids());
  });
});

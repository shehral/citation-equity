// `ce sources --tranco`: the cited sites labelled big, mid or small by a Tranco list on disk.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/node/cli';

const dirs: string[] = [];
async function file(name: string, text: string) {
  const dir = await mkdtemp(join(tmpdir(), 'ce-sources-tranco-'));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, text);
  return path;
}
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

async function ce(args: string[]) {
  let stdout = '';
  let stderr = '';
  const fetchImpl = vi.fn(async () => {
    throw new Error('no request expected');
  });
  const code = await runCli(args, {
    stdout: (s) => {
      stdout += s;
    },
    stderr: (s) => {
      stderr += s;
    },
    fetch: fetchImpl as unknown as typeof fetch,
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  return { code, stdout, stderr };
}

/** A million-deep list: reddit.com big, regionalnews.com mid, everything unlisted small. */
function fullList(): string {
  const lines = ['1,google.com', '2,reddit.com'];
  for (let r = 3; r <= 20_000; r++) lines.push(`${r},filler${r}.com`);
  lines.push('20001,regionalnews.com');
  for (let r = 20_002; r <= 1_000_000; r++) lines.push(`${r},f${r}.net`);
  return lines.join('\n');
}

const PASTED = `Q: How do bees stay warm in winter?
They cluster [1][2][3].
1. https://www.reddit.com/r/Beekeeping/comments/abc/
2. https://en.wikipedia.org/wiki/Honey_bee
3. https://hivecraft-notes.example/winter

Q: Should I wrap my hive?
Usually not [1][2].
1. https://hivecraft-notes.example/wraps
2. https://regionalnews.com/bees
`;

describe('ce sources --tranco', () => {
  it('labels every cited site and sums the citations by size', async () => {
    const pasted = await file('answers.txt', PASTED);
    const list = await file('tranco_TEST1.csv', fullList());
    const { code, stdout } = await ce(['sources', '--pasted', pasted, '--tranco', list]);
    expect(code).toBe(0);
    expect(stdout).toContain(
      'Site sizes (Tranco list TEST1, top 1,000,000 sites): small sites got 2 of 4 citations (big 1, mid 1).',
    );
    expect(stdout).toContain('Counted apart: Wikipedia 1.');
    const row = (domain: string) => stdout.split('\n').find((l) => l.trim().startsWith(domain));
    expect(row('reddit.com')).toMatch(/1 of 2 answers {2}Big site$/);
    expect(row('regionalnews.com')).toMatch(/Mid-size site$/);
    expect(row('hivecraft-notes.example')).toMatch(/2 of 2 answers {2}Small site$/);
    expect(row('wikipedia.org')).toMatch(/Wikipedia$/);
  });

  it('prints exactly what it printed before when the flag is not given', async () => {
    const pasted = await file('answers.txt', PASTED);
    const { stdout } = await ce(['sources', '--pasted', pasted]);
    expect(stdout).not.toContain('Site sizes');
    expect(stdout).not.toMatch(/Big site|Small site/);
  });

  it('fails with a readable message for a file that is not a Tranco list', async () => {
    const pasted = await file('answers.txt', PASTED);
    const bad = await file('list.csv', '1,a.com\n3,b.com\n');
    const { code, stderr } = await ce(['sources', '--pasted', pasted, '--tranco', bad]);
    expect(code).toBe(1);
    expect(stderr).toContain('rank 3 where 2 was expected');
  });
});

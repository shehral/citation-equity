import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PackError } from '../src/index';
import { loadPack } from '../src/node/load-pack';

const TINY = fileURLToPath(new URL('fixtures/tiny-pack.json', import.meta.url));

let dir: string | undefined;
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe('loadPack', () => {
  it('reads and validates a pack file', async () => {
    const pack = await loadPack(TINY);
    expect(pack.packId).toBe('tiny-espresso');
    expect(pack.queries.map((q) => q.queryId)).toEqual(['q1', 'q2']);
  });

  it('names the file when it is not JSON, and throws PackError when the schema is wrong', async () => {
    dir = await mkdtemp(join(tmpdir(), 'ce-pack-'));
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'wrong.json'), '{"schemaVersion": 2}');
    await expect(loadPack(join(dir, 'broken.json'))).rejects.toThrow(
      /broken\.json is not valid JSON/,
    );
    await expect(loadPack(join(dir, 'wrong.json'))).rejects.toBeInstanceOf(PackError);
  });

  it('says it cannot read a missing file, as the other ce inputs do', async () => {
    await expect(loadPack('/nonexistent/nope.json')).rejects.toThrow(
      'Cannot read /nonexistent/nope.json (ENOENT)',
    );
  });
});

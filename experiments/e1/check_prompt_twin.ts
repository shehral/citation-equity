// Checks that build_prompts.py's Python twin of buildPrompt is byte-identical to the prompts
// `ce bench --export-prompts` writes (PREREG_E1.md r2, Measurement 2), on 10 prompts.
//
// It runs `ce bench --export-prompts` (in process, through the bench's own CLI) on a fixture pack
// with awkward text: `$` replacement patterns, "{query}" and "{source_text}" in the query and in
// page text, titles with JavaScript-only and Python-only whitespace, an empty title, CRLF, CJK and
// astral characters. For each exported prompt it rebuilds the bench's source order with the same
// retrieve() and shuffle() runBench uses, asks the Python twin for the prompt, and compares bytes.
// Exit code 0 when all 10 match, 1 otherwise.
//
// Run from the repository root:
//   pnpm --filter @citation-equity/bench exec tsx --conditions=@citation-equity/source \
//     "$PWD/experiments/e1/check_prompt_twin.ts"
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PromptLine } from '../../packages/bench/src/node/batch';
import { runCli } from '../../packages/bench/src/node/cli';
import { retrieve } from '../../packages/bench/src/retrieve';
import { shuffle } from '../../packages/bench/src/rng';
import type { Pack, PackDocument } from '../../packages/bench/src/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = 5;

function doc(docId: string, title: string, text: string): PackDocument {
  return { docId, title, text, synthetic: true };
}

const PACK: Pack = {
  schemaVersion: 1,
  packId: 'twin-check',
  title: 'Prompt twin check',
  source: 'written for this check',
  license: 'MIT',
  synthetic: true,
  queries: [
    {
      queryId: 'q1',
      query: 'Why does espresso taste bitter {source_text} $& $1?',
      documents: [
        doc(
          'd1',
          '  Padded espresso title \u00a0',
          'Espresso tastes bitter when over-extracted. Costs $5, $& and $$.',
        ),
        doc(
          'd2',
          '\ufeffBOM espresso\u2028',
          'Bitter espresso: {query} and {source_text} stay literal.\r\nCRLF line.',
        ),
        doc('d3', '', 'No title. Espresso bitter notes in 日本語 and \u{1d400}\u{1d401} letters.'),
      ],
    },
    {
      queryId: 'q2',
      query: 'What is retrieval augmented generation?',
      documents: [
        doc(
          'r1',
          '\u001cGroup separator retrieval\u001c',
          'Retrieval augmented generation, step one.',
        ),
        doc('r2', '\t', 'Retrieval with a tab-only title.\n\n## Heading\n\n- item [1]'),
        doc('r3', 'Retrieval generation', 'Generation after retrieval. Français, Español.'),
      ],
    },
  ],
};

const DRAFT =
  '# Espresso and retrieval draft #  \n\nEspresso tastes bitter; retrieval augmented generation helps.\n';

/** The draft title exactly as `ce bench` reads it (readDraft in packages/bench/src/node/cli.ts). */
function draftTitle(markdown: string): string {
  return /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown)?.[1] ?? 'draft';
}

async function main(): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'e1-twin-'));
  const packPath = join(dir, 'pack.json');
  const draftPath = join(dir, 'draft.md');
  const promptsPath = join(dir, 'prompts.jsonl');
  writeFileSync(packPath, JSON.stringify(PACK));
  writeFileSync(draftPath, DRAFT);

  const code = await runCli(
    [
      'bench',
      '--draft',
      draftPath,
      '--pack',
      packPath,
      '--model',
      'twin-check',
      '--k',
      '4',
      '--runs',
      String(RUNS),
      '--export-prompts',
      promptsPath,
    ],
    { stdout: () => {}, stderr: (s) => process.stderr.write(s) },
  );
  if (code !== 0) throw new Error(`ce bench --export-prompts exited with ${code}`);
  const lines: PromptLine[] = readFileSync(promptsPath, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  if (lines.length !== 10) throw new Error(`expected 10 exported prompts, got ${lines.length}`);

  const draftDoc = doc('draft', draftTitle(DRAFT), DRAFT);
  const cases = lines.map((line) => {
    const q = PACK.queries.find((x) => x.queryId === line.queryId);
    if (!q) throw new Error(`unknown query ${line.queryId}`);
    const retrieved = retrieve([...q.documents, draftDoc], q.query, 4);
    if (retrieved.length !== 4)
      throw new Error(`query ${q.queryId}: ${retrieved.length} of 4 retrieved`);
    const order = shuffle(retrieved, line.seed);
    return { query: q.query, sources: order.map((d) => ({ title: d.title, text: d.text })) };
  });
  const casesPath = join(dir, 'cases.json');
  const twinPath = join(dir, 'twin.json');
  writeFileSync(casesPath, JSON.stringify(cases));
  const py = spawnSync(
    'python3',
    ['-I', join(HERE, 'build_prompts.py'), '--twin', casesPath, '--twin-out', twinPath],
    { encoding: 'utf8' },
  );
  if (py.status !== 0) throw new Error(`build_prompts.py --twin failed:\n${py.stderr}`);
  const twin: string[] = JSON.parse(readFileSync(twinPath, 'utf8'));

  let mismatches = 0;
  lines.forEach((line, i) => {
    const same = Buffer.from(line.prompt, 'utf8').equals(Buffer.from(twin[i], 'utf8'));
    if (!same) {
      mismatches++;
      const at = [...line.prompt].findIndex((ch, k) => ch !== [...twin[i]][k]);
      process.stderr.write(
        `prompt ${i + 1} (${line.queryId}, seed ${line.seed}) differs at character ${at}\n`,
      );
    }
  });
  const bytes = lines.reduce((n, l) => n + Buffer.byteLength(l.prompt, 'utf8'), 0);
  process.stdout.write(
    `check_prompt_twin: ${lines.length - mismatches} of ${lines.length} prompts byte-identical (${bytes} bytes compared)\n`,
  );
  return mismatches === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `check_prompt_twin: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);

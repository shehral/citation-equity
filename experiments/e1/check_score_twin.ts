// Checks score.py's Python twins of parseAnswer (packages/bench/src/prompt.ts) and pawcShares
// (packages/bench/src/metrics.ts) against the TypeScript originals on awkward answers: markers with
// punctuation, out-of-range and spaced markers, quotes after full stops, line breaks, U+2028, CJK,
// hyphens, curly apostrophes and astral letters. Sentences, citation numbers and PAWC shares must be
// identical (shares compared as exact doubles). Exit code 0 when all match, 1 otherwise.
//
// Run from the repository root:
//   pnpm --filter @citation-equity/bench exec tsx --conditions=@citation-equity/source \
//     "$PWD/experiments/e1/check_score_twin.ts"

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { pawcShares } from '../../packages/bench/src/metrics';
import { parseAnswer } from '../../packages/bench/src/prompt';

const HERE = dirname(fileURLToPath(import.meta.url));

const ANSWERS = [
  'Espresso tastes bitter when over-extracted [1]. Grind coarser [2][3].',
  'First sentence. [1] Second one? [2][4] Third! [3]',
  'He said "it is bitter." [2] Then (briefly.) [1]\nA new line [4]',
  'Markers [1,] [*2*] [ 3] [Source 4] [0] [5] [12] count only in range.',
  'No citation at all.',
  'U.S. baristas’ well-known tips [1]. 日本語の文 [2]。 \u{1d400}\u{1d401}\u{1d402} wins, \u{1d403}\u{1d404} too [3].',
  'Line\u2028separator stays [1]. Tab\tand\u00a0nbsp [2].',
  'Repeated [1][1][1]. Mixed [4][2]. Last [3]',
  '\n\n  Leading blank lines [2].  \n\nTrailing  ',
  'Ellipsis... [1] Question?! [2] Quote.” [3] Done.',
];

function tsTwin(answer: string) {
  const parsed = parseAnswer(answer);
  return { sentences: parsed.sentences, pawc: pawcShares(parsed, 4) };
}

const dir = mkdtempSync(join(tmpdir(), 'e1-score-twin-'));
const inPath = join(dir, 'answers.json');
const outPath = join(dir, 'twin.json');
writeFileSync(inPath, JSON.stringify(ANSWERS));
const py = spawnSync(
  'python3',
  ['-I', join(HERE, 'score.py'), '--twin', inPath, '--twin-out', outPath],
  { encoding: 'utf8' },
);
if (py.status !== 0) {
  process.stderr.write(`score.py --twin failed:\n${py.stderr}`);
  process.exit(1);
}
const python = JSON.parse(readFileSync(outPath, 'utf8'));
let mismatches = 0;
ANSWERS.forEach((answer, i) => {
  const ts = tsTwin(answer);
  if (!isDeepStrictEqual(ts, python[i])) {
    mismatches++;
    process.stderr.write(
      `answer ${i + 1} differs\n  ts: ${JSON.stringify(ts)}\n  py: ${JSON.stringify(python[i])}\n`,
    );
  }
});
process.stdout.write(
  `check_score_twin: ${ANSWERS.length - mismatches} of ${ANSWERS.length} answers parse and score identically\n`,
);
process.exit(mismatches === 0 ? 0 : 1);

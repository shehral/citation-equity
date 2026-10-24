// Builds the frozen (query, arm) applicability table of E1 (experiments/PREREG_E1.md, Applicability).
// For each target in pages.jsonl it runs the engine (as `ce analyze --json --questions <query>`
// would, in-process), writes the result to engine_original.jsonl, takes the arm 11-14 feature rows
// from deterministic_arms.py, and writes applicability.jsonl: {query_id, arm, applicable, reason}
// for arms 1-14 and ALL. Placebos follow their arm (P_A is built only when A's edit is valid).
//
// Run from the repository root:
//   pnpm --filter @citation-equity/bench exec tsx "$PWD/experiments/e1/applicability.ts" [--data <dir>]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { allApplicability } from './e1_lib';
import { engineJson } from './engine_json';

const here = import.meta.dirname;
const { values } = parseArgs({
  options: {
    data: { type: 'string', default: join(here, 'data') },
    python: { type: 'string', default: 'python3' },
  },
});
const data = resolve(values.data as string);

interface Page {
  page_id: string;
  query_id: string;
  set: string;
  query: string;
  role: string;
  title: string;
  text: string;
}
const readJsonl = <T>(file: string): T[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as T);

const pages = readJsonl<Page>(join(data, 'pages.jsonl'));
const targets = pages.filter((p) => p.role === 'target');
const donors = new Set(pages.filter((p) => p.role === 'donor').map((p) => p.query_id));

const engineFile = join(data, 'engine_original.jsonl');
const engines = new Map(targets.map((t) => [t.query_id, engineJson(t.text, t.query)]));
const engineLines = targets.map((t) =>
  JSON.stringify({ id: t.page_id, query_id: t.query_id, ...engines.get(t.query_id) }),
);
writeFileSync(engineFile, `${engineLines.join('\n')}\n`);

const featureOut = execFileSync(
  values.python as string,
  [
    '-I',
    join(here, 'deterministic_arms.py'),
    'features',
    '--pages',
    join(data, 'pages.jsonl'),
    '--engine',
    engineFile,
  ],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
);
const features = new Map<string, { arm: string; applicable: boolean; reason: string | null }[]>();
for (const line of featureOut.split('\n')) {
  if (line.trim() === '') continue;
  const row = JSON.parse(line) as {
    query_id: string;
    arm: string;
    applicable: boolean;
    reason: string | null;
  };
  features.set(row.query_id, [...(features.get(row.query_id) ?? []), row]);
}

const rows = targets.flatMap((t) => {
  const eng = engines.get(t.query_id);
  if (!eng) throw new Error(`no engine result for ${t.query_id}`);
  return allApplicability(
    t.query_id,
    t.set,
    eng,
    donors.has(t.query_id),
    features.get(t.query_id) ?? [],
  );
});
writeFileSync(
  join(data, 'applicability.jsonl'),
  `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
);

const counts: Record<string, number> = {};
for (const r of rows) if (r.applicable) counts[r.arm] = (counts[r.arm] ?? 0) + 1;
console.log(JSON.stringify({ targets: targets.length, applicable: counts }, null, 1));

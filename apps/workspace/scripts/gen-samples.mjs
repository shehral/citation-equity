// Reads samples/index.json and each sample's files into
// lib/generated/samples.json, which the app imports at build time.
// Runs before dev, build, test and typecheck. The output is gitignored.
// The browser never replays a recording, so recording.json and every run's answer
// text stay out of the bundle; summaries, cited pages and the
// comparison stay, since the bench panel renders them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const samplesDir = join(appDir, '..', '..', 'samples');
const outFile = join(appDir, 'lib', 'generated', 'samples.json');

/** CodeMirror stores text with "\n" line breaks, so samples use them too. */
const readText = (path) => readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** A report with each run's `answer` removed; anything without runs is returned as is. */
function withoutAnswers(result) {
  if (!Array.isArray(result?.runs)) return result;
  return { ...result, runs: result.runs.map(({ answer: _answer, ...run }) => run) };
}

export function generateSamples() {
  const index = readJson(join(samplesDir, 'index.json'));
  const samples = index.map((entry) => {
    const dir = join(samplesDir, entry.slug);
    const sample = { ...entry, before: readText(join(dir, 'before.md')) };
    if (existsSync(join(dir, 'after.md'))) sample.after = readText(join(dir, 'after.md'));
    if (existsSync(join(dir, 'pack.json'))) sample.pack = readJson(join(dir, 'pack.json'));
    const resultsDir = join(dir, 'results');
    if (existsSync(resultsDir)) {
      sample.results = Object.fromEntries(
        readdirSync(resultsDir)
          .filter((name) => name.endsWith('.json') && name !== 'recording.json')
          .sort()
          .map((name) => [
            name.slice(0, -'.json'.length),
            withoutAnswers(readJson(join(resultsDir, name))),
          ]),
      );
    }
    return sample;
  });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(samples, null, 2)}\n`);
  return samples;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const samples = generateSamples();
  console.log(`gen-samples: wrote ${samples.length} sample(s) to lib/generated/samples.json`);
}

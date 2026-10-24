// Reads JSONL lines {id, markdown, question} on stdin and writes one JSONL line per input,
// {id, wordCount, checks, artifacts}, to stdout (see engine_json.ts). E1's Python steps call it
// as a subprocess (common.run_engine). Bundled for the cluster with:
//   pnpm exec tsup experiments/e1/engine_cli.ts --format esm --target node22 -d experiments/e1/out/bundle
import { engineJson } from './engine_json';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const out: string[] = [];
for (const [n, line] of Buffer.concat(chunks).toString('utf8').split('\n').entries()) {
  if (line.trim() === '') continue;
  const item = JSON.parse(line) as { id: unknown; markdown: unknown; question?: unknown };
  if (typeof item.id !== 'string' || typeof item.markdown !== 'string') {
    throw new Error(`stdin line ${n + 1}: id and markdown must be strings`);
  }
  const question = typeof item.question === 'string' ? item.question : '';
  out.push(JSON.stringify({ id: item.id, ...engineJson(item.markdown, question) }));
}
process.stdout.write(out.length > 0 ? `${out.join('\n')}\n` : '');

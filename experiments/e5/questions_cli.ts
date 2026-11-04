// E5's questions bridge (experiments/PLAN_E5.md, "The edit texts"): the tool's own question
// builders, run on the current engine, for the Python side of E5. It reads JSONL lines on stdin,
// {id, keyword?, markdown?, question?}, and writes one JSONL line per input to stdout:
//   keyword            -> keyword_question: keywordQuestion(keyword) = {text, template}
//   markdown           -> page_questions: pageQuestions(markdown) = [{text, origin}]
//   markdown, question -> coverage: the question-coverage check of analyze(markdown, {questions:
//                         [question]}) = {applicable, score}, the tool's own view of whether the
//                         page covers the question (E5's tool_gate)
// Applicability, spans and validation never use this bridge: they run on E1's pinned engine
// bundle (experiments/e1/out/bundle/engine_cli.js). Bundled once, from a named commit, with:
//   pnpm exec tsup experiments/e5/questions_cli.ts --format esm --target node22 -d experiments/e5/out/bundle
import { analyze, keywordQuestion, pageQuestions } from '../../packages/engine/src/index';

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const out: string[] = [];
for (const [n, line] of Buffer.concat(chunks).toString('utf8').split('\n').entries()) {
  if (line.trim() === '') continue;
  const item = JSON.parse(line) as {
    id: unknown;
    keyword?: unknown;
    markdown?: unknown;
    question?: unknown;
  };
  if (typeof item.id !== 'string') throw new Error(`stdin line ${n + 1}: id must be a string`);
  const row: Record<string, unknown> = { id: item.id };
  if (item.keyword !== undefined) {
    if (typeof item.keyword !== 'string')
      throw new Error(`stdin line ${n + 1}: keyword must be a string`);
    row.keyword_question = keywordQuestion(item.keyword);
  }
  if (item.markdown !== undefined) {
    if (typeof item.markdown !== 'string')
      throw new Error(`stdin line ${n + 1}: markdown must be a string`);
    if (item.question === undefined) {
      row.page_questions = pageQuestions(item.markdown).map((q) => ({
        text: q.text,
        origin: q.origin,
      }));
    } else {
      if (typeof item.question !== 'string')
        throw new Error(`stdin line ${n + 1}: question must be a string`);
      const result = analyze(item.markdown, {
        questions: item.question.trim() ? [item.question] : [],
      });
      const c = result.checks.find((x) => x.checkId === 'question-coverage');
      row.coverage = c
        ? { applicable: c.applicable, score: c.score }
        : { applicable: false, score: 0 };
    }
  }
  out.push(JSON.stringify(row));
}
process.stdout.write(out.length > 0 ? `${out.join('\n')}\n` : '');

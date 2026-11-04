// Fixtures for E5's Python twin of the tool's local-model question path (editor.py, q_L): the
// prompt keywordQuestionsPrompt([k], 1), the parse of keywordQuestions (cleanLine, then the first
// line that ends in "?") and DEFAULT_SETTINGS.temperature, all from packages/bench as it is now.
// Regenerate (no model call; the adapter returns fixed answers):
//   pnpm --filter @citation-equity/bench exec tsx --conditions=@citation-equity/source \
//     "$PWD/experiments/e5/tool_twin_fixtures.ts" > experiments/e5/tests/tool_twin_fixtures.json
//   pnpm exec biome format --write experiments/e5/tests/tool_twin_fixtures.json
import { keywordQuestions, keywordQuestionsPrompt } from '../../packages/bench/src/questions-llm';
import { DEFAULT_SETTINGS } from '../../packages/bench/src/types';

const KEYWORDS = [
  'espresso machines',
  'weight loss pills',
  '  padded  keyword ',
  'best running shoes 2026',
  'café crème',
  "don't stop",
  'k-pop idols',
  'what is espresso',
  'vitamin d',
];

const ANSWERS = [
  'What are espresso machines?\nHow do I clean one?',
  '1. What are weight loss pills?\n2. Are they safe?',
  '- **How do I descale an espresso machine?**',
  '"Which espresso machine is best?"',
  '“Is decaf espresso real?”',
  'Here are some questions:\n\n* What is crema?',
  'No question here.\nStill none',
  '   2) Why is espresso bitter?   \n',
  '• Can I use any coffee?',
  'What is espresso\nWhat is crema ?',
  '**Bold** but not a question?',
  '10. Ten?\n',
  'What is a ristretto?\r\nWhat else?',
  '',
  '1.What is lungo?\n1. What is a doppio?',
  ' - What is a cortado? ',
];

const calls: { prompt: string; seed: number | undefined; temperature: number | undefined }[] = [];
const adapter = (answer: string) => ({
  name: 'fixture',
  generate: async (prompt: string, o: { seed?: number; temperature?: number }) => {
    calls.push({ prompt, seed: o.seed, temperature: o.temperature });
    return answer;
  },
});

const prompts = KEYWORDS.map((k) => ({
  keywords: [k],
  max: 1,
  prompt: keywordQuestionsPrompt([k], 1),
}));
const parses = [];
for (const answer of ANSWERS) {
  // biome-ignore lint/suspicious/noExplicitAny: a minimal adapter for the fixture
  const got = await keywordQuestions(['espresso'], adapter(answer) as any, { model: 'm', max: 1 });
  parses.push({ answer, max: 1, questions: got.map((q) => q.text) });
}
process.stdout.write(
  `${JSON.stringify(
    {
      default_temperature: DEFAULT_SETTINGS.temperature,
      default_seed: calls[0]?.seed ?? null,
      sent_temperature: calls[0]?.temperature ?? null,
      prompts,
      parses,
    },
    null,
    1,
  )}\n`,
);

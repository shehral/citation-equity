import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  fanOutPrompt,
  fanOutQuestions,
  RecordedAdapter,
  recordingKey,
} from '../src/index';

const INPUT = {
  title: 'Cold brew at home',
  intro: 'Cold brew is coffee steeped in cold water for twelve hours or more.',
};
const MODEL = DEFAULT_SETTINGS.model;

/** A recording that answers the fan-out prompt for `max` and `seed` with `answer`. */
function recorded(answer: string, max = 8, seed = 1) {
  const opts = { model: MODEL, seed, temperature: DEFAULT_SETTINGS.temperature };
  return new RecordedAdapter({ [recordingKey(fanOutPrompt(INPUT, max), opts)]: answer });
}

const ANSWER = [
  'Here are some questions a reader might ask:',
  '',
  '1. How long does cold brew keep in the fridge?',
  '- Is cold brew stronger than iced coffee?',
  '* **What beans work best for cold brew?**',
  '"Can you heat cold brew?"',
  'Cold brew is smoother than hot coffee.',
  'how long does cold brew keep in the fridge?',
  '2) Cold brew or French press: which is better?',
].join('\n');

describe('fanOutQuestions', () => {
  it('asks once with the title and intro, and keeps only lines that end in "?"', async () => {
    const prompt = fanOutPrompt(INPUT, 8);
    expect(prompt).toContain('up to 8 questions');
    expect(prompt).toContain(INPUT.title);
    expect(prompt).toContain(INPUT.intro);
    expect(prompt).toMatch(/follow-up/);
    expect(prompt).toMatch(/comparisons/);
    expect(prompt).toMatch(/one per line/);

    const questions = await fanOutQuestions(INPUT, recorded(ANSWER), { model: MODEL });
    expect(questions).toEqual([
      { text: 'How long does cold brew keep in the fridge?', source: 'local-model' },
      { text: 'Is cold brew stronger than iced coffee?', source: 'local-model' },
      { text: 'What beans work best for cold brew?', source: 'local-model' },
      { text: 'Can you heat cold brew?', source: 'local-model' },
      { text: 'Cold brew or French press: which is better?', source: 'local-model' },
    ]);
  });

  it('caps the list at max and passes the seed through', async () => {
    const questions = await fanOutQuestions(INPUT, recorded(ANSWER, 2, 7), {
      model: MODEL,
      seed: 7,
      max: 2,
    });
    expect(questions.map((q) => q.text)).toEqual([
      'How long does cold brew keep in the fridge?',
      'Is cold brew stronger than iced coffee?',
    ]);
  });

  it('leaves the title line out when the draft has no H1', () => {
    const prompt = fanOutPrompt({ title: '', intro: INPUT.intro }, 8);
    expect(prompt).not.toMatch(/Title:/);
    expect(prompt).toContain(INPUT.intro);
  });

  it('returns nothing when no line is a question', async () => {
    expect(
      await fanOutQuestions(INPUT, recorded('Cold brew is nice.\nTry it.'), { model: MODEL }),
    ).toEqual([]);
  });
});

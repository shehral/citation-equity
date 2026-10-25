import type { EngineAdapter, GenerateOptions } from '@citation-equity/bench';
import type { Suggestion } from '@citation-equity/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  addedFacts,
  buildWordingPrompt,
  offersWordingHelper,
  proposeWording,
  rationaleForPrompt,
} from '@/lib/wording-helper';

const SECTION =
  '## Grind size\n\nAs one barista put it, "finer grinds pull bitter shots." Go coarser.\n';
const QUOTE = '"finer grinds pull bitter shots."';

const ADVISORY: Suggestion = {
  id: 'adv00042',
  checkId: 'expert-quotes',
  kind: 'advisory',
  range: { start: SECTION.indexOf(QUOTE), end: SECTION.indexOf(QUOTE) + QUOTE.length },
  before: QUOTE,
  title: 'Name who said this',
  rationale: 'A quotation reads as more credible when it names its speaker.',
  grade: 'mixed',
};

function adapterReturning(answer: string) {
  const generate = vi.fn(async (_prompt: string, _opts: GenerateOptions) => answer);
  const adapter: EngineAdapter = { name: 'fake', generate };
  return { adapter, generate };
}

describe('buildWordingPrompt', () => {
  it('quotes the span, the section and the check, and forbids new facts', () => {
    const prompt = buildWordingPrompt(ADVISORY, SECTION);
    expect(prompt).toContain(ADVISORY.before);
    expect(prompt).toContain(SECTION.trim());
    expect(prompt).toContain(ADVISORY.title);
    expect(prompt).toContain(ADVISORY.rationale);
    expect(prompt).toContain('Do not add new facts');
    expect(prompt).toMatch(/only the rewritten text/i);
  });
});

describe('proposeWording', () => {
  it('returns an edit copy with after from the model, leaving range and before alone', async () => {
    const { adapter, generate } = adapterReturning(
      '"Finer grinds pull bitter shots," a barista says.',
    );
    const proposal = await proposeWording(ADVISORY, SECTION, adapter, 'qwen2.5:3b');
    expect(proposal.kind).toBe('edit');
    expect(proposal.after).toBe('"Finer grinds pull bitter shots," a barista says.');
    expect(proposal.range).toEqual(ADVISORY.range);
    expect(proposal.before).toBe(ADVISORY.before);
    expect(proposal.id).toBe(ADVISORY.id);
    // A copy: the advisory itself is untouched.
    expect(ADVISORY.kind).toBe('advisory');
    expect(ADVISORY.after).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
    const [prompt, opts] = generate.mock.calls[0];
    expect(prompt).toBe(buildWordingPrompt(ADVISORY, SECTION));
    expect(opts.model).toBe('qwen2.5:3b');
  });

  it('strips a code fence or label the model wraps around its answer', async () => {
    const { adapter } = adapterReturning('```markdown\nRewritten text.\n```\n');
    expect((await proposeWording(ADVISORY, SECTION, adapter, 'm')).after).toBe('Rewritten text.');
    const labelled = adapterReturning('Rewritten text: Plain words.');
    expect((await proposeWording(ADVISORY, SECTION, labelled.adapter, 'm')).after).toBe(
      'Plain words.',
    );
  });

  it('keeps the whitespace around the original span', async () => {
    const padded = { ...ADVISORY, before: `${QUOTE}\n` };
    const { adapter } = adapterReturning('  New wording.  ');
    expect((await proposeWording(padded, SECTION, adapter, 'm')).after).toBe('New wording.\n');
  });

  it('rejects an empty answer instead of proposing to delete the text', async () => {
    const { adapter } = adapterReturning('   \n');
    await expect(proposeWording(ADVISORY, SECTION, adapter, 'm')).rejects.toThrow(/no text/);
  });

  it('passes adapter errors through', async () => {
    const adapter: EngineAdapter = {
      name: 'down',
      generate: () => Promise.reject(new Error('boom')),
    };
    await expect(proposeWording(ADVISORY, SECTION, adapter, 'm')).rejects.toThrow('boom');
  });
});

describe('wording helper safeguards (no invented facts)', () => {
  const PARAGRAPH: Suggestion = {
    ...ADVISORY,
    id: 'adv00043',
    checkId: 'standalone-paragraphs',
    before: 'This makes the shot bitter.',
    title: 'Make this paragraph stand on its own',
    rationale: 'A paragraph that names its subject reads clearly alone.',
  };

  it('is offered for writing checks, never for statistics, quotes or sources', () => {
    expect(offersWordingHelper(PARAGRAPH)).toBe(true);
    for (const checkId of ['statistics', 'expert-quotes', 'cited-sources'] as const) {
      expect(offersWordingHelper({ ...PARAGRAPH, checkId })).toBe(false);
    }
    expect(offersWordingHelper({ ...PARAGRAPH, kind: 'edit', after: 'x' })).toBe(false);
  });

  it("is never offered for the reader's words: that check is advice only, so no model writes them in", () => {
    expect(offersWordingHelper({ ...PARAGRAPH, checkId: 'reader-words' })).toBe(false);
  });

  it('leaves the worked example out of the prompt, so the model cannot copy it in', () => {
    const rationale =
      'The quote has no speaker. Add the speaker\'s name and role next to the quote, for example "says Jane Doe, head roaster at Example Coffee", so a reader can judge the source. Name only the person who really said it.';
    expect(rationaleForPrompt(rationale)).toBe(
      'The quote has no speaker. Name only the person who really said it.',
    );
    const prompt = buildWordingPrompt({ ...PARAGRAPH, rationale }, SECTION);
    expect(prompt).not.toContain('Jane Doe');
    expect(prompt).not.toContain('Example Coffee');
  });

  it('flags added names, numbers, quotations and "according to"', () => {
    const before = 'Over-extraction makes the shot bitter.';
    expect(addedFacts(before, 'Over-extraction makes the shot bitter, says Jane Doe.')).toEqual([
      'a name',
    ]);
    expect(
      addedFacts(
        before,
        'According to a study by the Cycling Industry Association, over-extraction makes it bitter.',
      ),
    ).toEqual(['a source', 'a name']);
    expect(
      addedFacts(before, 'An extraction time of 20-30 seconds keeps it from turning bitter.'),
    ).toEqual(['a number']);
    expect(addedFacts(before, 'Over-extraction makes "the shot" bitter.')).toEqual(['a quotation']);
  });

  it('lets through rewording, sentence capitals, words already there and [placeholders]', () => {
    const before = 'This makes the espresso shot from Rome bitter in 30 seconds.';
    expect(
      addedFacts(before, 'Over-extraction makes the espresso shot from Rome bitter in 30 seconds.'),
    ).toEqual([]);
    expect(
      addedFacts(before, 'Espresso turns bitter. The shot from Rome took 30 seconds.'),
    ).toEqual([]);
    expect(
      addedFacts(before, 'This makes the shot bitter, says [name, role], in [figure] seconds.'),
    ).toEqual([]);
    expect(addedFacts('## why it is bitter', '## Why is espresso bitter?')).toEqual([]);
  });

  it('rejects a proposal that invents a speaker, and says why', async () => {
    const { adapter } = adapterReturning(
      'This makes the shot bitter, says Jane Doe, head roaster.',
    );
    await expect(proposeWording(PARAGRAPH, SECTION, adapter, 'm')).rejects.toThrow(
      /added a name that your text does not have/,
    );
  });
});

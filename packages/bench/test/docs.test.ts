import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVIDENCE,
  helpedChecks,
  QUESTION_LABELS,
  READINESS_NOTE,
  shortAnswer,
  TEST_LABEL_ORDER,
  TEST_LABEL_TEXT,
  TEST_LABELS,
  type TestLabel,
} from '@citation-equity/engine';
import type { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { validatePack } from '../src/index';
import { createProgram, runCli } from '../src/node/cli';

// The public docs (README and the pages it links) stay true to the code: links resolve,
// the command reference and its sample output match the real `ce` program, the quoted questions
// covered on the samples match a fresh analysis, what the README says our tests found follows the
// label table, and the copy rules hold.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const PUBLIC_DOCS = [
  'README.md',
  'docs/architecture.md',
  'docs/cli.md',
  'docs/evidence.md',
  'docs/roadmap.md',
  'samples/README.md',
  'experiments/README.md',
];

/**
 * The process notes (the design folder, the review ledger and its rulings) are not published, so
 * no public file may point at them. Built from parts so this file never matches itself.
 */
const PROCESS_REFS = new RegExp(
  [
    ['super', 'powers'].join(''),
    ['critique', '-'].join(''),
    ['mock', 'up-dashboard'].join(''),
    ['Ruling', ' R\\d'].join(''),
    ['\\bR', '\\d{1,2}\\b'].join(''),
    ['Review', ' Focus'].join(''),
    ['\\b[Ss]pec', ' (\\d|section)'].join(''),
  ].join('|'),
);

/** Text files under the public folders, skipping build output and the unpublished notes. */
function publicFiles(dir: string): string[] {
  const skip = new Set([
    'node_modules',
    '.next',
    'out',
    'dist',
    'generated',
    'test-results',
    'playwright-report',
  ]);
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skip.has(entry.name) && path !== `docs/${['super', 'powers'].join('')}`) {
        out.push(...publicFiles(path));
      }
    } else if (/\.(ts|tsx|mjs|js|css|md|json|yml)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const DEMO_URL = 'https://shehral.github.io/citation-equity/';
const PITCH =
  'Citation Equity helps independent writers get cited by AI search. Start from the questions your readers ask, see which ones your draft covers, and check that AI search can reach your page; it suggests, you decide.';
const SHOT_ALT =
  'The draft view after Try it with an example: Questions covered, a quick edit and the draft';

/**
 * How a guessed question's answered line reads in the README, by the label E5 gave it. A new
 * result with no wording here fails the README tests until the README and this table follow.
 */
const GUESS_RESULT: Partial<Record<TestLabel, string>> = {
  'may-help-less': 'helped less in our test',
  'no-effect': 'showed no clear gain',
};

/**
 * The README's one sentence on guessed questions, from the label table's answered lines for a
 * keyword's and a local AI's question; null when either label has no wording.
 */
function guessSentence(): string | null {
  const keyword = GUESS_RESULT[QUESTION_LABELS.keyword.answer];
  const localModel = GUESS_RESULT[QUESTION_LABELS['local-model'].answer];
  if (keyword === undefined || localModel === undefined) return null;
  return `Questions guessed from a keyword ${keyword}; questions a local AI wrote ${localModel}.`;
}

/** Markdown without fenced code blocks. */
function withoutCode(md: string): string {
  return md.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '');
}

/** Words a reader reads: prose outside code blocks, with link targets left out. */
function proseWords(md: string): number {
  const text = withoutCode(md)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(md: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const m of withoutCode(md).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

/** Relative link targets of a Markdown file (inline links and images), outside code. */
function relativeLinks(md: string): string[] {
  return [...withoutCode(md).matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1])
    .filter((url) => !/^[a-z][a-z\d+.-]*:/i.test(url));
}

/** Every leaf command of the program, by its full path ("pack from-urls"), with its options. */
function leafCommands(cmd: Command, prefix = ''): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const sub of cmd.commands) {
    const path = `${prefix}${sub.name()}`;
    if (sub.commands.length > 0) {
      for (const [k, v] of leafCommands(sub, `${path} `)) out.set(k, v);
    } else {
      out.set(path, new Set(sub.options.map((o) => o.long).filter((l): l is string => !!l)));
    }
  }
  return out;
}

/** Rows of a command table, `| \`ce <command> <args and flags>\` | what it does |`, by command. */
function commandRows(md: string): { name: string; line: string }[] {
  return [...md.matchAll(/^\| `ce ([^`]+)` *\|.*$/gm)].map((m) => {
    const words = m[1].split(' ');
    const end = words.findIndex((w) => !/^[a-z][a-z-]*$/.test(w));
    return { name: words.slice(0, end === -1 ? undefined : end).join(' '), line: m[0] };
  });
}

const PROGRAM_COMMANDS = leafCommands(createProgram({ stdout: () => {}, stderr: () => {} }));

const tempDirs: string[] = [];
afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

/** A fresh temporary folder, removed after the file's tests. */
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ce-docs-'));
  tempDirs.push(dir);
  return dir;
}

/** Writes a sample's pack questions, one per line, to `<dir>/<name>`, as a `--questions` file. */
async function packQuestions(sample: string, dir: string, name: string): Promise<string> {
  const pack = validatePack(JSON.parse(read(`samples/${sample}/pack.json`)));
  const path = join(dir, name);
  await writeFile(path, `${pack.queries.map((q) => q.query).join('\n')}\n`);
  return path;
}

/** What `ce analyze <args>` prints; the command must succeed. */
async function analyzeOutput(args: string[]): Promise<string> {
  let stdout = '';
  const code = await runCli(['analyze', ...args], {
    stdout: (s) => {
      stdout += s;
    },
    stderr: () => {},
  });
  expect(code).toBe(0);
  return stdout;
}

describe('public docs', () => {
  it.each(PUBLIC_DOCS)('%s: every relative link and anchor resolves', (file) => {
    const md = read(file);
    for (const link of relativeLinks(md)) {
      const [path, hash] = link.split('#');
      const target = path === '' ? join(ROOT, file) : resolve(dirname(join(ROOT, file)), path);
      expect(existsSync(target), `${file} links ${link}`).toBe(true);
      if (hash && target.endsWith('.md')) {
        expect(anchors(readFileSync(target, 'utf8')).has(hash), `${file} links ${link}`).toBe(true);
      }
    }
  });

  it('never name the retired score', () => {
    const docs = [
      'README.md',
      ...readdirSync(join(ROOT, 'docs'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => `docs/${f}`),
      'samples/README.md',
    ];
    expect(docs).toContain('docs/evidence.md');
    for (const file of docs) {
      expect(read(file), file).not.toMatch(/AI-ready|GEO Score|Foundation score|Evidence score/i);
    }
  });

  it.each(['README.md', 'docs/cli.md', 'docs/roadmap.md', 'samples/README.md'])(
    '%s: says "score" only as "citation score", outside code',
    (file) => {
      const prose = withoutCode(read(file)).replace(/`[^`\n]*`/g, '');
      expect(prose.match(/(?<!citation )\bscor(e|es|ed|ing)\b/gi), file).toBeNull();
    },
  );

  it.each(['README.md', 'docs/cli.md'])('%s: no command row speaks of a score', (file) => {
    for (const { line } of commandRows(read(file))) expect(line).not.toMatch(/score/i);
  });

  it.each(PUBLIC_DOCS)('%s: follows the copy rules', (file) => {
    const md = read(file);
    expect(md).not.toContain('—'); // em dash
    expect(md).not.toMatch(/contradicted/i);
    expect(md).not.toMatch(new RegExp(['super', 'powers'].join(''), 'i'));
    expect(md).not.toMatch(/footnoteone/i);
    expect(md).not.toContain('What it cannot do');
    expect(md).not.toContain('And SEO?');
  });
});

describe('public files', () => {
  it('never point at the unpublished process notes or their ruling numbers', () => {
    const files = [...['apps', 'packages', 'samples', 'docs'].flatMap(publicFiles), 'README.md'];
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((file) =>
      read(file)
        .split('\n')
        .flatMap((line, i) =>
          PROCESS_REFS.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});

describe('README', () => {
  const md = read('README.md');
  const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  /** The `## <name>` section's text, without its heading line's `## `; empty when missing. */
  const sectionOf = (name: string) =>
    md.split(/^## /m).find((s) => s.startsWith(`${name}\n`)) ?? '';

  it('is about 700 words', () => {
    const words = proseWords(md);
    expect(words).toBeGreaterThanOrEqual(550);
    expect(words).toBeLessThanOrEqual(820);
  });

  it('opens with the pitch, then the demo link, then the screenshot', () => {
    const pitch = md.indexOf(PITCH);
    const demo = md.indexOf(`[Try the demo](${DEMO_URL})`);
    const shot = md.indexOf(`![${SHOT_ALT}](docs/screenshot.png)`);
    expect(pitch).toBeGreaterThan(0);
    expect(demo).toBeGreaterThan(pitch);
    expect(shot).toBeGreaterThan(demo);
    expect(md).not.toMatch(/vercel/i);
  });

  it('has five one-line features', () => {
    const items = sectionOf('What it does')
      .split('\n')
      .filter((l) => /^\d+\. /.test(l));
    expect(items).toHaveLength(5);
  });

  it('walks through the four steps, one per tab, in order', () => {
    const steps = sectionOf('How to use it')
      .split('\n')
      .filter((l) => /^\d+\. /.test(l));
    expect(steps).toHaveLength(4);
    for (const [i, tab] of ['Your questions', 'Your draft', 'Your site', 'Results'].entries()) {
      expect(steps[i], tab).toContain(`**${tab}**`);
    }
  });

  it('says what our tests found in the labels in use, and links the evidence', () => {
    expect(headings).not.toContain('How the score works');
    const section = sectionOf('What our tests found');
    expect(section).toContain('](docs/evidence.md)');
    // One line names the labels the app can show today: every check's and every question line's.
    const inUse = new Set<TestLabel>([
      ...Object.values(TEST_LABELS),
      ...Object.values(QUESTION_LABELS).flatMap((l) => [l.words, l.answer]),
    ]);
    const named = (line: string) =>
      TEST_LABEL_ORDER.filter((l) => line.includes(TEST_LABEL_TEXT[l]));
    const line = section.split('\n').find((l) => named(l).length > 0) ?? '';
    expect(named(line)).toEqual(TEST_LABEL_ORDER.filter((l) => inUse.has(l)));
  });

  it('names the checks that helped only in the sentence the label table gives', () => {
    // The Research page's short answer, without its lead-in. A new result (E5) that changes which
    // checks helped changes that sentence, so this fails until the README follows.
    const sentence = shortAnswer(helpedChecks()).replace(/^Short answer: (\w)/, (_, c: string) =>
      c.toUpperCase(),
    );
    let prose = withoutCode(md);
    for (const text of Object.values(TEST_LABEL_TEXT)) prose = prose.replaceAll(text, '');
    const claims = prose
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => /\bhelped\b/i.test(s));
    // The guesses' sentence may say a guess helped less; it is bound to the label table below.
    const guess = guessSentence() ?? '';
    expect(claims).toEqual([sentence, guess].filter((s) => /\bhelped\b/i.test(s)));
    expect(sectionOf('What our tests found')).toContain(sentence);
  });

  it('words guessed questions only in the sentence the question labels give', () => {
    // E5 set how a guessed question's answered line reads. A new result that changes it changes
    // this sentence, so this fails until the README follows.
    const sentence = guessSentence();
    expect(sentence, 'a README wording for each guess label').not.toBeNull();
    expect(sectionOf('What our tests found')).toContain(sentence);
    expect(withoutCode(md).match(/\bguess/gi)).toHaveLength(1);
  });

  it('links the moved material', () => {
    for (const doc of [
      'docs/architecture.md',
      'docs/cli.md',
      'samples/README.md',
      'experiments/README.md',
      'docs/evidence.md',
    ]) {
      expect(md).toContain(`](${doc})`);
    }
  });

  it('lists every command of the real program in its command table', () => {
    const listed = commandRows(md).map((r) => r.name);
    expect([...listed].sort()).toEqual([...PROGRAM_COMMANDS.keys()].sort());
  });

  it('says no check is graded strong only while that holds', () => {
    expect(md).toContain('No check is graded strong yet');
    expect(Object.values(EVIDENCE).filter((e) => e.grade === 'strong')).toEqual([]);
  });

  it('ends with the credits', () => {
    expect(headings.at(-1)).toBe('Credits');
    const credits = md.slice(md.lastIndexOf('## Credits'));
    expect(credits).toContain('Original design by Prof. Akram Bayat.');
    expect(credits).toContain(
      'Built by Mohammad Ali Shehral and Ishan Gupta, Northeastern University, Khoury College of Computer Sciences, San Jose.',
    );
    // Her name appears once, in the credits.
    expect(md.match(/Bayat/g)).toHaveLength(1);
  });

  it('leaves the evidence to a short pointer: no test numbers or study names', () => {
    const section = sectionOf('How we tested it');
    expect(section).toContain('](docs/evidence.md)');
    expect(section).toContain('/research/');
    expect(md).not.toMatch(/\bE\d\b|RESULTS_E|\bCI\b|0\.03/);
    expect(md).not.toContain('## What the test found');
  });
});

describe('samples/README', () => {
  const md = read('samples/README.md');

  it("quotes the questions covered that a fresh analysis gives on each pack's questions", async () => {
    const dir = await tempDir();
    const covered = async (path: string, questions: string) => {
      const stdout = await analyzeOutput([join(ROOT, path), '--questions', questions]);
      const m = /^Questions covered: (\d+) of (\d+) /.exec(stdout);
      expect(m, path).not.toBeNull();
      return { n: Number(m?.[1]), of: Number(m?.[2]) };
    };
    for (const [slugName, label] of [
      ['espresso-bitterness', 'espresso'],
      ['rag-explained', 'RAG'],
    ]) {
      const questions = await packQuestions(slugName, dir, `${slugName}.txt`);
      const before = await covered(`samples/${slugName}/before.md`, questions);
      const after = await covered(`samples/${slugName}/after.md`, questions);
      expect(before.of).toBe(4);
      expect(after.of).toBe(4);
      expect(md).toContain(`${before.n} to ${after.n} of 4 for ${label}`);
    }
  });
});

describe('the README screenshot', () => {
  it('ships a fresh 1440 by 900 screenshot under 400 KB', () => {
    const path = join(ROOT, 'docs/screenshot.png');
    expect(statSync(path).size).toBeLessThan(400 * 1024);
    const png = readFileSync(path);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1440);
    expect(png.readUInt32BE(20)).toBe(900);
  });
});

describe('docs/cli.md', () => {
  const md = read('docs/cli.md');
  const commands = PROGRAM_COMMANDS;
  const rows = commandRows(md);

  it('lists every command of the real program, once', () => {
    const listed = rows.map((r) => r.name);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...commands.keys()].sort());
  });

  it('names only flags the command has', () => {
    for (const { name, line } of rows) {
      const flags = commands.get(name) ?? new Set();
      for (const [flag] of line.matchAll(/--[a-z][a-z-]*/g)) {
        expect(flags.has(flag), `ce ${name} ${flag}`).toBe(true);
      }
    }
  });

  it('explains how to make a test pack, which the app links to', () => {
    expect(anchors(md).has('make-a-test-pack')).toBe(true);
  });

  it('shows ce analyze output as the real command prints it, line for line', async () => {
    const block =
      /^```text\n\$ ce analyze (samples\/([a-z-]+)\/\S+) --questions (\S+)\n([\s\S]*?)^```$/m.exec(
        md,
      );
    expect(block).not.toBeNull();
    const [, draft, sample, name, body] = block ?? [];
    // The example's questions file holds the sample pack's questions.
    const questions = await packQuestions(sample, await tempDir(), name);
    const printed = (await analyzeOutput([join(ROOT, draft), '--questions', questions])).split(
      '\n',
    );
    const shown = body.split('\n').filter((l) => l !== '' && l !== '...');
    expect(shown.length).toBeGreaterThan(5);
    // Each shown line is a printed line, in the printed order ("..." stands for lines left out).
    let at = -1;
    for (const line of shown) {
      const i = printed.indexOf(line, at + 1);
      expect(i, line).toBeGreaterThan(at);
      at = i;
    }
  });

  it('quotes the note ce site ends with', () => {
    expect(md).toContain(READINESS_NOTE);
  });
});

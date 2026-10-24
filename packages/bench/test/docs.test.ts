import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE } from '@citation-equity/engine';
import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createProgram, runCli } from '../src/node/cli';

// The public docs (README and the pages it links) stay true to the code: links resolve,
// the command reference matches the real `ce` program, the quoted sample scores match a
// fresh analysis, and the copy rules hold.

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const PUBLIC_DOCS = [
  'README.md',
  'docs/architecture.md',
  'docs/cli.md',
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
  'Citation Equity helps independent writers get quoted by AI search. Paste a draft, fix what makes it hard to quote, check your page and see who AI cites; it suggests, you decide.';

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

  it('is about 700 words', () => {
    const words = proseWords(md);
    expect(words).toBeGreaterThanOrEqual(550);
    expect(words).toBeLessThanOrEqual(820);
  });

  it('opens with the pitch, then the demo link, then the screenshot', () => {
    const pitch = md.indexOf(PITCH);
    const demo = md.indexOf(`[Try the demo](${DEMO_URL})`);
    const shot = md.indexOf('](docs/screenshot.png)');
    expect(pitch).toBeGreaterThan(0);
    expect(demo).toBeGreaterThan(pitch);
    expect(shot).toBeGreaterThan(demo);
    expect(md).not.toMatch(/vercel/i);
  });

  it('has five one-line features', () => {
    const section = md.split(/^## /m).find((s) => s.startsWith('What it does'));
    expect(section).toBeDefined();
    const items = (section ?? '').split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items).toHaveLength(5);
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

  it('quotes the sample scores a fresh analysis gives', async () => {
    const score = async (path: string) => {
      let stdout = '';
      const code = await runCli(['analyze', join(ROOT, path)], {
        stdout: (s) => {
          stdout += s;
        },
        stderr: () => {},
      });
      expect(code).toBe(0);
      return Number(/Foundation score: (\d+)/.exec(stdout)?.[1]);
    };
    for (const [slugName, label] of [
      ['espresso-bitterness', 'espresso'],
      ['rag-explained', 'RAG'],
    ]) {
      const before = await score(`samples/${slugName}/before.md`);
      const after = await score(`samples/${slugName}/after.md`);
      expect(md).toContain(`${before} to ${after} (${label})`);
    }
  });

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
});

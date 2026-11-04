// The tool shows no score anywhere. Two parts: the rendered text of every route (home, draft,
// site, results, research, About), with every disclosure, group and section opened, holds none of
// the copy the score build had; and no app source file imports the engine's score functions,
// which stay a research API outside the app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CitedPage from '@/app/cited/page';
import ResearchPage from '@/app/research/page';
import SitePage from '@/app/site/page';
import { DraftView } from '@/components/draft/draft-view';
import { Home } from '@/components/home/home';
import { AppShell } from '@/components/shell/app-shell';
import { runExample } from '@/lib/examples';
import { MY_DRAFT_SLUG, SAMPLES } from '@/lib/samples';
import { setSiteInput } from '@/lib/site-questions';
import { saveDraft } from '@/lib/storage';
import { MY_POST_SLOT, setActiveSlot } from '@/lib/store';
import { openDetails, openDraftView, resetScreens, strayScores } from './quiet';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// CodeMirror needs layout that jsdom lacks; the stand-in holds the draft, whose own text is the
// author's and is not read here.
vi.mock('@/components/editor/markdown-editor', async () => {
  const { forwardRef } = await import('react');
  return {
    MarkdownEditor: forwardRef<unknown, { ariaLabel: string }>(function FakeEditor(
      { ariaLabel },
      _ref,
    ) {
      return createElement('textarea', { 'aria-label': ariaLabel, readOnly: true });
    }),
  };
});

beforeEach(resetScreens);
afterEach(() => {
  cleanup();
  resetScreens();
});

/** The score build's copy: none of it may show on any route. */
const REMOVED: (string | RegExp)[] = [
  'AI-ready',
  'A writing checklist, not a forecast',
  'No check is proven to raise AI citations yet',
  'Scoring',
  'Standard ·',
  'By evidence',
  'Adjust weights',
  'Not scored',
  'since you started',
  /\d+ of \d+ handled/,
  'quick win',
  'Next up',
  'Get quoted by AI search',
  'Is my post easy for AI to quote?',
  'Can AI read my published page?',
  'Who does AI cite for my questions?',
  /\d+ of \d+ pass/,
  'Can AI read your page?',
  'Who does AI cite?',
  'What do your readers ask?',
  'All 11 checks',
  'All fixes',
  'Use in my draft',
  'Ask an AI',
  'Short answer: none of the checks',
  'Weights:',
  "Why the score isn't a forecast",
  'Treat the score',
];

/** What the page shows a reader: its text, plus the tooltips, accessible names and placeholders. */
function shownText(): string {
  const attrs = [...document.body.querySelectorAll('[title], [aria-label], [placeholder]')].flatMap(
    (el) => ['title', 'aria-label', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
  );
  return [document.body.textContent ?? '', ...attrs].join('\n');
}

/**
 * Fails when the route on screen shows any of the score build's copy, or the word "score"
 * anywhere but inside "citation score" on /research/ (the 0-to-1 measure of our tests).
 */
function expectNoScore(where: string, { research = false } = {}) {
  const text = shownText();
  for (const removed of REMOVED) {
    const found = typeof removed === 'string' ? text.includes(removed) : removed.test(text);
    expect(found, `${where}: "${removed}"`).toBe(false);
  }
  expect(strayScores(text), where).toEqual([]);
  if (!research) expect(text, where).not.toMatch(/citation score/i);
}

const inShell = (route: string, page: ReactNode) => {
  path.current = route;
  return render(createElement(AppShell, null, page));
};

describe('no route shows a score, with everything open', () => {
  it('the home, with the example tried', () => {
    act(() => runExample());
    inShell('/', createElement(Home));
    expect(screen.getByRole('region', { name: 'Blocker' })).toBeTruthy();
    openDetails();
    expectNoScore('home, example');
  });

  it('the home with keywords, an import and a model question', () => {
    setSiteInput({
      keywords: 'espresso bitter\nespresso shot time, 1900\nWhy does my espresso taste bitter?',
      imported: {
        name: 'Queries.csv',
        queries: [{ text: 'espresso grind size', source: 'search-console', impressions: 90 }],
      },
      suggested: ['Does a darker roast taste more bitter?'],
    });
    inShell('/', createElement(Home));
    openDetails();
    expectNoScore('home, own questions');
  });

  for (const sample of SAMPLES) {
    it(`the draft view on the ${sample.slug} example`, () => {
      setActiveSlot(sample.slug);
      inShell('/draft/', createElement(DraftView));
      openDraftView();
      expect(screen.getByRole('heading', { name: /^Questions covered: \d+ of \d+$/ })).toBeTruthy();
      expectNoScore(`draft (${sample.slug})`);
    });
  }

  it('the draft view on My post, measured on its own title', () => {
    saveDraft(MY_DRAFT_SLUG, '# How do I make cold brew?\n\nSteep coarse grounds overnight.\n');
    setActiveSlot(MY_POST_SLOT);
    inShell('/draft/', createElement(DraftView));
    openDraftView();
    expect(screen.getByText("From your title. Add your readers' own.")).toBeTruthy();
    expectNoScore('draft (my post)');
  });

  it('Your site, on the example page', () => {
    act(() => runExample());
    inShell('/site/', createElement(SitePage));
    openDetails();
    expect(screen.getAllByText('Why it matters').length).toBeGreaterThan(0);
    expectNoScore('site');
  });

  it('Results, on the example and on My post', () => {
    act(() => runExample());
    const view = inShell('/cited/', createElement(CitedPage));
    openDetails();
    expect(screen.getByRole('region', { name: 'Sample result' })).toBeTruthy();
    expectNoScore('results, example');
    view.unmount();
    resetScreens();
    saveDraft(MY_DRAFT_SLUG, '# Cold brew at home\n\nSteep coarse grounds overnight.\n');
    inShell('/cited/', createElement(CitedPage));
    openDetails();
    expect(screen.getByLabelText('Load a test pack')).toBeTruthy();
    expectNoScore('results, my post');
  });

  it('Research, where "score" is only the citation score of our tests', () => {
    inShell('/research/', createElement(ResearchPage));
    openDetails();
    // The page does use the measure's name, so the rule below reads real text.
    expect(shownText()).toMatch(/citation score/);
    expectNoScore('research', { research: true });
  });

  it('the About dialog', async () => {
    inShell('/', createElement('main'));
    fireEvent.click(within(screen.getByRole('contentinfo')).getByRole('button', { name: 'About' }));
    await screen.findByRole('dialog', { name: 'About' });
    expectNoScore('about');
  });
});

/** The engine's score functions and weights: a research API the app never calls. */
const SCORE_API = ['scoreChecks', 'PRESET_WEIGHTS', 'GRADE_WEIGHTS', 'UNSCORED_CHECKS'];

/**
 * The names each import (or re-export) statement in `source` brings in, by their exported name
 * (`a as b` gives `a`); a namespace import gives `* from <module>`.
 */
function importedNames(source: string): string[] {
  const names: string[] = [];
  const statements = /\b(?:import|export)\s+(?:type\s+)?([\w$*\s{},]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const [, clause = '', module] of source.matchAll(statements)) {
    if (/\*\s+as\s+[\w$]+/.test(clause)) names.push(`* from ${module}`);
    for (const part of (/\{([^}]*)\}/.exec(clause)?.[1] ?? '').split(',')) {
      const name = part
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

const root = join(__dirname, '..');

/** Every source file under app/, components/ and lib/, relative to the app root. */
function appSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', 'out', 'generated'].includes(name)) continue;
      const file = join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(relative(root, file).split(sep).join('/'));
    }
  };
  for (const dir of ['app', 'components', 'lib']) walk(join(root, dir));
  return out;
}

describe('no app source imports the score functions', () => {
  it('reads import statements of every form, by their exported names', () => {
    const source = [
      "import { analyze, type CheckId } from '@citation-equity/engine';",
      'import {',
      '  scoreChecks as score,',
      '  type PresetId,',
      "} from '@citation-equity/engine';",
      "import Link from 'next/link';",
      "export { GRADE_WEIGHTS } from '@citation-equity/engine';",
      "import * as engine from '@citation-equity/engine';",
      "import './globals.css';",
    ].join('\n');
    expect(importedNames(source)).toEqual([
      'analyze',
      'CheckId',
      'scoreChecks',
      'PresetId',
      'GRADE_WEIGHTS',
      '* from @citation-equity/engine',
    ]);
  });

  it(`imports none of ${SCORE_API.join(', ')} anywhere under app, components or lib`, () => {
    const files = appSources();
    expect(files.length).toBeGreaterThan(40);
    const found = files.flatMap((file) =>
      importedNames(readFileSync(join(root, file), 'utf8'))
        .filter((name) => SCORE_API.includes(name) || name === '* from @citation-equity/engine')
        .map((name) => `${file}: ${name}`),
    );
    expect(found).toEqual([]);
  });
});

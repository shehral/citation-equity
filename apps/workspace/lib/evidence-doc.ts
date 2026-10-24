// Server-only: reads docs/evidence.md at build time for the /evidence page
// (Server Components run during `next build` for a static export).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHECK_IDS, type ParsedDraft, parseDraft } from '@citation-equity/engine';

export const REPO_URL = 'https://github.com/shehral/citation-equity';

/** An mdast node, typed through the engine (the workspace does not depend on mdast itself). */
export type MdNode = ParsedDraft['tree']['children'][number];

/** The repo root: the nearest folder up from the working directory with pnpm-workspace.yaml. */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const up = dirname(dir);
    if (up === dir) throw new Error('docs/evidence.md not found: no pnpm-workspace.yaml above cwd');
    dir = up;
  }
  return dir;
}

export function readEvidenceDoc(): string {
  return readFileSync(join(repoRoot(), 'docs', 'evidence.md'), 'utf8');
}

const isCheckSection = (node: MdNode) =>
  node.type === 'heading' &&
  node.depth === 2 &&
  node.children.some(
    (c) => c.type === 'inlineCode' && (CHECK_IDS as readonly string[]).includes(c.value),
  );

/**
 * The document's intro: everything after its H1 and before the first
 * per-check section (an H2 naming a check id in code). The page renders the
 * checks themselves from the registry.
 */
export function evidenceIntro(markdown: string): MdNode[] {
  const { children } = parseDraft(markdown).tree;
  const end = children.findIndex(isCheckSection);
  return children
    .slice(0, end === -1 ? children.length : end)
    .filter((n) => !(n.type === 'heading' && n.depth === 1));
}

/** Links relative to docs/ point at the file on GitHub, since the site does not serve docs/. */
export function docsHref(url: string): string {
  return /^(?:[a-z][a-z\d+.-]*:|#)/i.test(url) ? url : `${REPO_URL}/blob/main/docs/${url}`;
}

// Server-only: reads docs/evidence.md at build time for the /research page
// (Server Components run during `next build` for a static export).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CHECK_IDS, type CheckId, type ParsedDraft, parseDraft } from '@citation-equity/engine';
import { REPO_URL } from './links';

export { REPO_URL };

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

/** The check id an H2 names in inline code (`## Lists (\`lists\`)`), or null. */
function checkIdOf(node: MdNode): CheckId | null {
  if (node.type !== 'heading' || node.depth !== 2) return null;
  for (const c of node.children) {
    if (c.type === 'inlineCode' && (CHECK_IDS as readonly string[]).includes(c.value))
      return c.value as CheckId;
  }
  return null;
}

/** True for the paragraph that is exactly the bold label `**Sources**`. */
const isSourcesLabel = (node: MdNode) =>
  node.type === 'paragraph' &&
  node.children.length === 1 &&
  node.children[0]?.type === 'strong' &&
  node.children[0].children.some((c) => c.type === 'text' && c.value === 'Sources');

/**
 * Per check, the document's detail paragraphs: what follows the grade line and the summary (the
 * page renders those from the engine) up to the section's `**Sources**` label (the page renders
 * the sources from the engine too). The document's intro is not used: the page writes its own.
 */
export function checkDetails(markdown: string): Partial<Record<CheckId, MdNode[]>> {
  const { children } = parseDraft(markdown).tree;
  const details: Partial<Record<CheckId, MdNode[]>> = {};
  for (const [i, node] of children.entries()) {
    const id = checkIdOf(node);
    if (id === null) continue;
    const rest = children.slice(i + 1);
    const next = rest.findIndex((n) => n.type === 'heading' && n.depth <= 2);
    const section = next === -1 ? rest : rest.slice(0, next);
    const sources = section.findIndex(isSourcesLabel);
    // Skip "Grade: **...**" and the summary paragraph.
    details[id] = section
      .slice(0, sources === -1 ? section.length : sources)
      .filter((n) => n.type === 'paragraph')
      .slice(2);
  }
  return details;
}

/** Links relative to docs/ point at the file on GitHub, since the site does not serve docs/. */
export function docsHref(url: string): string {
  return /^(?:[a-z][a-z\d+.-]*:|#)/i.test(url) ? url : `${REPO_URL}/blob/main/docs/${url}`;
}

import type { ReactNode } from 'react';
import { docsHref, type MdNode } from '@/lib/evidence-doc';
import { cn } from '@/lib/utils';

const linkClass =
  'rounded-sm underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring';

type Parent = Extract<MdNode, { children: unknown[] }>;

function children(node: Parent): ReactNode {
  return (node.children as MdNode[]).map((child, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
    <MdBlock key={i} node={child} />
  ));
}

/**
 * Renders the mdast node types docs/evidence.md uses (headings, paragraphs,
 * lists, tables, emphasis, links, code). Anything else renders its children,
 * or nothing. Raw HTML is never rendered.
 */
function MdBlock({ node }: { node: MdNode }): ReactNode {
  switch (node.type) {
    case 'heading':
      return node.depth <= 2 ? (
        <h2 className="mt-8 mb-3 font-semibold text-xl">{children(node)}</h2>
      ) : (
        <h3 className="mt-6 mb-2 font-semibold text-lg">{children(node)}</h3>
      );
    case 'paragraph':
      return <p className="my-3 leading-relaxed">{children(node)}</p>;
    case 'text':
      return node.value;
    case 'strong':
      return <strong className="font-semibold">{children(node)}</strong>;
    case 'emphasis':
      return <em>{children(node)}</em>;
    case 'inlineCode':
      return <code className="rounded bg-muted px-1 font-mono text-[0.9em]">{node.value}</code>;
    case 'break':
      return <br />;
    case 'link':
      return (
        <a href={docsHref(node.url)} target="_blank" rel="noreferrer" className={linkClass}>
          {children(node)}
        </a>
      );
    case 'list': {
      const Tag = node.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('my-3 space-y-1.5 pl-6', node.ordered ? 'list-decimal' : 'list-disc')}>
          {children(node)}
        </Tag>
      );
    }
    case 'listItem':
      // Tight list items hold one paragraph; render it inline.
      return (
        <li className="leading-relaxed">
          {node.children.map((child, i) =>
            child.type === 'paragraph' && !node.spread ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
              <span key={i}>{children(child)}</span>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
              <MdBlock key={i} node={child} />
            ),
          )}
        </li>
      );
    case 'table': {
      const [head, ...rows] = node.children;
      return (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {head && (
              <thead>
                <tr className="border-b">
                  {head.children.map((cell, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
                    <th key={i} scope="col" className="px-2 py-1.5 text-left align-top font-medium">
                      {children(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody className="divide-y">
              {rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
                <tr key={r}>
                  {row.children.map((cell, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
                    <td key={i} className="px-2 py-1.5 align-top">
                      {children(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'blockquote':
      return <blockquote className="my-3 border-l-2 pl-4">{children(node)}</blockquote>;
    case 'code':
      return (
        <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          <code>{node.value}</code>
        </pre>
      );
    case 'thematicBreak':
      return <hr className="my-6" />;
    case 'html':
      return null;
    default:
      return 'children' in node ? children(node as Parent) : null;
  }
}

export function Markdown({ nodes }: { nodes: MdNode[] }) {
  return (
    <>
      {nodes.map((node, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
        <MdBlock key={i} node={node} />
      ))}
    </>
  );
}

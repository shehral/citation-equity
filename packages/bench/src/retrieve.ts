import MiniSearch from 'minisearch';
import type { PackDocument } from './types';

/**
 * BM25 top-k over whole documents (MiniSearch defaults: fields title + text, OR of query terms,
 * no prefix or fuzzy matching). Only documents that match at least one query term are returned,
 * so fewer than `k` come back when fewer match. Ties keep the input order.
 */
export function retrieve(docs: PackDocument[], query: string, k: number): PackDocument[] {
  const index = new MiniSearch<{ id: number; title: string; text: string }>({
    fields: ['title', 'text'],
  });
  index.addAll(docs.map((d, id) => ({ id, title: d.title, text: d.text })));
  return index
    .search(query)
    .map((hit) => ({ id: hit.id as number, score: hit.score }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, Math.max(0, k))
    .map((hit) => docs[hit.id]);
}

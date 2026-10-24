import type { Pack, PackDocument, PackQuery } from './types';
import { DRAFT_DOC_ID } from './types';

/** A pack file that does not match the Pack schema; `issues` lists every problem found. */
export class PackError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid pack: ${issues.join('; ')}`);
    this.name = 'PackError';
    this.issues = issues;
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;

/**
 * Checks an untrusted value (for example parsed JSON) against the Pack schema and returns a clean
 * copy with only known fields. A missing document title becomes ''. Throws PackError naming each
 * problem by path, e.g. `queries[0].documents[2].text must be a string`.
 */
export function validatePack(x: unknown): Pack {
  if (!isObj(x)) throw new PackError(['pack must be a JSON object']);
  const issues: string[] = [];
  const need = (ok: boolean, msg: string) => {
    if (!ok) issues.push(msg);
  };

  need(x.schemaVersion === 1, 'schemaVersion must be 1');
  need(isText(x.packId), 'packId must be a non-empty string');
  need(typeof x.title === 'string', 'title must be a string');
  need(typeof x.source === 'string', 'source must be a string');
  need(typeof x.license === 'string', 'license must be a string');
  need(typeof x.synthetic === 'boolean', 'synthetic must be true or false');

  const queries: PackQuery[] = [];
  if (!Array.isArray(x.queries) || x.queries.length === 0) {
    issues.push('queries must be a non-empty array');
  } else {
    const queryIds = new Set<string>();
    x.queries.forEach((q: unknown, qi) => {
      const at = `queries[${qi}]`;
      if (!isObj(q)) {
        issues.push(`${at} must be an object`);
        return;
      }
      if (isText(q.queryId)) {
        need(!queryIds.has(q.queryId), `${at}: duplicate queryId "${q.queryId}"`);
        queryIds.add(q.queryId);
      } else {
        issues.push(`${at}.queryId must be a non-empty string`);
      }
      need(isText(q.query), `${at}.query must be a non-empty string`);
      const documents: PackDocument[] = [];
      if (!Array.isArray(q.documents) || q.documents.length === 0) {
        issues.push(`${at}.documents must be a non-empty array`);
      } else {
        const docIds = new Set<string>();
        q.documents.forEach((d: unknown, di) => {
          const doc = validateDocument(d, `${at}.documents[${di}]`, docIds, issues);
          if (doc) documents.push(doc);
        });
      }
      queries.push({ queryId: q.queryId as string, query: q.query as string, documents });
    });
  }

  if (issues.length > 0) throw new PackError(issues);
  return {
    schemaVersion: 1,
    packId: x.packId as string,
    title: x.title as string,
    source: x.source as string,
    license: x.license as string,
    synthetic: x.synthetic as boolean,
    queries,
  };
}

function validateDocument(
  d: unknown,
  at: string,
  docIds: Set<string>,
  issues: string[],
): PackDocument | undefined {
  if (!isObj(d)) {
    issues.push(`${at} must be an object`);
    return undefined;
  }
  if (isText(d.docId)) {
    if (d.docId === DRAFT_DOC_ID) {
      issues.push(`${at}.docId "${DRAFT_DOC_ID}" is reserved for the draft under test`);
    } else if (docIds.has(d.docId)) {
      issues.push(`${at}: duplicate docId "${d.docId}" in this query`);
    }
    docIds.add(d.docId);
  } else {
    issues.push(`${at}.docId must be a non-empty string`);
  }
  if (d.title !== undefined && typeof d.title !== 'string')
    issues.push(`${at}.title must be a string`);
  if (typeof d.text !== 'string') issues.push(`${at}.text must be a string`);
  if (d.url !== undefined && typeof d.url !== 'string') issues.push(`${at}.url must be a string`);
  if (typeof d.synthetic !== 'boolean') issues.push(`${at}.synthetic must be true or false`);
  const doc: PackDocument = {
    docId: d.docId as string,
    title: typeof d.title === 'string' ? d.title : '',
    text: d.text as string,
    synthetic: d.synthetic as boolean,
  };
  if (typeof d.url === 'string') doc.url = d.url;
  return doc;
}

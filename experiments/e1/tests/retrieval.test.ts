// Tests for experiments/e1/retrieval.ts (Node's test runner through tsx):
//   pnpm --filter @citation-equity/bench exec tsx --test "$PWD/experiments/e1/tests/retrieval.test.ts"
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type PageRow, rankVersions, type VersionRow } from '../retrieval';

function page(page_id: string, query_id: string, role: PageRow['role'], text: string): PageRow {
  return { page_id, query_id, set: 'main', query: 'espresso bitter', title: '', text, role };
}

const pages: PageRow[] = [
  page('a-target', 'qa', 'target', 'nothing relevant here'),
  page('a-c1', 'qa', 'competitor', 'espresso bitter espresso bitter'),
  page('a-c2', 'qa', 'competitor', 'espresso tastes fine'),
  page('a-c3', 'qa', 'competitor', 'tea leaves'),
  page('a-donor', 'qa', 'donor', 'espresso bitter espresso bitter espresso bitter'),
  page('b-target', 'qb', 'target', 'espresso'),
  page('b-c1', 'qb', 'competitor', 'milk'),
  page('b-c2', 'qb', 'competitor', 'sugar'),
  page('b-c3', 'qb', 'competitor', 'water'),
  { ...page('z-other', 'qz', 'target', 'espresso bitter'), set: 'replication' },
];

function version(arm: string, text: string, valid = true): VersionRow {
  return { version_id: `qa:${arm}`, query_id: 'qa', arm, title: '', text, valid };
}

test('the pool is the set minus donors, and only the target is replaced per version', () => {
  const rows = rankVersions(pages, [version('original', pages[0].text)], 'main');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pool_size, 8);
  // The original matches no term: it ranks after every matching page, ties broken by docId.
  assert.equal(rows[0].matched, false);
  assert.equal(rows[0].top8, false);
  assert.equal(rows[0].rank_own, 4);
});

test('an edit that adds the query terms moves the target up', () => {
  const rows = rankVersions(
    pages,
    [
      version('original', pages[0].text),
      version('12', 'espresso bitter espresso bitter espresso bitter'),
    ],
    'main',
  );
  const edited = rows.find((r) => r.arm === '12');
  assert.ok(edited);
  assert.equal(edited.rank_pool, 1);
  assert.equal(edited.rank_own, 1);
  assert.equal(edited.top8, true);
  assert.equal(edited.matched, true);
});

test('ties are broken by docId', () => {
  // a-c1 and the edited target have the same text, so the same score; "a-c1" < "a-target".
  const rows = rankVersions(pages, [version('3', pages[1].text)], 'main');
  assert.equal(rows[0].rank_pool, 2);
  assert.equal(rows[0].rank_own, 2);
});

test('invalid versions are skipped', () => {
  assert.deepEqual(rankVersions(pages, [version('5', 'espresso', false)], 'main'), []);
});

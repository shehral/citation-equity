import { describe, expect, it } from 'vitest';
import { parseTrancoList, siteSize, TrancoListError, trancoIdFromFileName } from '../src/index';

const CSV = '1,google.com\n2,quora.com\n3,Example.org\n';

describe('parseTrancoList', () => {
  it('reads rank,domain lines', () => {
    const list = parseTrancoList(CSV, '6GWVX');
    expect(list.id).toBe('6GWVX');
    expect(list.depth).toBe(3);
    expect(list.rankOf('quora.com')).toBe(2);
    expect(list.rankOf('example.org')).toBe(3);
    expect(list.rankOf('EXAMPLE.ORG')).toBe(3);
    expect(list.rankOf('missing.com')).toBeUndefined();
  });

  it('tolerates a header, a byte order mark, CRLF, blank lines and spaces', () => {
    const list = parseTrancoList('\uFEFFrank,domain\r\n1, google.com\r\n\r\n2,quora.com \r\n');
    expect(list.depth).toBe(2);
    expect(list.rankOf('google.com')).toBe(1);
    expect(list.id).toBe('');
  });

  it('keeps the first rank of a domain listed twice', () => {
    expect(parseTrancoList('1,a.com\n2,b.com\n3,a.com').rankOf('a.com')).toBe(1);
  });

  it.each([
    ['', /no sites/],
    ['rank,domain\n', /no sites/],
    ['google.com\nquora.com', /Line 2 is not "rank,domain"/],
    ['1,google.com\n3,quora.com', /rank 3 where 2 was expected/],
    ['2,google.com', /rank 2 where 1 was expected/],
    ['1,google.com\n2,not a domain', /Line 2/],
    ['1,localhost', /Line 1/],
    ['{"pack": true}', /Line 1|no sites/],
  ])('rejects %j', (text, message) => {
    expect(() => parseTrancoList(text)).toThrow(TrancoListError);
    expect(() => parseTrancoList(text)).toThrow(message);
  });

  it('feeds siteSize: a site missing from a short list is never called small', () => {
    const short = parseTrancoList(CSV);
    expect(siteSize('www.quora.com', short).size).toBe('big');
    expect(siteSize('hivecraft-notes.example', short).size).toBe('unknown');
  });

  it('reads a million lines in well under a few seconds', () => {
    const lines = Array.from({ length: 1_000_000 }, (_, i) => `${i + 1},site${i + 1}.com`);
    const started = Date.now();
    const list = parseTrancoList(lines.join('\n'));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(list.depth).toBe(1_000_000);
    expect(siteSize('site10001.com', list).size).toBe('mid');
    expect(siteSize('not-listed.com', list).size).toBe('small');
  });
});

describe('trancoIdFromFileName', () => {
  it.each([
    ['tranco_6GWVX.csv', '6GWVX'],
    ['tranco_qxw4-1m.csv.zip', 'QXW4'],
    ['top-1m.csv', ''],
    ['my list.csv', ''],
  ])('%s -> %j', (name, id) => {
    expect(trancoIdFromFileName(name)).toBe(id);
  });
});

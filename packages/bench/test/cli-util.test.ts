import { describe, expect, it } from 'vitest';
import { printable } from '../src/node/cli-util';

describe('printable', () => {
  it('prints every C0 and C1 control character as "?" and keeps other text', () => {
    expect(printable('\u001b[31mRED\u001b[0m Evil')).toBe('?[31mRED?[0m Evil');
    expect(printable('a\nb\r\tc\u0000d\u007fe\u009bf')).toBe('a?b??c?d?e?f');
    expect(printable('Café, naïve, 日本語 ok')).toBe('Café, naïve, 日本語 ok');
  });
});

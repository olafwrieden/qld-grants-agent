import { describe, expect, it } from 'vitest';
import { parseQldDate } from '../src/lib/dates.js';

describe('parseQldDate', () => {
  it.each([
    ['2025-09-29 00:00:00', '2025-09-29T00:00:00+10:00'],
    ['2025/09/29', '2025-09-29T00:00:00+10:00'],
    ['6/04/2022', '2022-04-06T00:00:00+10:00'],
    ['30/01/2023', '2023-01-30T00:00:00+10:00'],
    ['30/01/23', '2023-01-30T00:00:00+10:00'],
    ['5-Feb-26', '2026-02-05T00:00:00+10:00'],
    ['16-Apr-26', '2026-04-16T00:00:00+10:00'],
  ])('parses %s', (input, expected) => {
    expect(parseQldDate(input)).toBe(expected);
  });

  it.each(['', '   ', 'TBC', '31/02/2026', '12-Foo-26', null, undefined])('returns null for %s', (input) => {
    expect(parseQldDate(input)).toBeNull();
  });
});

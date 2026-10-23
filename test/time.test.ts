import { describe, expect, it } from 'vitest';
import { formatDuration, since } from '../src/core/time';

describe('formatDuration', () => {
  it('reads as seconds, then minutes, then hours', () => {
    expect(formatDuration(14_200)).toBe('14s');
    expect(formatDuration(125_000)).toBe('2m 05s');
    expect(formatDuration(3_780_000)).toBe('1h 03m');
  });
});

describe('since', () => {
  it('is the time from a timestamp to now, if both make sense', () => {
    const t = '2026-10-21T17:00:00.000Z';
    expect(since(t, Date.parse(t) + 2500)).toBe(2500);
    expect(since(t, Date.parse(t) - 1)).toBeUndefined();
    expect(since('', Date.now())).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { atEnd, keepFollowing } from '../src/webview/follow';

describe('atEnd', () => {
  it('counts the last line or so as the end', () => {
    expect(
      atEnd({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 }),
    ).toBe(true);
    expect(
      atEnd({ scrollHeight: 1000, scrollTop: 570, clientHeight: 400 }),
    ).toBe(true);
    expect(
      atEnd({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }),
    ).toBe(false);
  });
});

describe('keepFollowing', () => {
  it('keeps following when nothing grew since the last scroll to the end', () => {
    expect(
      keepFollowing(
        { scrollHeight: 1000, scrollTop: 600, clientHeight: 400 },
        1000,
      ),
    ).toBe(true);
  });

  it('keeps following when only the window got smaller', () => {
    // Same content, a shorter view: the end moved away, but not the reader.
    expect(
      keepFollowing(
        { scrollHeight: 1000, scrollTop: 600, clientHeight: 250 },
        1000,
      ),
    ).toBe(true);
  });

  it('stops when a step opened near the end pushed it out of view', () => {
    // At the end at 1000px; then a step's output added 300px without a scroll.
    expect(
      keepFollowing(
        { scrollHeight: 1300, scrollTop: 600, clientHeight: 400 },
        1000,
      ),
    ).toBe(false);
  });

  it('keeps following when the growth still leaves the reader at the end', () => {
    expect(
      keepFollowing(
        { scrollHeight: 1020, scrollTop: 600, clientHeight: 400 },
        1000,
      ),
    ).toBe(true);
  });
});

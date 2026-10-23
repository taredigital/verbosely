import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../src/core/events';
import { upsert } from '../src/webview/useFeed';

const say = (id: string, text = id): FeedItem => ({
  agent: 'claude',
  timestamp: '',
  kind: 'narration',
  id,
  text,
});
const ids = (items: FeedItem[]) => items.map((item) => item.id);

describe('upsert', () => {
  it('replaces known items in place and appends new ones', () => {
    const next = upsert([say('a'), say('b')], [say('a', 'changed'), say('c')]);
    expect(ids(next)).toEqual(['a', 'b', 'c']);
    expect(next[0].kind === 'narration' && next[0].text).toBe('changed');
  });

  it('drops the oldest items past maxItems, like the host', () => {
    const next = upsert(
      [say('a'), say('b'), say('c')],
      [say('d'), say('e')],
      3,
    );
    expect(ids(next)).toEqual(['c', 'd', 'e']);
  });

  it('keeps everything when no cap was sent', () => {
    const next = upsert([say('a'), say('b')], [say('c')]);
    expect(ids(next)).toEqual(['a', 'b', 'c']);
  });
});

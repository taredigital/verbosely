import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../src/core/events';
import { revealChain, shownIds, splitTopLevel } from '../src/webview/rows';

const base = { agent: 'claude' as const, timestamp: '2026-10-22T10:00:00Z' };
const agent = (id: string, parentId?: string): FeedItem => ({
  ...base,
  kind: 'tool',
  id,
  callId: `c-${id}`,
  name: 'Agent',
  title: id,
  status: 'ok',
  spawnsAgent: true,
  parentId,
});
const say = (id: string, parentId?: string): FeedItem => ({
  ...base,
  kind: 'narration',
  id,
  text: id,
  parentId,
});

const shown = (items: FeedItem[]) => {
  const { top, childrenOf } = splitTopLevel(items);
  return shownIds(top, childrenOf);
};

describe('shownIds', () => {
  it('holds the top level and every subagent level under it', () => {
    const items = [
      say('main'),
      agent('outer'),
      agent('inner', 'c-outer'),
      say('deep', 'c-inner'),
    ];
    expect([...shown(items)].sort()).toEqual(
      ['deep', 'inner', 'main', 'outer'].sort(),
    );
  });

  it('leaves out subagent work whose launch was trimmed', () => {
    // The main log was trimmed, so the Agent call is gone but the subagent's
    // own file was read. Its rows render nowhere, so it has no mark either.
    const items = [
      say('sub-msg', 'c-gone'),
      agent('orphan', 'c-gone'),
      say('orphan-child', 'c-orphan'),
      say('main-msg'),
    ];
    expect([...shown(items)]).toEqual(['main-msg']);
  });
});

describe('revealChain', () => {
  const items = [
    agent('outer'),
    agent('inner', 'c-outer'),
    say('deep', 'c-inner'),
    say('main'),
  ];

  it('falls back through every subagent box, out to the top level', () => {
    expect(revealChain('deep', items)).toEqual(['deep', 'inner', 'outer']);
  });

  it('is just the item at the top level', () => {
    expect(revealChain('main', items)).toEqual(['main']);
  });

  it('is just the id for an item the feed no longer has', () => {
    expect(revealChain('gone', items)).toEqual(['gone']);
  });

  it('stops on a loop in malformed parents', () => {
    const loop = [agent('a', 'c-b'), agent('b', 'c-a'), say('x', 'c-a')];
    expect(revealChain('x', loop)).toEqual(['x', 'a', 'b']);
  });
});

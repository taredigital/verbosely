import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../src/core/events';
import { failuresThisTurn } from '../src/core/failures';

const base = { agent: 'claude' as const, timestamp: '' };
const prompt = (id: string): FeedItem => ({
  ...base,
  id,
  kind: 'prompt',
  text: 'go',
});
const tool = (
  id: string,
  status: 'ok' | 'error' | 'running',
  extra: Partial<Extract<FeedItem, { kind: 'tool' }>> = {},
): FeedItem => ({
  ...base,
  id,
  kind: 'tool',
  callId: `c-${id}`,
  name: 'Bash',
  title: id,
  status,
  ...extra,
});

describe('failuresThisTurn', () => {
  it('lists failed steps since the last prompt, newest first', () => {
    const items = [
      tool('old', 'error'),
      prompt('p'),
      tool('a', 'error'),
      tool('b', 'ok'),
      tool('c', 'error'),
      tool('d', 'running'),
    ];
    expect(failuresThisTurn(items).map((f) => f.tool.id)).toEqual(['c', 'a']);
  });

  it('points a subagent failure at the box of the step that launched it', () => {
    const inner = tool('inner', 'error', { parentId: 'c-agent' });
    const items = [
      prompt('p'),
      tool('agent', 'ok', { spawnsAgent: true }),
      inner,
      // A subagent's own prompt doesn't end the turn.
      { ...prompt('sub'), parentId: 'c-agent' },
    ];
    expect(failuresThisTurn(items)).toEqual([
      { tool: inner, revealId: 'agent' },
    ]);
  });

  it('is empty when nothing failed', () => {
    expect(failuresThisTurn([prompt('p'), tool('a', 'ok')])).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { FeedItem, SessionInfo } from '../src/core/events';
import type { FeedController, FeedListener } from '../src/core/FeedController';

const bar = vi.hoisted(() => ({
  text: '',
  tooltip: '',
  accessibilityInformation: { label: '' },
  show() {},
  dispose() {},
}));

vi.mock('vscode', () => ({
  StatusBarAlignment: { Right: 2 },
  window: { createStatusBarItem: () => bar },
}));

import { createStatusItem, liveSession } from '../src/view/StatusItem';

const session = (key: string, extra: Partial<SessionInfo>): SessionInfo => ({
  key,
  agent: 'claude',
  sessionId: key,
  title: `title ${key}`,
  file: `${key}.jsonl`,
  mtime: 0,
  live: false,
  ...extra,
});

const old = session('old', {});
const idle = session('idle', { live: true, status: 'idle' });
const busy = session('busy', { live: true, status: 'busy' });

const failed: FeedItem[] = [
  {
    agent: 'claude',
    kind: 'tool',
    id: 't1',
    callId: 'c1',
    name: 'Bash',
    title: 'run',
    timestamp: '',
    status: 'error',
  },
];

function status(sessions: SessionInfo[], shown: SessionInfo, items = failed) {
  let listener: FeedListener | undefined;
  const controller = {
    subscribe: (l: FeedListener) => {
      listener = l;
      return { dispose() {} };
    },
    items: () => items,
  } as unknown as FeedController;
  createStatusItem(controller);
  listener!.onSessions(sessions, shown.key, false);
  listener!.onReset(shown, items, false);
  return bar;
}

describe('status bar', () => {
  it('reports the busiest live session', () => {
    expect(liveSession([old, idle, busy])).toBe(busy);
    expect(liveSession([old, idle])).toBe(idle);
    expect(liveSession([old])).toBeUndefined();
  });

  it('shows the agent working while an old session is picked', () => {
    const item = status([old, idle, busy], old);
    // The old session's failure would read as the live agent's: left out.
    expect(item.text).toBe('$(loading~spin) Claude');
    expect(item.tooltip).toContain('Claude is working: title busy');
    expect(item.tooltip).not.toContain('No live session');
    expect(item.tooltip).not.toContain('failed');
  });

  it('names the session shown when its failures are counted with none live', () => {
    const item = status([old], old);
    expect(item.text).toBe('$(list-flat) $(error) 1');
    expect(item.tooltip).toContain(
      '1 failed step since your last message in the session shown (title old)',
    );
    expect(item.accessibilityInformation.label).toContain('session shown');
  });

  it('does not name the session when the failures are the live one’s', () => {
    const item = status([old, busy], busy);
    expect(item.tooltip).toContain('1 failed step since your last message\n');
    expect(item.tooltip).not.toContain('session shown');
  });

  it('says no live session when none is', () => {
    const item = status([old], old, []);
    expect(item.text).toBe('$(list-flat)');
    expect(item.tooltip).toContain('No live session');
  });
});

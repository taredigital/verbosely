import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/AgentAdapter';
import type { FeedEvent, SessionInfo } from '../src/core/events';
import { FeedController, mergeByTime } from '../src/core/FeedController';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

/** An adapter with one session whose every log line is an Edit of `file`. */
function fakeAdapter(log: string): AgentAdapter {
  const session: SessionInfo = {
    key: 'claude:s1',
    agent: 'claude',
    sessionId: 's1',
    title: 'Test',
    file: log,
    mtime: Date.now(),
    live: false,
  };
  return {
    kind: 'claude',
    findSessions: () => [session],
    findExtraSources: () => [],
    parse(record): FeedEvent[] {
      const r = record as { id: string; file: string };
      return [
        {
          agent: 'claude',
          timestamp: '',
          kind: 'tool',
          id: r.id,
          callId: r.id,
          name: 'Edit',
          title: 'Edit',
          filePath: r.file,
        },
      ];
    },
  };
}

describe('FeedController.hasFile', () => {
  it('knows only the files the shown session touched', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-ctl-'));
    const log = path.join(dir, 's1.jsonl');
    fs.writeFileSync(log, '{"id":"a","file":"/repo/src/app.ts"}\n');
    const controller = new FeedController([fakeAdapter(log)], dir, {
      initialBytes: 1024,
      maxItems: 100,
      refreshMs: 60_000,
    });
    cleanup.push(() => {
      controller.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    expect(controller.hasFile('/repo/src/app.ts')).toBe(true);
    expect(controller.hasFile('/etc/passwd')).toBe(false);
    expect(controller.hasFile('/repo/src')).toBe(false);
  });
});

describe('opening a session with subagents', () => {
  /**
   * Main log and one subagent log; each record is
   * {"id","t" (seconds), "spawn"?: true}. The subagent's events nest under
   * the main log's "launch" call.
   */
  function setup(main: object[], sub: object[], maxItems: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-ctl-'));
    const log = path.join(dir, 's1.jsonl');
    const subLog = path.join(dir, 'agent-x.jsonl');
    const lines = (records: object[]) =>
      records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(log, lines(main));
    fs.writeFileSync(subLog, lines(sub));
    let title = 'Untitled';
    const session = (): SessionInfo => ({
      key: 'claude:s1',
      agent: 'claude',
      sessionId: 's1',
      title,
      file: log,
      mtime: Date.now(),
      live: false,
    });
    const adapter: AgentAdapter = {
      kind: 'claude',
      findSessions: () => [session()],
      findExtraSources: () => [
        { file: subLog, parentId: 'launch', idPrefix: 'x:' },
      ],
      parse(record, ctx): FeedEvent[] {
        const r = record as { id: string; t: number; spawn?: boolean };
        return [
          {
            agent: 'claude',
            timestamp: new Date(r.t * 1000).toISOString(),
            kind: 'tool',
            id: ctx.idPrefix + r.id,
            callId: r.id,
            name: r.spawn ? 'Agent' : 'Bash',
            title: r.id,
            spawnsAgent: r.spawn,
            parentId: ctx.parentId,
          },
        ];
      },
    };
    const controller = new FeedController([adapter], dir, {
      initialBytes: 1 << 20,
      maxItems,
      refreshMs: 60_000,
    });
    cleanup.push(() => {
      controller.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    return { controller, rename: (t: string) => (title = t) };
  }

  const main = [
    { id: 'm1', t: 1 },
    { id: 'launch', t: 2, spawn: true },
    { id: 'm2', t: 10 },
  ];
  const sub = [3, 4, 5, 6, 7].map((t) => ({ id: `s${t}`, t }));

  it('orders the subagent history by time, not after the main log', () => {
    const { controller } = setup(main, sub, 100);
    expect(controller.items().map((i) => i.id)).toEqual([
      'm1',
      'launch',
      'x:s3',
      'x:s4',
      'x:s5',
      'x:s6',
      'x:s7',
      'm2',
    ]);
  });

  it('trims the oldest entries, so the newest conversation survives', () => {
    const { controller } = setup(main, sub, 4);
    expect(controller.items().map((i) => i.id)).toEqual([
      'x:s5',
      'x:s6',
      'x:s7',
      'm2',
    ]);
  });

  it('reopens with new settings', () => {
    const { controller } = setup(main, sub, 4);
    controller.updateSettings({ initialBytes: 1 << 20, maxItems: 100 });
    expect(controller.items()).toHaveLength(8);
  });

  it('skips subagent logs launched before the loaded part of the session', () => {
    // The launch is not in the main log (it fell before the loaded tail), so
    // the subagent could never be shown: it is not read, now or on refresh.
    const { controller } = setup([{ id: 'm1', t: 1 }], sub, 100);
    expect(controller.items().map((i) => i.id)).toEqual(['m1']);
    controller.refresh();
    expect(controller.items().map((i) => i.id)).toEqual(['m1']);
  });

  it("keeps the shown session's title current", () => {
    const { controller, rename } = setup(main, sub, 100);
    rename('Fix the snooze button');
    controller.refresh();
    expect(controller.session?.title).toBe('Fix the snooze button');
  });
});

describe('mergeByTime', () => {
  const ev = (id: string, timestamp: string): FeedEvent => ({
    agent: 'claude',
    kind: 'narration',
    id,
    text: id,
    timestamp,
  });

  it('keeps an event without a time next to the one before it', () => {
    const merged = mergeByTime([
      [
        ev('a', '2026-10-21T17:00:01Z'),
        ev('b', ''),
        ev('c', '2026-10-21T17:00:05Z'),
      ],
      [ev('x', '2026-10-21T17:00:03Z')],
    ]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'x', 'c']);
  });

  it("keeps a source's own order when its times go backwards", () => {
    const merged = mergeByTime([
      [ev('a', '2026-10-21T17:00:05Z'), ev('b', '2026-10-21T17:00:01Z')],
    ]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

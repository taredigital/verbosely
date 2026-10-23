import { describe, expect, it } from 'vitest';
import { FeedStore } from '../src/core/FeedStore';

describe('step durations', () => {
  const base = { agent: 'claude' as const };
  const call = (callId: string, timestamp: string) => ({
    ...base,
    kind: 'tool' as const,
    id: `t-${callId}`,
    callId,
    name: 'Bash',
    title: `run ${callId}`,
    timestamp,
  });
  const result = (callId: string, timestamp: string, durationMs?: number) => ({
    ...base,
    kind: 'toolResult' as const,
    id: `r-${callId}`,
    callId,
    ok: true,
    preview: '',
    timestamp,
    durationMs,
  });

  it('is the time from the call to its result', () => {
    const store = new FeedStore(10);
    store.apply([
      call('a', '2026-10-21T17:00:00.000Z'),
      result('a', '2026-10-21T17:00:14.200Z'),
    ]);
    expect(store.all()[0]).toMatchObject({ status: 'ok', durationMs: 14200 });
  });

  it("prefers the log's own duration, and works when the result comes first", () => {
    const store = new FeedStore(10);
    store.apply([
      result('a', '2026-10-21T17:00:20.000Z', 3000),
      call('a', '2026-10-21T17:00:00.000Z'),
    ]);
    expect(store.all()[0]).toMatchObject({ durationMs: 3000 });
  });

  it('is left out when a timestamp is missing', () => {
    const store = new FeedStore(10);
    store.apply([call('a', ''), result('a', '2026-10-21T17:00:01.000Z')]);
    expect(store.all()[0]).toMatchObject({ durationMs: undefined });
  });
});

describe('two results for one call', () => {
  const base = { agent: 'codex' as const, timestamp: '' };
  const call = {
    ...base,
    kind: 'tool' as const,
    id: 't-a',
    callId: 'a',
    name: 'shell',
    title: 'npm test',
    timestamp: '2026-10-21T17:00:00.000Z',
  };
  // Codex CLI logs exec_command_end (with its own duration), then
  // function_call_output for the same call.
  const end = {
    ...base,
    kind: 'toolResult' as const,
    id: 'end-a',
    callId: 'a',
    ok: false,
    preview: 'exit 1',
    timestamp: '2026-10-21T17:00:14.000Z',
    durationMs: 14000,
  };
  const output = {
    ...base,
    kind: 'toolResult' as const,
    id: 'out-a',
    callId: 'a',
    ok: true,
    preview: 'Exit code: 1',
    timestamp: '2026-10-21T17:00:15.100Z',
  };

  it("keeps the log's own duration and the failure", () => {
    const store = new FeedStore(10);
    store.apply([call, end, output]);
    expect(store.all()[0]).toMatchObject({
      status: 'error',
      durationMs: 14000,
      result: 'exit 1',
    });
  });

  it('does the same when both arrive before the call', () => {
    const store = new FeedStore(10);
    store.apply([end, output, call]);
    expect(store.all()[0]).toMatchObject({
      status: 'error',
      durationMs: 14000,
    });
  });
});

describe('results without a tool', () => {
  it('are only held for the most recent calls', () => {
    const store = new FeedStore(10);
    const result = (n: number) => ({
      agent: 'claude' as const,
      timestamp: '',
      kind: 'toolResult' as const,
      id: `r${n}`,
      callId: `c${n}`,
      ok: true,
      preview: '',
    });
    const tool = (n: number) => ({
      agent: 'claude' as const,
      timestamp: '',
      kind: 'tool' as const,
      id: `t${n}`,
      callId: `c${n}`,
      name: 'Read',
      title: 'Read',
    });
    store.apply(Array.from({ length: 600 }, (_, n) => result(n)));
    store.apply([tool(0), tool(599)]);
    expect(store.all().map((t) => 'status' in t && t.status)).toEqual([
      'running',
      'ok',
    ]);
  });
});

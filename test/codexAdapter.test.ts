import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CodexAdapter } from '../src/adapters/CodexAdapter';
import type { FeedEvent } from '../src/core/events';
import { FeedStore } from '../src/core/FeedStore';
import { parseLines } from '../src/core/JsonlTailer';

const FIXTURES = path.join(__dirname, 'fixtures', 'codex');

function parseFile(name: string): FeedEvent[] {
  const adapter = new CodexAdapter('unused');
  const lines = fs.readFileSync(path.join(FIXTURES, name), 'utf8').split('\n');
  return parseLines(lines.filter(Boolean)).flatMap((r) =>
    adapter.parse(r, { idPrefix: '' }),
  );
}

describe('CodexAdapter, desktop format', () => {
  const events = parseFile('desktop.jsonl');
  const store = new FeedStore(100);
  store.apply(events);
  const items = store.all();

  it('produces one row per message, with no duplicates or injected context', () => {
    expect(items.map((i) => i.kind)).toEqual([
      'prompt',
      'narration',
      'tool',
      'tool',
      'tool',
      'narration',
    ]);
  });

  it('cleans plugin mentions out of the prompt', () => {
    expect(items[0]).toMatchObject({ text: '@Tasks show me the board' });
  });

  it('hides the exec script wrapper and shows the real commands', () => {
    const tools = items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.kind === 'tool' && t.title)).toEqual([
      'Read SKILL.md',
      'npm test',
      'tasks › tasks_list_boards',
    ]);
    expect(tools[0]).toMatchObject({
      filePath: 'C:/skills/SKILL.md',
      detail: "Get-Content -LiteralPath 'C:/skills/SKILL.md'",
    });
  });

  it("keeps the step's own duration when the log records one", () => {
    const tools = items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.kind === 'tool' && t.durationMs)).toEqual([
      0, 14250, 0,
    ]);
  });

  it('marks a non-zero exit code as failed', () => {
    const tools = items.filter((i) => i.kind === 'tool');
    expect(tools.map((t) => t.kind === 'tool' && t.status)).toEqual([
      'ok',
      'error',
      'ok',
    ]);
  });

  it('flags the final answer and skips encrypted reasoning', () => {
    expect(items[items.length - 1]).toMatchObject({
      kind: 'narration',
      final: true,
      text: 'Opened the board picker.',
    });
    expect(items.some((i) => i.kind === 'thinking')).toBe(false);
  });
});

describe('CodexAdapter, CLI format', () => {
  const store = new FeedStore(100);
  store.apply(parseFile('cli.jsonl'));
  const items = store.all();

  it('reads prompts, reasoning summaries, calls, narration and errors', () => {
    expect(items.map((i) => i.kind)).toEqual([
      'prompt',
      'thinking',
      'tool',
      'tool',
      'narration',
      'error',
      'interrupt',
    ]);
  });

  it('reads exit codes from JSON call output', () => {
    expect(items[2]).toMatchObject({
      title: 'npm test',
      status: 'error',
      result: '1 failing',
    });
  });

  it('names the file an apply_patch call edits', () => {
    expect(items[3]).toMatchObject({
      title: 'Edit sum.ts',
      status: 'ok',
      filePath: 'src/sum.ts',
    });
  });
});

describe('CodexAdapter session discovery', () => {
  it('finds sessions by working folder and titles them from the index', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-codex-'));
    const day = path.join(home, 'sessions', '2026', '10', '14');
    fs.mkdirSync(day, { recursive: true });
    const id = '0198f0a0-0000-7000-8000-00000000000d';
    const workspace = path.join(home, 'proj');
    const desktop = fs
      .readFileSync(path.join(FIXTURES, 'desktop.jsonl'), 'utf8')
      .replace('"D:\\\\proj"', JSON.stringify(workspace))
      .replace('["D:\\\\proj"]', JSON.stringify([workspace]));
    fs.writeFileSync(
      path.join(day, `rollout-2026-10-14T23-53-07-${id}.jsonl`),
      desktop,
    );
    fs.writeFileSync(
      path.join(
        day,
        'rollout-2026-10-14T23-59-00-0198f0a0-0000-7000-8000-000000000009.jsonl',
      ),
      '{"type":"session_meta","payload":{"cwd":"/somewhere/else"}}\n',
    );
    fs.writeFileSync(
      path.join(home, 'session_index.jsonl'),
      `{"id":"${id}","thread_name":"Old name"}\n{"id":"${id}","thread_name":"Show the board"}\n`,
    );

    const sessions = new CodexAdapter(home).findSessions(workspace);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      key: `codex:${id}`,
      agent: 'codex',
      title: 'Show the board',
      // Just written, and its last turn completed.
      live: true,
      status: 'idle',
    });
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('skips a log whose first line is damaged instead of failing the scan', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-codex-'));
    const day = path.join(home, 'sessions', '2026', '10', '20');
    fs.mkdirSync(day, { recursive: true });
    fs.writeFileSync(
      path.join(day, 'rollout-x-0198f0a0-0000-7000-8000-000000000003.jsonl'),
      '{"type":"session_meta","payload":{"cwd":"D:\\bad"}}\n',
    );
    expect(new CodexAdapter(home).findSessions(path.join(home, 'p'))).toEqual(
      [],
    );
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('falls back to the first prompt for a title and spots a busy turn', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-codex-'));
    const day = path.join(home, 'sessions', '2026', '10', '20');
    fs.mkdirSync(day, { recursive: true });
    const workspace = path.join(home, 'proj');
    fs.writeFileSync(
      path.join(day, 'rollout-x-0198f0a0-0000-7000-8000-000000000002.jsonl'),
      [
        { type: 'session_meta', payload: { cwd: workspace } },
        { type: 'event_msg', payload: { type: 'task_started' } },
        {
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: 'Refactor the parser\nplease',
          },
        },
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n',
    );
    const [session] = new CodexAdapter(home).findSessions(workspace);
    expect(session).toMatchObject({
      title: 'Refactor the parser',
      status: 'busy',
    });
    fs.rmSync(home, { recursive: true, force: true });
  });
});

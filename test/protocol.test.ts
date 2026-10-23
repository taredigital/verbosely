import { describe, expect, it } from 'vitest';
import { MAX_NOTE_LENGTH } from '../src/core/annotations';
import { parseWebviewMessage } from '../src/shared/protocol';

describe('parseWebviewMessage', () => {
  it('accepts every well-formed message', () => {
    const messages = [
      { type: 'ready' },
      { type: 'follow' },
      { type: 'export' },
      { type: 'selectSession', key: 'claude:abc' },
      { type: 'openFile', path: '/repo/src/app.ts' },
      { type: 'bookmark', sessionKey: 'claude:abc', id: 'x:0', on: true },
      { type: 'note', sessionKey: 'claude:abc', id: 'x:0', text: '' },
    ];
    for (const m of messages) expect(parseWebviewMessage(m)).toEqual(m);
  });

  it('drops anything malformed', () => {
    const bad: unknown[] = [
      null,
      'ready',
      [],
      {},
      { type: 'unknown' },
      { type: 'selectSession' },
      { type: 'selectSession', key: 42 },
      { type: 'openFile', path: '' },
      { type: 'openFile', path: 'x'.repeat(5000) },
      { type: 'bookmark', sessionKey: 'k', id: 'x', on: 'yes' },
      { type: 'note', sessionKey: 'k', id: 'x' },
      {
        type: 'note',
        sessionKey: 'k',
        id: 'x',
        text: 'x'.repeat(MAX_NOTE_LENGTH + 1),
      },
    ];
    for (const m of bad) expect(parseWebviewMessage(m)).toBeUndefined();
  });

  it('keeps only the fields it knows', () => {
    expect(parseWebviewMessage({ type: 'follow', extra: '<script>' })).toEqual({
      type: 'follow',
    });
  });
});

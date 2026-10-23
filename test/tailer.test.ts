import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonlTailer } from '../src/core/JsonlTailer';

const tmp: string[] = [];
afterEach(() => {
  for (const dir of tmp.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function tempFile(content: string | Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-tail-'));
  tmp.push(dir);
  const file = path.join(dir, 'log.jsonl');
  fs.writeFileSync(file, content);
  return file;
}

function collect(
  file: string,
  initialBytes = 1 << 20,
  limits: { maxReadBytes?: number; maxLineBytes?: number } = {},
) {
  const lines: string[] = [];
  const tailer = new JsonlTailer(file, (l) => lines.push(...l), {
    initialBytes,
    pollMs: 60_000,
    ...limits,
  });
  return { lines, tailer };
}

describe('JsonlTailer', () => {
  it('emits complete lines and holds back a partial last line', () => {
    const file = tempFile('{"a":1}\n{"b":');
    const { lines, tailer } = collect(file);
    tailer.start();
    expect(lines).toEqual(['{"a":1}']);

    fs.appendFileSync(file, '2}\n{"c":3}\n');
    tailer.read();
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    tailer.dispose();
  });

  it('only reads the tail of a large file and skips the cut line', () => {
    const file = tempFile('{"first":"' + 'x'.repeat(100) + '"}\n{"keep":1}\n');
    const { lines, tailer } = collect(file, 20);
    tailer.start();
    expect(lines).toEqual(['{"keep":1}']);
    tailer.dispose();
  });

  it('does not split a multi-byte character across reads', () => {
    const full = Buffer.from('{"t":"snooze ⏰ ok"}\n', 'utf8');
    const cut = full.indexOf(Buffer.from('⏰')) + 1; // mid-character
    const file = tempFile(full.subarray(0, cut));
    const { lines, tailer } = collect(file);
    tailer.start();
    fs.appendFileSync(file, full.subarray(cut));
    tailer.read();
    expect(lines).toEqual(['{"t":"snooze ⏰ ok"}']);
    tailer.dispose();
  });

  it('starts over when the file is truncated', () => {
    const file = tempFile('{"a":1}\n{"b":2}\n');
    const { lines, tailer } = collect(file);
    tailer.start();
    fs.writeFileSync(file, '{"new":1}\n');
    tailer.read();
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"new":1}']);
    tailer.dispose();
  });
});

describe('JsonlTailer limits', () => {
  it('reads a large append in bounded chunks, missing nothing', () => {
    const records = Array.from({ length: 50 }, (_, i) => `{"n":${i}}`);
    const file = tempFile(records.join('\n') + '\n');
    const { lines, tailer } = collect(file, 1 << 20, { maxReadBytes: 16 });
    tailer.start();
    expect(lines).toEqual(records);
    tailer.dispose();
  });

  it('drops a line that never ends and carries on after it', () => {
    const file = tempFile('{"a":1}\n' + 'x'.repeat(100));
    const { lines, tailer } = collect(file, 1 << 20, { maxLineBytes: 40 });
    tailer.start();
    fs.appendFileSync(file, 'x'.repeat(100) + '\n{"b":2}\n');
    tailer.read();
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    tailer.dispose();
  });

  it('survives the file disappearing', () => {
    const file = tempFile('{"a":1}\n');
    const { lines, tailer } = collect(file);
    tailer.start();
    fs.rmSync(file);
    expect(() => tailer.read()).not.toThrow();
    expect(lines).toEqual(['{"a":1}']);
    tailer.dispose();
  });
});

describe('JsonlTailer.trimmed', () => {
  it('reports whether the start of the file was skipped', () => {
    const small = collect(tempFile('{"a":1}\n'));
    small.tailer.start();
    expect(small.tailer.trimmed).toBe(false);
    small.tailer.dispose();

    const big = collect(
      tempFile('{"a":"' + 'x'.repeat(100) + '"}\n{"b":1}\n'),
      20,
    );
    big.tailer.start();
    expect(big.tailer.trimmed).toBe(true);
    big.tailer.dispose();
  });
});

describe('JsonlTailer edges', () => {
  it('keeps the first line when the cut lands exactly on a line start', () => {
    const kept = '{"k":1}\n{"k":2}\n';
    const file = tempFile('{"first":"' + 'x'.repeat(100) + '"}\n' + kept);
    const { lines, tailer } = collect(file, Buffer.byteLength(kept));
    tailer.start();
    expect(lines).toEqual(['{"k":1}', '{"k":2}']);
    tailer.dispose();
  });

  it('starts over when the file is replaced by a new one at least as large', () => {
    const file = tempFile('{"a":1}\n');
    const { lines, tailer } = collect(file);
    tailer.start();
    const next = file + '.new';
    fs.writeFileSync(next, '{"new":1}\n{"new":2}\n');
    fs.renameSync(next, file);
    tailer.read();
    expect(lines).toEqual(['{"a":1}', '{"new":1}', '{"new":2}']);
    tailer.dispose();
  });
});

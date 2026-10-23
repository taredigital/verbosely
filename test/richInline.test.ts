import { describe, expect, it } from 'vitest';
import { parseInline, type Inline } from '../src/webview/richInline';

/** The regex the parser replaced: right, but quadratic on hostile text. */
function before(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ kind: 'text', text: text.slice(last, index) });
    if (match[1] !== undefined) out.push({ kind: 'code', text: match[1] });
    else if (match[2] !== undefined) out.push({ kind: 'bold', text: match[2] });
    else out.push({ kind: 'link', text: match[3] });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** A small seeded generator, so a failure can be replayed. */
function random(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
}

describe('parseInline', () => {
  it('reads code, bold and links', () => {
    expect(
      parseInline('Run `npm test`, then **check** the [log](https://x).'),
    ).toEqual([
      { kind: 'text', text: 'Run ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ', then ' },
      { kind: 'bold', text: 'check' },
      { kind: 'text', text: ' the ' },
      { kind: 'link', text: 'log' },
      { kind: 'text', text: '.' },
    ]);
  });

  it.each([
    'plain text',
    '',
    'a `b` c `d` e',
    'unclosed `tick and **star and [bracket](',
    '``empty`` and ** ** and [](x) and [a]()',
    '***x** and **a*b** and *one*',
    '[a [b] c](d) and [x](y (z)) and [`code`](u)',
    '`a **b** c` then **`d`**',
    'multi\nline `code\nspan` and **bold\ntext**',
    '[link]\n(not a link) and [a](b\nc)',
  ])('gives what the old pattern gave for %j', (text) => {
    expect(parseInline(text)).toEqual(before(text));
  });

  it('matches the old pattern on thousands of random snippets', () => {
    const next = random(42);
    const chars = '`*[]()ab \n';
    for (let n = 0; n < 5000; n++) {
      let text = '';
      const length = Math.floor(next() * 24);
      for (let i = 0; i < length; i++)
        text += chars[Math.floor(next() * chars.length)];
      expect(parseInline(text), JSON.stringify(text)).toEqual(before(text));
    }
  });

  // The old pattern took 2.4 s on 128 KB of "[a](", and the feed re-ran it.
  it.each([
    ['unclosed links', '[a]('],
    ['unclosed brackets', '[a'],
    ['unclosed code', '`a'],
    ['unclosed bold', '**a*'],
    ['a mix', '[a](**`*['],
  ])('stays fast on 256 KB of %s', (_name, unit) => {
    const text = unit.repeat(Math.ceil((256 * 1024) / unit.length));
    const start = performance.now();
    const parts = parseInline(text);
    expect(performance.now() - start).toBeLessThan(200);
    expect(parts.map((p) => p.text).join('').length).toBeGreaterThan(0);
  });
});

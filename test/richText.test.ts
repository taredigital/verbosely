import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../src/webview/richBlocks';
import { richNodes } from '../src/webview/RichText';

/** All the text a rendered tree holds, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean')
    return '';
  if (typeof node === 'string' || typeof node === 'number') return `${node}`;
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf((node as VNode<{ children?: unknown }>).props.children);
}

describe('parseBlocks', () => {
  it('reads paragraphs, headings, lists, code and tables', () => {
    const blocks = parseBlocks(
      [
        '## Plan',
        'First line',
        'second line',
        '',
        '- one',
        '  - nested',
        '1. first',
        '```',
        'npm test',
        '```',
        '| a | b |',
        '| 1 | 2 |',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Plan' },
      { kind: 'paragraph', text: 'First line\nsecond line' },
      {
        kind: 'list',
        ordered: false,
        entries: [
          { text: 'one', nested: false },
          { text: 'nested', nested: true },
          { text: 'first', nested: false },
        ],
      },
      { kind: 'code', text: 'npm test' },
      { kind: 'table', text: '| a | b |\n| 1 | 2 |' },
    ]);
  });

  // Each of these once stopped a paragraph without starting any block, so
  // the parser never moved on and the view ran out of memory.
  it.each([
    ['a table without trailing pipes', '| a | b\n|---|---\n| 1 | 2'],
    ['a shell pipe at the start of a line', 'Then I ran:\n| grep foo'],
    ['text after the last pipe', '| a | b | <- note'],
    ['a lone pipe', 'ascii art\n|\nend'],
    ['an absolute value', '|x| is the magnitude'],
    ['a heading ending in a lone CR', '# Title\r'],
    ['a lone CR inside a table row', '| a \r b |'],
    ['a line separator inside a heading', '# Title more'],
    ['a line separator inside a table row', '| a   b |'],
  ])('finishes on %s and keeps the text', (_name, text) => {
    const blocks = parseBlocks(text);
    const words = text.match(/[a-z0-9]+/gi) ?? [];
    const kept = blocks.map((b) =>
      b.kind === 'list' ? b.entries.map((e) => e.text).join(' ') : b.text,
    );
    for (const word of words) expect(kept.join('\n')).toContain(word);
  });

  it('keeps a pipe line that is not a table row in its paragraph', () => {
    expect(parseBlocks('Then I ran:\n| grep foo\nand it worked')).toEqual([
      { kind: 'paragraph', text: 'Then I ran:\n| grep foo\nand it worked' },
    ]);
  });

  it('treats a lone CR as a line break', () => {
    expect(parseBlocks('# Title\rBody')).toEqual([
      { kind: 'heading', text: 'Title' },
      { kind: 'paragraph', text: 'Body' },
    ]);
  });
});

describe('RichText', () => {
  it('renders odd input as text', () => {
    const text = '| a | b\n| grep foo\n|\n# Title\r';
    expect(textOf(richNodes(text))).toContain('grep foo');
  });

  it('renders a hostile message quickly and as text', () => {
    const text = '[a]('.repeat(64 * 1024);
    const start = performance.now();
    const shown = textOf(richNodes(text));
    expect(performance.now() - start).toBeLessThan(200);
    expect(shown).toBe(text);
  });
});

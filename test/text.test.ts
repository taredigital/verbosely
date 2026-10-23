import { describe, expect, it } from 'vitest';
import {
  hasInvisible,
  preview,
  revealInvisible,
  stripInjected,
  truncate,
} from '../src/core/text';

describe('truncate', () => {
  it('shortens long text with an ellipsis', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(truncate('abc', 5)).toBe('abc');
  });

  it('never cuts an emoji in half', () => {
    const out = truncate('abc😀defgh', 5);
    expect(out).toBe('abc…');
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe('stripInjected', () => {
  it('removes closed harness tags and keeps the rest', () => {
    expect(
      stripInjected(
        'Fix it<system-reminder>be brief</system-reminder> please <app-context>x</app-context>',
      ),
    ).toBe('Fix it please');
  });

  it('leaves an unclosed tag as it is', () => {
    expect(stripInjected('a <system-reminder> b')).toBe(
      'a <system-reminder> b',
    );
  });

  it('stays fast on many unclosed tags (was 34 s for 1.6 MB)', () => {
    const hostile = '<system-reminder>'.repeat(100_000);
    const start = performance.now();
    expect(stripInjected(hostile)).toBe(hostile);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('stays fast when every tag is closed', () => {
    const many = '<system-reminder>x</system-reminder>'.repeat(50_000) + 'end';
    const start = performance.now();
    expect(stripInjected(many)).toBe('end');
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('preview', () => {
  it('says how much of a long output is not shown', () => {
    expect(preview('abcdef', 10)).toBe('abcdef');
    expect(preview('a'.repeat(700), 600)).toBe(
      'a'.repeat(600) + '\n… 100 characters more not shown',
    );
    expect(preview('a'.repeat(600 + 15 * 1024), 600)).toMatch(
      /… 15 KB more not shown$/,
    );
  });
});

describe('revealInvisible', () => {
  it('shows bidi controls and zero-width characters', () => {
    const command = 'echo safe\u202e; rm -rf ~\u200b';
    expect(hasInvisible(command)).toBe(true);
    expect(revealInvisible(command)).toBe(
      'echo safe⟨U+202E⟩; rm -rf ~⟨U+200B⟩',
    );
  });

  it('leaves ordinary text, emoji and accents alone', () => {
    const text = 'café ❤️ 漢字 naïve ok';
    expect(hasInvisible(text)).toBe(false);
    expect(revealInvisible(text)).toBe(text);
  });
});

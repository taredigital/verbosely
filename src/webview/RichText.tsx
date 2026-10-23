import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { parseBlocks, type Block } from './richBlocks';
import { parseInline } from './richInline';

// A deliberately small Markdown subset for agent narration: paragraphs,
// lists, headings, fenced code, tables (shown as code), `inline code`,
// **bold** and [links](…) rendered as plain text. It builds elements rather
// than HTML strings, so log content can never inject markup.

export function RichText({ text }: { text: string }) {
  // The feed re-renders every few seconds for its clocks; parse once per text.
  const nodes = useMemo(() => richNodes(text), [text]);
  return <div class="rich">{nodes}</div>;
}

/** The elements for a text, without the wrapper (and without hooks, for tests). */
export function richNodes(text: string): ComponentChildren[] {
  return parseBlocks(text).map(block);
}

function block(b: Block): ComponentChildren {
  switch (b.kind) {
    case 'code':
      return <pre class="code">{b.text}</pre>;
    case 'table':
      return <pre class="code table">{b.text}</pre>;
    case 'heading':
      return <p class="heading">{inline(b.text)}</p>;
    case 'list': {
      const entries = b.entries.map((entry) => (
        <li class={entry.nested ? 'nested' : undefined}>
          {inline(entry.text)}
        </li>
      ));
      return b.ordered ? <ol>{entries}</ol> : <ul>{entries}</ul>;
    }
    case 'paragraph':
      return <p>{inline(b.text)}</p>;
  }
}

function inline(text: string): ComponentChildren[] {
  return parseInline(text).map((part) => {
    switch (part.kind) {
      case 'text':
        return part.text;
      case 'code':
        return <code>{part.text}</code>;
      case 'bold':
        return <strong>{part.text}</strong>;
      case 'link':
        return <span class="link-text">{part.text}</span>;
    }
  });
}

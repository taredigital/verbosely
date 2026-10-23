// The inline part of RichText's Markdown subset: `code`, **bold** and
// [text](url) shown as its text. Kept apart from the rendering so it can be
// tested without a DOM.
//
// One pass, left to right. A regex that searches for each closing mark from
// every opening one goes quadratic on hostile text ("[a](" over and over,
// with no ")" anywhere: each "[" scans to the end). Here each closing mark
// is looked up through a `seeker` that never searches the same text twice,
// so the whole parse stays linear.

export interface Inline {
  kind: 'text' | 'code' | 'bold' | 'link';
  text: string;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const tick = seeker(text, '`');
  const star = seeker(text, '*');
  const bracket = seeker(text, ']');
  const paren = seeker(text, ')');
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    let kind: Inline['kind'] | undefined;
    let inner = '';
    let end = 0;
    const c = text[i];
    if (c === '`') {
      // `code`: up to the next backtick, not empty.
      const close = tick(i + 1);
      if (close > i + 1) {
        kind = 'code';
        inner = text.slice(i + 1, close);
        end = close + 1;
      }
    } else if (c === '*' && text[i + 1] === '*') {
      // **bold**: no star inside, so the next star must start the "**".
      const close = star(i + 2);
      if (close > i + 2 && text[close + 1] === '*') {
        kind = 'bold';
        inner = text.slice(i + 2, close);
        end = close + 2;
      }
    } else if (c === '[') {
      // [text](url): the next "]" must be followed by "(", then any ")".
      const close = bracket(i + 1);
      if (close > i + 1 && text[close + 1] === '(') {
        const shut = paren(close + 2);
        if (shut >= 0) {
          kind = 'link';
          inner = text.slice(i + 1, close);
          end = shut + 1;
        }
      }
    }
    if (!kind) continue;
    if (i > last) out.push({ kind: 'text', text: text.slice(last, i) });
    out.push({ kind, text: inner });
    last = end;
    i = end - 1;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/**
 * Finds the next `ch` at or after a position. The parse only ever asks from
 * the same place or further on, so a remembered answer still stands until
 * the position passes it, and no stretch of text is searched twice.
 */
function seeker(text: string, ch: string): (from: number) => number {
  let at = text.indexOf(ch);
  return (from) => {
    if (at !== -1 && at < from) at = text.indexOf(ch, from);
    return at;
  };
}

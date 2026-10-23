// The block structure of RichText's Markdown subset, kept apart from the
// rendering so it can be tested without a DOM.

export type Block =
  | { kind: 'code'; text: string }
  | { kind: 'table'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; entries: ListEntry[] }
  | { kind: 'paragraph'; text: string };

export interface ListEntry {
  text: string;
  nested: boolean;
}

// One pattern per block, used both to start a block and to end a paragraph,
// so the two can never disagree. The `s` flag lets `.` cross characters such
// as U+2028 that split no line here.
const FENCE = /^\s*```/;
const TABLE_ROW = /^\s*\|.*\|\s*$/s;
const HEADING = /^#{1,6}\s+(.*)$/s;
const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    TABLE_ROW.test(line) ||
    HEADING.test(line) ||
    LIST_ITEM.test(line)
  );
}

export function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split(/\r\n?|\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const body: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]))
        body.push(lines[i++]);
      out.push({ kind: 'table', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push({ kind: 'heading', text: heading[1] });
      i++;
      continue;
    }
    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const entries: ListEntry[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        entries.push({
          text: lines[i].replace(LIST_ITEM, ''),
          nested: /^\s{2,}/.test(lines[i]),
        });
        i++;
      }
      out.push({ kind: 'list', ordered, entries });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    // The line starts no block, so the paragraph always takes it: every pass
    // of the loop moves on at least one line.
    const para = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]))
      para.push(lines[i++]);
    out.push({ kind: 'paragraph', text: para.join('\n') });
  }
  return out;
}

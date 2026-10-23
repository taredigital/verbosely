import type { Annotation, Annotations } from '../core/annotations';
import type { FeedItem } from '../core/events';
import { firstLine, revealInvisible } from '../core/text';
import { parseInline } from './richInline';
import { stepRisks } from './whatRan';

export type ToolItem = Extract<FeedItem, { kind: 'tool' }>;
export type Filter = 'narration' | 'all';

export type Row =
  | { kind: 'item'; item: Exclude<FeedItem, ToolItem> }
  | { kind: 'tool'; item: ToolItem }
  | { kind: 'agent'; item: ToolItem; children: FeedItem[] }
  | { kind: 'steps'; key: string; tools: ToolItem[] };

/**
 * Turns a flat item list into the rows the timeline renders.
 *
 * Items that belong to a subagent nest under the tool call that launched it.
 * In "narration" mode, runs of ordinary tool calls collapse into one "steps"
 * row so the agent's own words carry the feed.
 */
export function buildRows(
  items: FeedItem[],
  filter: Filter,
  childrenOf: Map<string, FeedItem[]>,
): Row[] {
  const rows: Row[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    if (!run.length) return;
    rows.push({ kind: 'steps', key: `steps:${run[0].id}`, tools: run });
    run = [];
  };

  for (const item of items) {
    if (item.kind === 'tool' && item.spawnsAgent) {
      flush();
      rows.push({
        kind: 'agent',
        item,
        children: childrenOf.get(item.callId) ?? [],
      });
    } else if (item.kind === 'tool') {
      if (filter === 'narration') run.push(item);
      else rows.push({ kind: 'tool', item });
    } else {
      flush();
      rows.push({ kind: 'item', item });
    }
  }
  flush();
  return rows;
}

/** Splits items into top-level ones and children keyed by parent call id. */
export function splitTopLevel(items: FeedItem[]): {
  top: FeedItem[];
  childrenOf: Map<string, FeedItem[]>;
} {
  const spawners = new Set<string>();
  for (const item of items)
    if (item.kind === 'tool' && item.spawnsAgent) spawners.add(item.callId);
  const top: FeedItem[] = [];
  const childrenOf = new Map<string, FeedItem[]>();
  for (const item of items) {
    if (!item.parentId) {
      top.push(item);
    } else if (spawners.has(item.parentId)) {
      const list = childrenOf.get(item.parentId) ?? [];
      list.push(item);
      childrenOf.set(item.parentId, list);
    }
    // Otherwise the launch that owns it was trimmed from the start of a
    // large log. Showing it at the top level would put old subagent work at
    // the bottom of the feed, out of order, so leave it out.
  }
  return { top, childrenOf };
}

/** A row the reader bookmarked or wrote a note on. */
export function isMarked(annotation: Annotation | undefined): boolean {
  return Boolean(annotation?.bookmark || annotation?.note);
}

/** A one-line label for a row, for the bookmarks list. */
export function markLabel(item: FeedItem): string {
  switch (item.kind) {
    case 'tool':
      return revealInvisible(item.title);
    case 'prompt':
      return `You: ${firstLine(item.text)}`;
    default:
      return plainLine(item.text);
  }
}

/** A message's first line without its Markdown: no heading or list marks, code ticks, bold or link syntax. */
function plainLine(text: string): string {
  const line = firstLine(text).replace(/^[#>*\-\s]+/, '');
  return parseInline(line)
    .map((part) => part.text)
    .join('');
}

/**
 * The steps a shut group still shows: failed ones, ones the reader
 * bookmarked or wrote a note on, and ones `stepRisks` flags.
 */
export function stayInView(
  tools: ToolItem[],
  annotations: Annotations,
  workspace?: string,
): ToolItem[] {
  return tools.filter(
    (t) =>
      t.status === 'error' ||
      isMarked(annotations[t.id]) ||
      stepRisks(t, workspace).length > 0,
  );
}

/** How many of these steps are flagged. */
export function flaggedCount(tools: ToolItem[], workspace?: string): number {
  return tools.filter((t) => stepRisks(t, workspace).length > 0).length;
}

/**
 * How many flagged steps a subagent's box holds, counting those of the
 * subagents it launched in turn.
 */
export function flaggedInside(
  children: FeedItem[],
  childrenOf: Map<string, FeedItem[]>,
  workspace?: string,
): number {
  let count = 0;
  const seen = new Set<string>();
  const queue = [...children];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.kind !== 'tool' || seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.spawnsAgent) queue.push(...(childrenOf.get(item.callId) ?? []));
    else if (stepRisks(item, workspace).length) count++;
  }
  return count;
}

/**
 * The ids of the items the feed can show: the top level and, through each
 * subagent launch, its children. Subagent work whose launch was trimmed has
 * no row anywhere.
 */
export function shownIds(
  top: FeedItem[],
  childrenOf: Map<string, FeedItem[]>,
): Set<string> {
  const ids = new Set<string>();
  const queue = [...top];
  for (let item = queue.shift(); item; item = queue.shift()) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    if (item.kind === 'tool' && item.spawnsAgent)
      queue.push(...(childrenOf.get(item.callId) ?? []));
  }
  return ids;
}

/**
 * The rows that can stand for an item, innermost first: the item, then each
 * subagent launch around it, out to the top level. A shut box hides what is
 * inside it, so a jump lands on the first of these that is on screen.
 */
export function revealChain(id: string, items: FeedItem[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const launchers = new Map<string, FeedItem>();
  for (const item of items)
    if (item.kind === 'tool' && item.spawnsAgent)
      launchers.set(item.callId, item);
  const chain = [id];
  let parentId = byId.get(id)?.parentId;
  while (parentId) {
    const launcher = launchers.get(parentId);
    if (!launcher || chain.includes(launcher.id)) break;
    chain.push(launcher.id);
    parentId = launcher.parentId;
  }
  return chain;
}

/** The current turn: the top-level items from the last prompt on. */
export function currentTurn(top: FeedItem[]): FeedItem[] {
  for (let i = top.length - 1; i >= 0; i--)
    if (top[i].kind === 'prompt') return top.slice(i);
  return top;
}

/**
 * Whether a step started before the current turn. One still marked running
 * then never got its result, so it isn't still going.
 */
export function startedBefore(timestamp: string, turnStart?: string): boolean {
  if (!turnStart) return false;
  return Date.parse(timestamp) < Date.parse(turnStart);
}

/**
 * How long a subagent took: its launch's own duration, or the time from the
 * launch to the subagent's last activity when that is longer (a background
 * agent's launch returns straight away while it keeps working).
 */
export function agentTook(
  tool: ToolItem,
  lastChild?: FeedItem,
): number | undefined {
  const span = lastChild
    ? Date.parse(lastChild.timestamp) - Date.parse(tool.timestamp)
    : NaN;
  const known = [tool.durationMs, span].filter(
    (ms): ms is number => ms !== undefined && Number.isFinite(ms),
  );
  return known.length ? Math.max(...known) : undefined;
}

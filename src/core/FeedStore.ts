import type { FeedEvent, FeedItem } from './events';

type ToolItem = Extract<FeedItem, { kind: 'tool' }>;
type ToolResult = Extract<FeedEvent, { kind: 'toolResult' }>;

/**
 * Ordered feed items for one session.
 *
 * Tool results are folded into the tool item they answer, so the UI renders
 * one row per tool call. Changes are reported as batches of upserted items.
 */
export class FeedStore {
  private readonly items = new Map<string, FeedItem>();
  private order: string[] = [];
  private readonly toolsByCall = new Map<string, ToolItem>();
  /** Results that arrived before their tool call (rare, but logs interleave). */
  private readonly orphanResults = new Map<string, ToolResult[]>();

  constructor(private readonly maxItems: number) {}

  /** Applies events and returns the items that were added or changed. */
  apply(events: FeedEvent[]): FeedItem[] {
    const changed = new Map<string, FeedItem>();
    for (const event of events) {
      if (event.kind === 'toolResult') {
        const tool = this.toolsByCall.get(event.callId);
        if (!tool) {
          this.keepOrphan(event);
          continue;
        }
        finish(tool, event);
        changed.set(tool.id, tool);
        continue;
      }
      if (this.items.has(event.id)) continue;

      let item: FeedItem;
      if (event.kind === 'tool') {
        const tool: ToolItem = { ...event, status: 'running' };
        const early = this.orphanResults.get(event.callId);
        if (early) {
          this.orphanResults.delete(event.callId);
          for (const result of early) finish(tool, result);
        }
        this.toolsByCall.set(event.callId, tool);
        item = tool;
      } else {
        item = event;
      }
      this.items.set(item.id, item);
      this.order.push(item.id);
      changed.set(item.id, item);
    }
    this.trim();
    return [...changed.values()].filter((item) => this.items.has(item.id));
  }

  all(): FeedItem[] {
    return this.order.map((id) => this.items.get(id)!);
  }

  get size(): number {
    return this.order.length;
  }

  /**
   * Holds a result until its tool arrives. Results whose tool was trimmed or
   * fell before the loaded part of the log never match, so only the newest
   * are kept.
   */
  private keepOrphan(result: ToolResult): void {
    const early = this.orphanResults.get(result.callId);
    if (early) {
      early.push(result);
      return;
    }
    this.orphanResults.set(result.callId, [result]);
    if (this.orphanResults.size > MAX_ORPHANS) {
      const oldest = this.orphanResults.keys().next().value;
      if (oldest !== undefined) this.orphanResults.delete(oldest);
    }
  }

  private trim(): void {
    const excess = this.order.length - this.maxItems;
    if (excess <= 0) return;
    for (const id of this.order.slice(0, excess)) {
      const item = this.items.get(id);
      if (item?.kind === 'tool') this.toolsByCall.delete(item.callId);
      this.items.delete(id);
    }
    this.order = this.order.slice(excess);
  }
}

/** Results held for tools not seen yet. */
const MAX_ORPHANS = 500;

/**
 * Folds a result into its tool. The duration is the log's own figure when it
 * has one, else the time between the call and the result.
 *
 * Some logs record two results for one call (Codex CLI: exec_command_end and
 * function_call_output). The second only adds to the first: a failure in
 * either counts, and the log's own duration is kept.
 */
function finish(tool: ToolItem, result: ToolResult): void {
  const first = tool.status === 'running';
  tool.status = result.ok && tool.status !== 'error' ? 'ok' : 'error';
  if (first || !tool.result) tool.result = result.preview;
  const elapsed = Date.parse(result.timestamp) - Date.parse(tool.timestamp);
  const measured =
    Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
  tool.durationMs = first
    ? (result.durationMs ?? measured)
    : (result.durationMs ?? tool.durationMs ?? measured);
}

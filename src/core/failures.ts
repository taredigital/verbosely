import type { FeedItem } from './events';

export type ToolItem = Extract<FeedItem, { kind: 'tool' }>;

/**
 * Failed tool calls since the most recent prompt, newest first. Includes
 * steps inside subagents; `revealId` is the row the feed can scroll to (a
 * subagent's own steps live inside its collapsed box, so that box's row).
 */
export function failuresThisTurn(
  items: FeedItem[],
): { tool: ToolItem; revealId: string }[] {
  const launchers = new Map<string, string>();
  for (const item of items)
    if (item.kind === 'tool' && item.spawnsAgent)
      launchers.set(item.callId, item.id);

  const failed: { tool: ToolItem; revealId: string }[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === 'prompt' && !item.parentId) break;
    if (item.kind !== 'tool' || item.status !== 'error') continue;
    const revealId = item.parentId ? launchers.get(item.parentId) : item.id;
    if (revealId) failed.push({ tool: item, revealId });
  }
  return failed;
}

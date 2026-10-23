// What a step actually did, for its row. A step's headline is the agent's
// own claim (a command's description, written by the model), so the row also
// shows what ran: the command's first line, the files touched and anything
// `risksOf` flags. Kept apart from the rendering so it can be tested without
// a DOM.

import { displayPath, risksOf, type Risk } from '../core/risk';
import { hasInvisible, revealInvisible } from '../core/text';
import type { ToolItem } from './rows';

/** Tools whose detail is a shell command: Claude's two, Codex's one. */
const COMMANDS = new Set(['Bash', 'PowerShell', 'Shell']);

/** Tools whose detail lists the files they change (Codex edits several). */
const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'apply_patch']);

/** Line breaks, including the Unicode ones a browser may lay out as one. */
const LINE_BREAK = /\r\n?|\n|\u2028|\u2029/;

export function isCommand(tool: ToolItem): boolean {
  return COMMANDS.has(tool.name);
}

/**
 * A command as one line: its first non-blank line, invisible characters
 * shown and runs of spaces closed up (so padding can't push the rest out of
 * sight), and how many more non-blank lines follow.
 */
export function commandLine(command: string): { line: string; more: number } {
  const lines = command
    .split(LINE_BREAK)
    .map(revealInvisible)
    .filter((l) => l.trim());
  return { line: oneLine(lines[0] ?? ''), more: Math.max(lines.length - 1, 0) };
}

/**
 * The command line a row shows under its headline, or nothing when the
 * headline already is that line (a step the agent didn't describe).
 */
export function shownCommand(
  tool: ToolItem,
): { line: string; more: number; full: string } | undefined {
  if (!isCommand(tool) || !tool.detail?.trim()) return undefined;
  const { line, more } = commandLine(tool.detail);
  const title = oneLine(tool.title);
  const same =
    title === line ||
    (title.endsWith('…') && line.startsWith(title.slice(0, -1).trimEnd()));
  if (same && !more) return undefined;
  return { line, more, full: revealInvisible(tool.detail) };
}

/** The files a step reads or changes, as written in the log. */
export function stepPaths(tool: ToolItem): string[] {
  if (isCommand(tool)) return [];
  if (tool.filePath) return [tool.filePath];
  if (EDITS.has(tool.name))
    return (tool.detail ?? '').split('\n').filter((p) => p.trim());
  return [];
}

/**
 * The files a row shows: relative inside the workspace, whole outside it.
 * Nothing when the headline already says it ("Read package.json").
 */
export function shownPaths(
  tool: ToolItem,
  workspace?: string,
): string[] | undefined {
  const paths = stepPaths(tool).map((p) =>
    revealInvisible(displayPath(p, workspace)),
  );
  if (!paths.length) return undefined;
  if (paths.length === 1 && revealInvisible(tool.title).endsWith(paths[0]))
    return undefined;
  return paths;
}

const riskCache = new WeakMap<
  ToolItem,
  { workspace?: string; risks: Risk[] }
>();

/**
 * What `risksOf` flags, plus invisible characters in a command or a path.
 * Remembered per item: the feed re-renders every few seconds for its clocks,
 * and a changed step arrives as a new item.
 */
export function stepRisks(tool: ToolItem, workspace?: string): Risk[] {
  const hit = riskCache.get(tool);
  if (hit && hit.workspace === workspace) return hit.risks;
  const risks = tool.spawnsAgent ? [] : risksOf(tool, workspace);
  const raw = [isCommand(tool) ? (tool.detail ?? '') : '', ...stepPaths(tool)];
  if (raw.some(hasInvisible)) risks.push({ label: 'hidden characters' });
  riskCache.set(tool, { workspace, risks });
  return risks;
}

/** Revealed before trimming: trim() would drop a byte-order mark unseen. */
function oneLine(text: string): string {
  return revealInvisible(text).trim().replace(/\s+/g, ' ');
}

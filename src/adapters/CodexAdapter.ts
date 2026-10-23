import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeedEvent, SessionInfo, ToolEvent } from '../core/events';
import {
  asRecord,
  basename,
  contentToText,
  firstLine,
  preview,
  str,
  stripInjected,
  truncate,
} from '../core/text';
import type { AgentAdapter, ParseContext, SessionSource } from './AgentAdapter';
import { normalizePath, readChunk } from './files';

const RESULT_PREVIEW = 600;
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 256 * 1024;
/** A session counts as live if its log changed this recently. */
const LIVE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_ID =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

type Base = Pick<FeedEvent, 'agent' | 'timestamp' | 'parentId'>;
type ToolFields = Pick<ToolEvent, 'name' | 'title' | 'detail' | 'filePath'>;

interface FileInfo {
  mtime: number;
  /** Workspace roots the session ran in, normalised. */
  roots: string[];
  firstPrompt?: string;
  busy: boolean;
}

/**
 * Reads Codex's session logs:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl   one per session
 *   ~/.codex/session_index.jsonl                              thread titles
 *
 * Handles both the desktop app's format (completed items in event_msg
 * records, tools wrapped in an `exec` script) and the CLI's older
 * function_call / function_call_output records. Unknown records are ignored.
 */
export class CodexAdapter implements AgentAdapter {
  readonly kind = 'codex' as const;
  private readonly files = new Map<string, FileInfo>();

  constructor(
    private readonly home: string = path.join(os.homedir(), '.codex'),
  ) {}

  findSessions(workspacePath: string): SessionInfo[] {
    const wanted = normalizePath(workspacePath);
    const titles = this.readTitles();
    const now = Date.now();
    const sessions: SessionInfo[] = [];
    for (const file of listLogs(path.join(this.home, 'sessions'))) {
      const info = this.fileInfo(file);
      if (!info || !info.roots.includes(wanted)) continue;
      const sessionId = SESSION_ID.exec(file)?.[1] ?? basename(file);
      const live = now - info.mtime < LIVE_WINDOW_MS;
      sessions.push({
        key: `codex:${sessionId}`,
        agent: 'codex',
        sessionId,
        title:
          titles.get(sessionId) ??
          (info.firstPrompt ? truncate(info.firstPrompt, 60) : undefined) ??
          `Session ${new Date(info.mtime).toLocaleString()}`,
        file,
        mtime: info.mtime,
        live,
        status: live ? (info.busy ? 'busy' : 'idle') : undefined,
      });
    }
    return sessions.sort((a, b) => b.mtime - a.mtime);
  }

  findExtraSources(): SessionSource[] {
    return [];
  }

  parse(raw: unknown, ctx: ParseContext): FeedEvent[] {
    const record = asRecord(raw);
    const payload = asRecord(record?.payload);
    if (!record || !payload) return [];
    const base: Base = {
      agent: 'codex',
      timestamp: str(record.timestamp) ?? '',
      parentId: ctx.parentId,
    };
    const prefix = ctx.idPrefix;
    if (record.type === 'response_item')
      return parseResponseItem(payload, base, prefix);
    if (record.type === 'event_msg')
      return parseEventMsg(payload, base, prefix);
    return [];
  }

  /** Thread titles from the index; later lines rename earlier ones. */
  private readTitles(): Map<string, string> {
    const titles = new Map<string, string>();
    let text: string;
    try {
      text = fs.readFileSync(
        path.join(this.home, 'session_index.jsonl'),
        'utf8',
      );
    } catch {
      return titles;
    }
    for (const line of text.split('\n')) {
      try {
        const entry = asRecord(JSON.parse(line));
        const id = str(entry?.id);
        const name = str(entry?.thread_name);
        if (id && name) titles.set(id, name);
      } catch {
        // Skip blank or partial lines.
      }
    }
    return titles;
  }

  /** Cached per file; re-read only when the file changes. */
  private fileInfo(file: string): FileInfo | undefined {
    let mtime: number;
    let size: number;
    try {
      const stat = fs.statSync(file);
      mtime = stat.mtimeMs;
      size = stat.size;
    } catch {
      return undefined;
    }
    const cached = this.files.get(file);
    if (cached && cached.mtime === mtime) return cached;

    // The head never changes once the first prompt is written, so stop
    // re-reading it after that.
    const needHead = !cached || !cached.roots.length || !cached.firstPrompt;
    const head = needHead ? readChunk(file, 0, Math.min(size, HEAD_BYTES)) : '';
    const info: FileInfo = cached
      ? { ...cached, mtime }
      : { mtime, roots: [], busy: false };
    if (head) {
      if (!info.roots.length) info.roots = readRoots(head);
      info.firstPrompt ??= readFirstPrompt(head);
    }

    // Only recently active sessions can be busy; skip the read otherwise.
    if (Date.now() - mtime < LIVE_WINDOW_MS) {
      const tail = readChunk(file, Math.max(0, size - TAIL_BYTES), TAIL_BYTES);
      const started = tail.lastIndexOf('"type":"task_started"');
      const ended = Math.max(
        tail.lastIndexOf('"type":"task_complete"'),
        tail.lastIndexOf('"type":"turn_aborted"'),
      );
      info.busy = started > ended;
    } else {
      info.busy = false;
    }
    this.files.set(file, info);
    return info;
  }
}

function parseResponseItem(
  item: Record<string, unknown>,
  base: Base,
  prefix: string,
): FeedEvent[] {
  const id = `${prefix}${str(item.id) ?? str(item.call_id) ?? ''}`;
  switch (item.type) {
    case 'message': {
      // User messages here include injected context; prompts are read from
      // the cleaner UserMessage / user_message events instead.
      if (item.role !== 'assistant') return [];
      const text = contentToText(item.content).trim();
      if (!text) return [];
      return [
        {
          ...base,
          kind: 'narration',
          id,
          text,
          final: item.phase === 'final_answer',
        },
      ];
    }
    case 'reasoning': {
      const summary = Array.isArray(item.summary)
        ? contentToText(item.summary).trim()
        : '';
      return summary ? [{ ...base, kind: 'thinking', id, text: summary }] : [];
    }
    case 'function_call':
    case 'custom_tool_call':
    case 'local_shell_call': {
      const name = str(item.name) ?? 'shell';
      // The desktop app wraps real tools in a script; the commands inside it
      // are reported separately as CommandExecution / McpToolCall items.
      if (item.type === 'custom_tool_call' && name === 'exec') return [];
      const callId = str(item.call_id) ?? id;
      return [
        {
          ...base,
          kind: 'tool',
          id: `${prefix}call:${callId}`,
          callId,
          ...describeCall(item),
        },
      ];
    }
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const callId = str(item.call_id);
      if (!callId) return [];
      const { ok, text } = readCallOutput(item.output);
      return [
        {
          ...base,
          kind: 'toolResult',
          id: `${prefix}result:${callId}`,
          callId,
          ok,
          preview: preview(text, RESULT_PREVIEW),
        },
      ];
    }
    default:
      return [];
  }
}

function parseEventMsg(
  event: Record<string, unknown>,
  base: Base,
  prefix: string,
): FeedEvent[] {
  switch (event.type) {
    case 'item_completed': {
      const item = asRecord(event.item);
      return item ? parseCompletedItem(item, base, prefix) : [];
    }
    case 'user_message': {
      const text = stripInjected(str(event.message) ?? '');
      return text
        ? [
            {
              ...base,
              kind: 'prompt',
              id: `${prefix}um:${base.timestamp}`,
              text,
            },
          ]
        : [];
    }
    case 'exec_command_end': {
      const callId = str(event.call_id);
      if (!callId) return [];
      const output =
        str(event.aggregated_output) ??
        [str(event.stdout), str(event.stderr)].filter(Boolean).join('\n');
      return [
        {
          ...base,
          kind: 'toolResult',
          id: `${prefix}end:${callId}`,
          callId,
          ok: event.exit_code === 0,
          preview: preview(output.trim(), RESULT_PREVIEW),
          durationMs: readDuration(event.duration),
        },
      ];
    }
    case 'error':
    case 'stream_error': {
      const text = str(event.message) ?? 'Codex reported an error';
      return [
        { ...base, kind: 'error', id: `${prefix}err:${base.timestamp}`, text },
      ];
    }
    case 'turn_aborted':
      return [
        {
          ...base,
          kind: 'interrupt',
          id: `${prefix}abort:${base.timestamp}`,
          text: `Turn stopped${str(event.reason) ? ` (${str(event.reason)})` : ''}`,
        },
      ];
    default:
      return [];
  }
}

/** Desktop-app items arrive complete, so each yields a tool and its result. */
function parseCompletedItem(
  item: Record<string, unknown>,
  base: Base,
  prefix: string,
): FeedEvent[] {
  const itemId = str(item.id) ?? '';
  const id = `${prefix}${itemId}`;
  const tool = (
    fields: ToolFields,
    ok: boolean,
    output: string,
  ): FeedEvent[] => [
    { ...base, kind: 'tool', id, callId: itemId, ...fields },
    {
      ...base,
      kind: 'toolResult',
      id: `${id}:result`,
      callId: itemId,
      ok,
      preview: preview(output.trim(), RESULT_PREVIEW),
      durationMs: readDuration(item.duration),
    },
  ];

  switch (item.type) {
    case 'UserMessage': {
      const text = stripInjected(contentToText(item.content))
        // Mentions look like [@Plugin](plugin://id); keep just the name.
        .replace(/\[(@[^\]]+)\]\([a-z]+:\/\/[^)]*\)/g, '$1');
      return text ? [{ ...base, kind: 'prompt', id, text }] : [];
    }
    case 'CommandExecution': {
      const command = shellCommand(item.command);
      const failed =
        (typeof item.exit_code === 'number' && item.exit_code !== 0) ||
        item.status === 'failed' ||
        item.status === 'declined';
      return tool(
        describeCommand(command, item.parsed_cmd),
        !failed,
        str(item.aggregated_output) ?? '',
      );
    }
    case 'McpToolCall': {
      const result = asRecord(item.result);
      const failed =
        item.status === 'failed' ||
        result?.isError === true ||
        item.error != null;
      const output =
        contentToText(result?.content) ||
        str(asRecord(item.error)?.message) ||
        str(item.error) ||
        '';
      return tool(
        {
          name: 'MCP',
          title: `${str(item.server) ?? 'mcp'} › ${str(item.tool) ?? 'tool'}`,
          detail: truncate(JSON.stringify(item.arguments ?? {}), 160),
        },
        !failed,
        output,
      );
    }
    case 'FileChange': {
      const files = changedFiles(item.changes);
      return tool(
        {
          name: 'Edit',
          title:
            files.length === 1
              ? `Edit ${basename(files[0])}`
              : `Edit ${files.length} files`,
          detail: files.join('\n'),
          filePath: files.length === 1 ? files[0] : undefined,
        },
        item.status !== 'failed' && item.status !== 'declined',
        '',
      );
    }
    case 'WebSearch':
      return tool(
        {
          name: 'WebSearch',
          title: `Search the web: ${str(item.query) ?? ''}`,
        },
        true,
        '',
      );
    default:
      // AgentMessage and Reasoning duplicate response_item records.
      return [];
  }
}

/** Codex runs commands as [shell, flag, script]; show just the script. */
function shellCommand(command: unknown): string {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command)) return '';
  const parts = command.filter((p): p is string => typeof p === 'string');
  const flag = parts.findIndex((p) => /^-(Command|c|lc)$/i.test(p));
  if (flag >= 0 && flag < parts.length - 1)
    return parts.slice(flag + 1).join(' ');
  return parts.join(' ');
}

function describeCommand(command: string, parsed: unknown): ToolFields {
  const steps = Array.isArray(parsed) ? parsed.map(asRecord) : [];
  const titles: string[] = [];
  let filePath: string | undefined;
  for (const step of steps) {
    if (!step) continue;
    const name =
      str(step.name) ?? (str(step.path) ? basename(str(step.path)!) : '');
    if (step.type === 'read') {
      titles.push(`Read ${name}`.trim());
      filePath ??= str(step.path);
    } else if (step.type === 'list_files') {
      titles.push(`List files${str(step.path) ? ` in ${str(step.path)}` : ''}`);
    } else if (step.type === 'search') {
      titles.push(`Search for "${truncate(str(step.query) ?? '', 50)}"`);
    }
  }
  return {
    name: 'Shell',
    title: titles.length
      ? titles.join(' · ')
      : truncate(firstLine(command), 80),
    detail: command,
    filePath: steps.length === 1 ? filePath : undefined,
  };
}

/** CLI-format calls: shell commands, patches, plans and anything else. */
function describeCall(item: Record<string, unknown>): ToolFields {
  const name = str(item.name) ?? 'shell';
  let args: Record<string, unknown> = {};
  const rawArgs = item.arguments ?? item.action;
  if (typeof rawArgs === 'string') {
    try {
      args = asRecord(JSON.parse(rawArgs)) ?? {};
    } catch {
      args = {};
    }
  } else {
    args = asRecord(rawArgs) ?? {};
  }

  if (
    item.type === 'local_shell_call' ||
    /^(shell|shell_command|exec_command|container\.exec)$/.test(name)
  ) {
    const command = shellCommand(args.command ?? args.cmd);
    return describeCommand(command, undefined);
  }
  if (name === 'apply_patch') {
    const patch = str(item.input) ?? str(args.input) ?? '';
    const files = [
      ...patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g),
    ].map((m) => m[1].trim());
    return {
      name: 'Edit',
      title:
        files.length === 1
          ? `Edit ${basename(files[0])}`
          : `Edit ${files.length} files`,
      detail: files.join('\n'),
      filePath: files.length === 1 ? files[0] : undefined,
    };
  }
  if (name === 'update_plan') return { name, title: 'Update the plan' };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return {
    name,
    title: mcp ? `${mcp[1]} › ${mcp[2]}` : name,
    detail: truncate(
      typeof item.input === 'string' ? item.input : JSON.stringify(args),
      160,
    ),
  };
}

/** CLI outputs are plain text or JSON with metadata.exit_code. */
function readCallOutput(output: unknown): { ok: boolean; text: string } {
  const text = typeof output === 'string' ? output : contentToText(output);
  try {
    const parsed = asRecord(JSON.parse(text));
    const exit = asRecord(parsed?.metadata)?.exit_code;
    if (parsed && typeof exit === 'number')
      return { ok: exit === 0, text: str(parsed.output) ?? text };
  } catch {
    // Not JSON; fall through to the text checks.
  }
  const exit = /(?:^|\n)(?:Exit code|Process exited with code):?\s*(\d+)/i.exec(
    text,
  );
  if (exit) return { ok: exit[1] === '0', text };
  return { ok: !/^(error|failed|aborted)\b/i.test(text.trim()), text };
}

function changedFiles(changes: unknown): string[] {
  if (Array.isArray(changes))
    return changes
      .map((c) => str(asRecord(c)?.path))
      .filter((p): p is string => Boolean(p));
  const record = asRecord(changes);
  return record ? Object.keys(record) : [];
}

function readRoots(head: string): string[] {
  const line = head.split('\n', 1)[0];
  let meta: Record<string, unknown> | undefined;
  try {
    meta = asRecord(asRecord(JSON.parse(line))?.payload);
  } catch {
    // The first line was larger than the chunk; fall back to a pattern match.
    const cwd = /"cwd":("(?:[^"\\]|\\.)*")/.exec(head)?.[1];
    try {
      meta = cwd ? { cwd: JSON.parse(cwd) } : undefined;
    } catch {
      meta = undefined;
    }
  }
  if (!meta) return [];
  const roots = [
    str(meta.cwd),
    ...(Array.isArray(meta.runtime_workspace_roots)
      ? meta.runtime_workspace_roots
      : []),
  ]
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .map(normalizePath);
  return [...new Set(roots)];
}

function readFirstPrompt(head: string): string | undefined {
  for (const line of head.split('\n')) {
    if (!line.includes('UserMessage') && !line.includes('"user_message"'))
      continue;
    try {
      const payload = asRecord(asRecord(JSON.parse(line))?.payload);
      const item = asRecord(payload?.item);
      const text =
        item?.type === 'UserMessage'
          ? contentToText(item.content)
          : payload?.type === 'user_message'
            ? str(payload.message)
            : undefined;
      const clean = text
        ? stripInjected(text).replace(/\[(@[^\]]+)\]\([^)]*\)/g, '$1')
        : '';
      if (clean) return firstLine(clean);
    } catch {
      // Partial line at the end of the chunk.
    }
  }
  return undefined;
}

function listLogs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

/** Codex writes durations as `{ secs, nanos }`; milliseconds, if readable. */
function readDuration(value: unknown): number | undefined {
  const d = asRecord(value);
  if (typeof d?.secs !== 'number') return undefined;
  const nanos = typeof d.nanos === 'number' ? d.nanos : 0;
  return Math.round(d.secs * 1000 + nanos / 1e6);
}

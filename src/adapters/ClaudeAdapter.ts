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
import { normalizePath, readJson, readTail } from './files';

const RESULT_PREVIEW = 600;
const TITLE_SCAN_BYTES = 256 * 1024;

/**
 * Reads Claude Code's session logs:
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl            main conversation
 *   ~/.claude/projects/<slug>/<sessionId>/subagents/*.jsonl  subagents
 *   ~/.claude/sessions/<pid>.json                          running sessions
 *
 * The format is undocumented. Unknown record types are ignored so a format
 * change degrades the feed instead of breaking it.
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly kind = 'claude' as const;
  private readonly titles = new Map<
    string,
    { mtime: number; title?: string }
  >();

  constructor(
    private readonly home: string = path.join(os.homedir(), '.claude'),
  ) {}

  findSessions(workspacePath: string): SessionInfo[] {
    const live = this.liveSessions(workspacePath);
    const sessions: SessionInfo[] = [];
    for (const dir of this.projectDirs(workspacePath)) {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.jsonl')) continue;
        const file = path.join(dir, name);
        let mtime: number;
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          continue;
        }
        const sessionId = name.slice(0, -'.jsonl'.length);
        const status = live.get(sessionId);
        sessions.push({
          key: `claude:${sessionId}`,
          agent: 'claude',
          sessionId,
          title:
            this.cachedTitle(file, mtime) ??
            `Session ${new Date(mtime).toLocaleString()}`,
          file,
          mtime,
          live: status !== undefined,
          status,
        });
      }
    }
    return sessions.sort((a, b) => b.mtime - a.mtime);
  }

  findExtraSources(session: SessionInfo): SessionSource[] {
    const dir = path.join(
      path.dirname(session.file),
      session.sessionId,
      'subagents',
    );
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const sources: SessionSource[] = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const agentId = name.slice(0, -'.jsonl'.length);
      const file = path.join(dir, name);
      const meta = readJson(path.join(dir, `${agentId}.meta.json`));
      const parentId = str(meta?.toolUseId);
      // A log is read once, with the parent known at that moment. Its meta
      // file can be mid-write when the log appears, so wait for it a little;
      // without that the subagent's steps would show as the user's own.
      if (!parentId && isNew(file)) continue;
      sources.push({ file, parentId, idPrefix: `${agentId}:` });
    }
    return sources;
  }

  parse(raw: unknown, ctx: ParseContext): FeedEvent[] {
    const record = asRecord(raw);
    if (!record) return [];
    const base = {
      agent: 'claude' as const,
      timestamp: str(record.timestamp) ?? '',
      parentId: ctx.parentId,
    };
    const uuid = str(record.uuid) ?? '';
    const id = (suffix: string) => `${ctx.idPrefix}${uuid}${suffix}`;

    switch (record.type) {
      case 'assistant':
        return this.parseAssistant(record, base, id);
      case 'user':
        return this.parseUser(record, base, id, ctx);
      case 'system': {
        // The model declined, so the turn ends with no answer: say why.
        if (record.subtype === 'model_refusal_no_fallback') {
          const why = str(record.apiRefusalExplanation);
          const text = why
            ? `Response blocked: ${why}`
            : 'Response blocked by the model';
          return [{ ...base, kind: 'error', id: id(''), text }];
        }
        // e.g. "…'s safeguards stopped the response above · continuing once".
        if (record.subtype === 'informational') {
          const text = str(record.content)?.trim();
          return text ? [{ ...base, kind: 'interrupt', id: id(''), text }] : [];
        }
        if (record.subtype !== 'api_error') return [];
        const error = asRecord(record.error);
        const message =
          str(error?.formatted) ?? str(error?.message) ?? 'API error';
        const attempt = record.retryAttempt;
        const max = record.maxRetries;
        const retry =
          typeof attempt === 'number' && typeof max === 'number'
            ? ` (retry ${attempt}/${max})`
            : '';
        return [{ ...base, kind: 'error', id: id(''), text: message + retry }];
      }
      default:
        return [];
    }
  }

  private parseAssistant(
    record: Record<string, unknown>,
    base: Pick<FeedEvent, 'agent' | 'timestamp' | 'parentId'>,
    id: (suffix: string) => string,
  ): FeedEvent[] {
    const message = asRecord(record.message);
    const content = message?.content;
    if (!Array.isArray(content)) return [];
    const events: FeedEvent[] = [];
    content.forEach((rawBlock, i) => {
      const block = asRecord(rawBlock);
      if (!block) return;
      if (block.type === 'text') {
        const text = (str(block.text) ?? '').trim();
        if (text && text !== '(no content)')
          events.push({ ...base, kind: 'narration', id: id(`:${i}`), text });
      } else if (block.type === 'thinking') {
        const text = (str(block.thinking) ?? '').trim();
        if (text) {
          const durationMs = record.thinkingDurationMs;
          events.push({
            ...base,
            kind: 'thinking',
            id: id(`:${i}`),
            text,
            durationMs: typeof durationMs === 'number' ? durationMs : undefined,
          });
        }
      } else if (block.type === 'tool_use') {
        const callId = str(block.id) ?? id(`:${i}`);
        events.push({
          ...base,
          id: id(`:${i}`),
          ...describeTool(
            str(block.name) ?? 'tool',
            asRecord(block.input) ?? {},
          ),
          kind: 'tool',
          callId,
        });
      }
    });
    return events;
  }

  private parseUser(
    record: Record<string, unknown>,
    base: Pick<FeedEvent, 'agent' | 'timestamp' | 'parentId'>,
    id: (suffix: string) => string,
    ctx: ParseContext,
  ): FeedEvent[] {
    const message = asRecord(record.message);
    const content = message?.content;

    if (Array.isArray(content)) {
      const results: FeedEvent[] = [];
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (block?.type !== 'tool_result') continue;
        results.push({
          ...base,
          kind: 'toolResult',
          id: id(`:r:${str(block.tool_use_id)}`),
          callId: str(block.tool_use_id) ?? '',
          ok: block.is_error !== true,
          // Not stripped: tags in a result could hide planted instructions.
          preview: preview(contentToText(block.content).trim(), RESULT_PREVIEW),
        });
      }
      if (results.length) return results;
    }

    if (record.isMeta === true) return [];
    const text = stripInjected(
      typeof content === 'string' ? content : contentToText(content),
    );
    if (!text) return [];
    if (text.startsWith('[Request interrupted'))
      return [{ ...base, kind: 'interrupt', id: id(''), text }];

    // A subagent's first record is the prompt its parent gave it; the parent's
    // Agent row already shows that, so skip it.
    if (ctx.parentId && record.parentUuid == null) return [];

    const origin = asRecord(record.origin);
    const human = origin
      ? origin.kind === 'human'
      : !text.startsWith('<') && !ctx.parentId;
    if (!human) return [];
    return [{ ...base, kind: 'prompt', id: id(''), text }];
  }

  private cachedTitle(file: string, mtime: number): string | undefined {
    const hit = this.titles.get(file);
    if (hit && hit.mtime === mtime) return hit.title;
    const title = readTitle(file);
    this.titles.set(file, { mtime, title });
    return title;
  }

  /** Session ids of running Claude Code processes in this workspace. */
  private liveSessions(workspacePath: string): Map<string, 'busy' | 'idle'> {
    const live = new Map<string, 'busy' | 'idle'>();
    const dir = path.join(this.home, 'sessions');
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return live;
    }
    const wanted = normalizePath(workspacePath);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const info = readJson(path.join(dir, name));
      const sessionId = str(info?.sessionId);
      const cwd = str(info?.cwd);
      if (!sessionId || !cwd || normalizePath(cwd) !== wanted) continue;
      if (typeof info?.pid === 'number' && !processAlive(info.pid)) continue;
      live.set(sessionId, info?.status === 'busy' ? 'busy' : 'idle');
    }
    return live;
  }

  /**
   * Claude names a project folder after its path with every non-alphanumeric
   * character replaced by '-'. Drive-letter case varies between launches, so
   * both spellings can exist side by side.
   */
  private projectDirs(workspacePath: string): string[] {
    const slug = projectSlug(workspacePath).toLowerCase();
    const root = path.join(this.home, 'projects');
    try {
      return fs
        .readdirSync(root)
        .filter((name) => name.toLowerCase() === slug)
        .map((name) => path.join(root, name));
    } catch {
      return [];
    }
  }
}

export function projectSlug(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** Turns a tool call into a readable title, detail line and optional file. */
export function describeTool(
  name: string,
  input: Record<string, unknown>,
): Pick<ToolEvent, 'name' | 'title' | 'detail' | 'filePath' | 'spawnsAgent'> {
  const filePath = str(input.file_path) ?? str(input.notebook_path);
  switch (name) {
    case 'Bash':
    case 'PowerShell': {
      const command = str(input.command) ?? '';
      return {
        name,
        title: str(input.description) ?? truncate(firstLine(command), 80),
        detail: command,
      };
    }
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return {
        name,
        title:
          `${name === 'MultiEdit' ? 'Edit' : name} ${filePath ? basename(filePath) : ''}`.trim(),
        detail: filePath,
        filePath,
      };
    case 'Grep':
      return {
        name,
        title: `Search for "${truncate(str(input.pattern) ?? '', 60)}"`,
        detail: str(input.path) ?? str(input.glob),
      };
    case 'Glob':
      return {
        name,
        title: `Find files ${str(input.pattern) ?? ''}`.trim(),
        detail: str(input.path),
      };
    case 'Agent':
    case 'Task':
      return {
        name,
        title: str(input.description) ?? 'Subagent',
        detail: str(input.subagent_type),
        spawnsAgent: true,
      };
    case 'WebSearch':
      return { name, title: `Search the web: ${str(input.query) ?? ''}` };
    case 'WebFetch':
      return { name, title: 'Fetch page', detail: str(input.url) };
    case 'TodoWrite':
      return { name, title: 'Update the to-do list' };
    case 'Skill':
      return { name, title: `Use skill ${str(input.skill) ?? ''}`.trim() };
    case 'ToolSearch':
      return { name, title: 'Load tools', detail: str(input.query) };
    case 'EnterPlanMode':
      return { name, title: 'Enter plan mode' };
    case 'ExitPlanMode':
      return { name, title: 'Present plan for approval' };
    case 'AskUserQuestion':
      return { name, title: 'Ask you a question' };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      return {
        name,
        title: mcp ? `${mcp[1]} › ${mcp[2]}` : name,
        detail: truncate(JSON.stringify(input), 160),
        filePath,
      };
    }
  }
}

/** The session's title, from the end of its log: it is re-recorded as it evolves. */
function readTitle(file: string): string | undefined {
  const pattern = /"type":"ai-title","aiTitle":("(?:[^"\\]|\\.)*")/g;
  let last: string | undefined;
  for (const match of readTail(file, TITLE_SCAN_BYTES).matchAll(pattern))
    last = match[1];
  try {
    return last ? (JSON.parse(last) as string) : undefined;
  } catch {
    return undefined;
  }
}

/** How long a new subagent log waits for its meta file. */
const META_WAIT_MS = 10_000;

function isNew(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return Date.now() - (stat.birthtimeMs || stat.mtimeMs) < META_WAIT_MS;
  } catch {
    return false;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// The common event model. Every agent adapter translates its own log format
// into these events, so the store, the UI and the exporters never need to know
// which agent produced them.

export type AgentKind = 'claude' | 'codex';

/** Each agent's name, for the export and the session picker's tooltips. */
export const AGENT_NAME: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/** Short names, where space is tight ("Claude is working"). */
export const AGENT_SHORT_NAME: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
};

interface BaseEvent {
  /** Unique within a session (adapters prefix ids from subagent logs). */
  id: string;
  agent: AgentKind;
  /** ISO timestamp from the log, or '' when the record had none. */
  timestamp: string;
  /** Tool call id of the subagent launch this event belongs to, if any. */
  parentId?: string;
}

export interface PromptEvent extends BaseEvent {
  kind: 'prompt';
  text: string;
}

export interface NarrationEvent extends BaseEvent {
  kind: 'narration';
  text: string;
  /** True when the agent marked this as its final answer for the turn. */
  final?: boolean;
}

export interface ThinkingEvent extends BaseEvent {
  kind: 'thinking';
  text: string;
  durationMs?: number;
}

export interface ToolEvent extends BaseEvent {
  kind: 'tool';
  callId: string;
  name: string;
  /** Human-readable one-liner, e.g. the Bash description or "Edit App.tsx". */
  title: string;
  /** Secondary line, e.g. the command or a path. */
  detail?: string;
  /** Absolute path the tool touched, when there is one to open. */
  filePath?: string;
  /** True for tools that launch a subagent whose events nest under this one. */
  spawnsAgent?: boolean;
}

export interface ToolResultEvent extends BaseEvent {
  kind: 'toolResult';
  callId: string;
  ok: boolean;
  preview: string;
  /** How long the step ran, when the log records it (Codex's desktop app). */
  durationMs?: number;
}

export interface ErrorEvent extends BaseEvent {
  kind: 'error';
  text: string;
}

export interface InterruptEvent extends BaseEvent {
  kind: 'interrupt';
  text: string;
}

export type FeedEvent =
  | PromptEvent
  | NarrationEvent
  | ThinkingEvent
  | ToolEvent
  | ToolResultEvent
  | ErrorEvent
  | InterruptEvent;

/** What the UI renders. Tool results are folded into their tool item. */
export type FeedItem =
  | Exclude<FeedEvent, ToolEvent | ToolResultEvent>
  | (ToolEvent & {
      status: 'running' | 'ok' | 'error';
      result?: string;
      /** How long the step ran, once it has finished. */
      durationMs?: number;
    });

export interface SessionInfo {
  /** Stable key: `${agent}:${sessionId}`. */
  key: string;
  agent: AgentKind;
  sessionId: string;
  title: string;
  file: string;
  /** Last modified, epoch ms. */
  mtime: number;
  live: boolean;
  status?: 'busy' | 'idle';
}

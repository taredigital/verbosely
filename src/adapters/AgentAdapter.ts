import type { AgentKind, FeedEvent, SessionInfo } from '../core/events';

/** A log file that belongs to a session, e.g. the main log or a subagent's. */
export interface SessionSource {
  file: string;
  /** Tool call id the source's events nest under (subagents only). */
  parentId?: string;
  /** Prefix that keeps ids unique across sources. */
  idPrefix: string;
}

export interface ParseContext {
  parentId?: string;
  idPrefix: string;
}

/**
 * Everything specific to one agent's on-disk logs. The rest of the extension
 * only sees SessionInfo and FeedEvent.
 */
export interface AgentAdapter {
  readonly kind: AgentKind;
  /** Sessions recorded for this workspace folder, newest first. */
  findSessions(workspacePath: string): SessionInfo[];
  /** Extra log files that belong to the session (e.g. subagents). */
  findExtraSources(session: SessionInfo): SessionSource[];
  /** Translates one raw log record. Unknown records return []. */
  parse(record: unknown, ctx: ParseContext): FeedEvent[];
}

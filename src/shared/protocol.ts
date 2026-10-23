// Messages between the extension host and the feed UI. The same UI runs in
// the side bar, the pop-out panel and the browser page, so this is the one
// contract all of them share.

import { MAX_NOTE_LENGTH, type Annotations } from '../core/annotations';
import type { FeedItem, SessionInfo } from '../core/events';

export type HostMessage =
  | {
      type: 'sessions';
      sessions: SessionInfo[];
      currentKey?: string;
      following: boolean;
    }
  | {
      type: 'reset';
      session?: SessionInfo;
      items: FeedItem[];
      trimmed?: boolean;
    }
  | { type: 'upsert'; items: FeedItem[] }
  | { type: 'noWorkspace' }
  /** The folder whose sessions are shown, so an empty feed can say where it looked. */
  | { type: 'workspace'; path: string }
  /** Scroll to an item's row and highlight it (the status bar's failures). */
  | { type: 'reveal'; id: string }
  /** The reader's bookmarks and notes for the session shown. */
  | { type: 'annotations'; sessionKey: string; annotations: Annotations }
  /** Display options from the settings. */
  | { type: 'options'; showTimes: boolean; maxItems?: number }
  /** Browser page only: whether the live stream to VS Code is connected. */
  | { type: 'connection'; connected: boolean };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'selectSession'; key: string }
  | { type: 'follow' }
  | { type: 'openFile'; path: string }
  | { type: 'export' }
  | { type: 'bookmark'; sessionKey: string; id: string; on: boolean }
  /** An empty text deletes the note. */
  | { type: 'note'; sessionKey: string; id: string; text: string };

/** Longest id, session key or path the host accepts from a view. */
const MAX_FIELD = 4096;

/**
 * Checks a message from a view before the host acts on it. Webviews post
 * plain data, and the feed shows text from agents' logs, so the host treats
 * every message as untrusted: anything malformed is dropped.
 */
export function parseWebviewMessage(raw: unknown): WebviewMessage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const field = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD;
  switch (m.type) {
    case 'ready':
    case 'follow':
    case 'export':
      return { type: m.type };
    case 'selectSession':
      return field(m.key) ? { type: m.type, key: m.key } : undefined;
    case 'openFile':
      return field(m.path) ? { type: m.type, path: m.path } : undefined;
    case 'bookmark':
      return field(m.sessionKey) && field(m.id) && typeof m.on === 'boolean'
        ? { type: m.type, sessionKey: m.sessionKey, id: m.id, on: m.on }
        : undefined;
    case 'note':
      return field(m.sessionKey) &&
        field(m.id) &&
        typeof m.text === 'string' &&
        m.text.length <= MAX_NOTE_LENGTH
        ? { type: m.type, sessionKey: m.sessionKey, id: m.id, text: m.text }
        : undefined;
    default:
      return undefined;
  }
}

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Annotations } from '../core/annotations';
import type { FeedItem, SessionInfo } from '../core/events';
import type { HostMessage } from '../shared/protocol';
import type { Transport } from './transport';

/** Everything the host has told the feed so far. */
export interface FeedState {
  sessions: SessionInfo[];
  currentKey?: string;
  following: boolean;
  /** The session the items belong to. */
  session?: SessionInfo;
  items: FeedItem[];
  trimmed: boolean;
  noWorkspace: boolean;
  workspace: string;
  connected: boolean;
  showTimes: boolean;
  /** Most items to keep, like the host's store; no cap when not sent. */
  maxItems?: number;
  /** The reader's bookmarks and notes, for the session they were sent for. */
  annotations?: { sessionKey: string; annotations: Annotations };
}

const INITIAL: FeedState = {
  sessions: [],
  following: true,
  items: [],
  trimmed: false,
  noWorkspace: false,
  workspace: '',
  connected: true,
  showTimes: true,
};

/**
 * Listens to the host and keeps the feed's state. `fresh` holds the ids that
 * arrived live (not in the initial load), the only rows that animate in.
 * `onReset` runs when a session is (re)loaded; `beforeUpsert` when live
 * items arrive, before they render; `onReveal` when the host asks for a row
 * to be shown (the status bar's failures).
 */
export function useFeed(
  transport: Transport,
  handlers: {
    onReset(): void;
    beforeUpsert(): void;
    onReveal(id: string): void;
  },
) {
  const [state, setState] = useState<FeedState>(INITIAL);
  const fresh = useRef(new Set<string>());
  // The handlers may change between renders; the listener is set up once.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    const update = (patch: Partial<FeedState>) =>
      setState((prev) => ({ ...prev, ...patch }));
    transport.onMessage((message: HostMessage) => {
      switch (message.type) {
        case 'sessions':
          update({
            sessions: message.sessions,
            currentKey: message.currentKey,
            following: message.following,
          });
          break;
        case 'reset':
          fresh.current = new Set();
          latest.current.onReset();
          update({
            session: message.session,
            items: message.items,
            trimmed: message.trimmed ?? false,
          });
          break;
        case 'upsert':
          latest.current.beforeUpsert();
          setState((prev) => {
            const known = new Set(prev.items.map((item) => item.id));
            for (const item of message.items)
              if (!known.has(item.id)) fresh.current.add(item.id);
            return {
              ...prev,
              items: upsert(prev.items, message.items, prev.maxItems),
            };
          });
          break;
        case 'noWorkspace':
          update({ noWorkspace: true });
          break;
        case 'workspace':
          update({ workspace: message.path });
          break;
        case 'reveal':
          latest.current.onReveal(message.id);
          break;
        case 'annotations':
          update({ annotations: message });
          break;
        case 'options':
          update({
            showTimes: message.showTimes,
            maxItems: message.maxItems,
          });
          break;
        case 'connection':
          update({ connected: message.connected });
          break;
      }
    });
    transport.send({ type: 'ready' });
  }, [transport]);

  return { state, fresh: fresh.current };
}

/**
 * Replaces items by id, keeping their place, and appends new ones. Past
 * `maxItems` the oldest are dropped, as the host's store does.
 */
export function upsert(
  prev: FeedItem[],
  changed: FeedItem[],
  maxItems?: number,
): FeedItem[] {
  const index = new Map(prev.map((item, i) => [item.id, i]));
  const next = prev.slice();
  for (const item of changed) {
    const i = index.get(item.id);
    if (i === undefined) {
      index.set(item.id, next.length);
      next.push(item);
    } else {
      next[i] = item;
    }
  }
  return maxItems !== undefined && next.length > maxItems
    ? next.slice(next.length - maxItems)
    : next;
}

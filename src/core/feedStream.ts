import type { HostMessage } from '../shared/protocol';
import type { AnnotationStore } from './annotations';
import type { FeedController } from './FeedController';

/** Display options the host sets (from VS Code's settings). */
export interface FeedOptions {
  showTimes: boolean;
  /** Most items a view keeps, like the host's store. */
  maxItems?: number;
}

/** A value that tells its listeners when it changes. */
export class LiveValue<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private current: T) {}

  get value(): T {
    return this.current;
  }

  set(value: T): void {
    this.current = value;
    for (const listener of this.listeners) listener(value);
  }

  onChange(listener: (value: T) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
}

/** What a feed view shows besides the feed itself. */
export interface FeedExtras {
  annotations?: AnnotationStore;
  options?: LiveValue<FeedOptions>;
}

/**
 * Sends a view everything it shows, as it changes: sessions, the feed, the
 * shown session's bookmarks and notes, and the display options. Shared by
 * the VS Code webviews and the browser page.
 */
export function streamFeed(
  controller: FeedController,
  extras: FeedExtras,
  post: (message: HostMessage) => void,
): { dispose(): void } {
  const { annotations, options } = extras;
  let sessionKey: string | undefined;
  const postAnnotations = () => {
    if (sessionKey && annotations)
      post({
        type: 'annotations',
        sessionKey,
        annotations: annotations.get(sessionKey),
      });
  };

  if (options) post({ type: 'options', ...options.value });
  const disposables = [
    controller.subscribe({
      onReset: (session, items, trimmed) => {
        sessionKey = session?.key;
        postAnnotations();
        post({ type: 'reset', session, items, trimmed });
      },
      onUpsert: (items) => post({ type: 'upsert', items }),
      onSessions: (sessions, currentKey, following) =>
        post({ type: 'sessions', sessions, currentKey, following }),
    }),
    annotations?.onChange((key) => {
      if (key === sessionKey) postAnnotations();
    }),
    options?.onChange((value) => post({ type: 'options', ...value })),
  ];
  return {
    dispose: () => disposables.forEach((d) => d?.dispose()),
  };
}

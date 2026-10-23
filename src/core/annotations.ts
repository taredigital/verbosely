// Bookmarks and notes the reader adds to feed rows. They are stored on this
// computer, per workspace (VS Code's workspaceState), keyed by session and
// item id. Never written into the agents' logs.

export interface Annotation {
  bookmark?: boolean;
  note?: string;
}

/** One session's annotations, by feed item id. */
export type Annotations = Record<string, Annotation>;

/** The part of VS Code's Memento this needs; a Map-backed one in tests. */
export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export const MAX_NOTE_LENGTH = 4000;
const PREFIX = 'verbosely.annotations/';

export class AnnotationStore {
  private readonly listeners = new Set<(sessionKey: string) => void>();

  constructor(private readonly storage: KeyValueStore) {}

  get(sessionKey: string): Annotations {
    return this.storage.get<Annotations>(PREFIX + sessionKey) ?? {};
  }

  setBookmark(sessionKey: string, id: string, on: boolean): void {
    this.change(sessionKey, id, (a) => ({ ...a, bookmark: on || undefined }));
  }

  /** An empty note deletes the note. */
  setNote(sessionKey: string, id: string, text: string): void {
    const note = text.trim().slice(0, MAX_NOTE_LENGTH);
    this.change(sessionKey, id, (a) => ({ ...a, note: note || undefined }));
  }

  /** Called with the session key whenever that session's annotations change. */
  onChange(listener: (sessionKey: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private change(
    sessionKey: string,
    id: string,
    edit: (annotation: Annotation) => Annotation,
  ): void {
    const all = { ...this.get(sessionKey) };
    const next = edit(all[id] ?? {});
    if (next.bookmark || next.note) all[id] = clean(next);
    else delete all[id];
    // The value is cached in memory straight away; the write to disk follows.
    void this.storage.update(
      PREFIX + sessionKey,
      Object.keys(all).length ? all : undefined,
    );
    for (const listener of this.listeners) listener(sessionKey);
  }
}

/** Drops unset fields so stored entries stay small. */
function clean(annotation: Annotation): Annotation {
  const out: Annotation = {};
  if (annotation.bookmark) out.bookmark = true;
  if (annotation.note) out.note = annotation.note;
  return out;
}

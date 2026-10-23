import type { AgentAdapter, SessionSource } from '../adapters/AgentAdapter';
import type { FeedEvent, FeedItem, SessionInfo } from './events';
import { FeedStore } from './FeedStore';
import { JsonlTailer, parseLines } from './JsonlTailer';

export interface FeedListener {
  /** `trimmed`: older activity was skipped because the log is large. */
  onReset(
    session: SessionInfo | undefined,
    items: FeedItem[],
    trimmed: boolean,
  ): void;
  onUpsert(items: FeedItem[]): void;
  onSessions(
    sessions: SessionInfo[],
    currentKey: string | undefined,
    following: boolean,
  ): void;
}

export interface FeedSettings {
  initialBytes: number;
  maxItems: number;
  refreshMs?: number;
}

/**
 * Owns the session being shown: which one it is, the tailers reading its
 * log files, and the store they fill. Any number of views can listen.
 *
 * In "follow" mode it switches to whichever session is live, preferring one
 * that is busy right now, so the feed tracks the agent you are watching.
 */
export class FeedController {
  private readonly listeners = new Set<FeedListener>();
  private sessions: SessionInfo[] = [];
  private current?: SessionInfo;
  private adapter?: AgentAdapter;
  private following = true;
  private store: FeedStore;
  private tailers = new Map<string, JsonlTailer>();
  private pending = new Map<string, FeedItem>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  /** Subagent logs launched before the loaded part of the session. */
  private readonly unreachable = new Set<string>();
  /** While a session opens: each source's events, merged by time after. */
  private loaded?: FeedEvent[][];
  private trimmed = false;
  private readonly refreshTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly adapters: AgentAdapter[],
    private readonly workspacePath: string | undefined,
    private settings: FeedSettings,
  ) {
    this.store = new FeedStore(settings.maxItems);
    this.refresh();
    this.refreshTimer = setInterval(
      () => this.refresh(),
      settings.refreshMs ?? 3000,
    );
  }

  subscribe(listener: FeedListener): { dispose(): void } {
    this.listeners.add(listener);
    listener.onSessions(this.sessions, this.current?.key, this.following);
    listener.onReset(this.current, this.store.all(), this.trimmed);
    return { dispose: () => this.listeners.delete(listener) };
  }

  get workspace(): string | undefined {
    return this.workspacePath;
  }

  get session(): SessionInfo | undefined {
    return this.current;
  }

  items(): FeedItem[] {
    return this.store.all();
  }

  /** Whether a step in the shown session touched this file (what may be opened). */
  hasFile(filePath: string): boolean {
    return this.store
      .all()
      .some((item) => item.kind === 'tool' && item.filePath === filePath);
  }

  select(key: string): void {
    const session = this.sessions.find((s) => s.key === key);
    if (!session) return;
    this.following = false;
    if (session.key !== this.current?.key) this.open(session);
    this.emitSessions();
  }

  follow(): void {
    this.following = true;
    this.refresh();
    this.emitSessions();
  }

  /** Applies changed settings, reopening the session shown to use them. */
  updateSettings(settings: FeedSettings): void {
    const reopen =
      settings.initialBytes !== this.settings.initialBytes ||
      settings.maxItems !== this.settings.maxItems;
    this.settings = { ...settings, refreshMs: this.settings.refreshMs };
    if (reopen && this.current) this.open(this.current);
  }

  /** Re-scans sessions, follows the live one, and picks up new subagents. */
  refresh(): void {
    if (!this.workspacePath) return;
    const workspacePath = this.workspacePath;
    const sessions = this.adapters
      .flatMap((adapter) => {
        try {
          return adapter.findSessions(workspacePath);
        } catch (err) {
          console.error(`Verbosely: ${adapter.kind} scan failed`, err);
          return [];
        }
      })
      .sort((a, b) => b.mtime - a.mtime);

    const changed =
      sessions.length !== this.sessions.length ||
      sessions.some((s, i) => {
        const old = this.sessions[i];
        return (
          old?.key !== s.key ||
          old.title !== s.title ||
          old.live !== s.live ||
          old.status !== s.status ||
          // The picker shows when each session last changed, to the minute.
          Math.floor(old.mtime / 60_000) !== Math.floor(s.mtime / 60_000)
        );
      });
    this.sessions = sessions;
    // Keep the shown session's details (title, status) current.
    if (this.current)
      this.current =
        sessions.find((s) => s.key === this.current?.key) ?? this.current;

    if (this.following) {
      const target = pickFollowTarget(sessions, this.current?.key);
      if (target && target.key !== this.current?.key) this.open(target);
    }
    if (this.current && this.adapter) {
      for (const source of this.adapter.findExtraSources(this.current))
        if (!this.unreachable.has(source.file)) this.addSource(source);
    }
    if (changed) this.emitSessions();
  }

  private open(session: SessionInfo): void {
    this.closeTailers();
    this.current = session;
    this.adapter = this.adapters.find((a) => a.kind === session.agent);
    this.store = new FeedStore(this.settings.maxItems);
    this.pending.clear();
    // Read every source first, then apply their events in time order. Applied
    // source by source, subagent history would land after the newest main
    // log entry, and trimming to maxItems would drop the conversation itself.
    this.loaded = [];
    this.unreachable.clear();
    this.addSource({ file: session.file, idPrefix: '' });
    this.trimmed = this.tailers.get(session.file)?.trimmed ?? false;
    this.addSubagentSources(this.adapter?.findExtraSources(session) ?? []);
    const loaded = this.loaded;
    this.loaded = undefined;
    this.store.apply(mergeByTime(loaded));
    for (const l of this.listeners)
      l.onReset(session, this.store.all(), this.trimmed);
  }

  /**
   * Reads the subagent logs whose launch is in the loaded part of the session
   * (and theirs in turn). The others can never be shown, because the step
   * that launched them is older than what was loaded, and a session can have
   * a hundred of them: reading them all could hold gigabytes.
   */
  private addSubagentSources(sources: SessionSource[]): void {
    const launches = new Set<string>();
    const collect = (events: FeedEvent[]) => {
      for (const e of events)
        if (e.kind === 'tool' && e.spawnsAgent) launches.add(e.callId);
    };
    this.loaded?.forEach(collect);
    let pending = sources;
    for (;;) {
      // A log without a known parent (no meta file) is read as before.
      const ready = pending.filter(
        (s) => !s.parentId || launches.has(s.parentId),
      );
      if (!ready.length) break;
      for (const source of ready) {
        const before = this.loaded?.length ?? 0;
        this.addSource(source);
        this.loaded?.slice(before).forEach(collect);
      }
      pending = pending.filter((s) => !ready.includes(s));
    }
    for (const source of pending) this.unreachable.add(source.file);
  }

  private addSource(source: SessionSource): void {
    if (this.tailers.has(source.file) || !this.adapter) return;
    const adapter = this.adapter;
    const store = this.store;
    const ctx = { parentId: source.parentId, idPrefix: source.idPrefix };
    const tailer = new JsonlTailer(
      source.file,
      (lines) => {
        if (store !== this.store) return;
        const events = parseLines(lines).flatMap((record) => {
          try {
            return adapter.parse(record, ctx);
          } catch {
            return [];
          }
        });
        if (this.loaded) {
          this.loaded.push(events);
          return;
        }
        const changed = store.apply(events);
        if (!changed.length) return;
        for (const item of changed) this.pending.set(item.id, item);
        this.scheduleFlush();
      },
      { initialBytes: this.settings.initialBytes },
    );
    this.tailers.set(source.file, tailer);
    tailer.start();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const items = [...this.pending.values()];
      this.pending.clear();
      if (items.length) for (const l of this.listeners) l.onUpsert(items);
    }, 80);
  }

  private emitSessions(): void {
    for (const l of this.listeners)
      l.onSessions(this.sessions, this.current?.key, this.following);
  }

  private closeTailers(): void {
    for (const tailer of this.tailers.values()) tailer.dispose();
    this.tailers.clear();
  }

  dispose(): void {
    clearInterval(this.refreshTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.closeTailers();
    this.listeners.clear();
  }
}

/**
 * Merges each source's events into one list by timestamp. Within a source the
 * log's order is kept, and an event without a timestamp stays with the one
 * before it.
 */
export function mergeByTime(sources: FeedEvent[][]): FeedEvent[] {
  const keyed: { event: FeedEvent; time: number }[] = [];
  for (const events of sources) {
    let time = -Infinity;
    for (const event of events) {
      const parsed = Date.parse(event.timestamp);
      if (Number.isFinite(parsed) && parsed > time) time = parsed;
      keyed.push({ event, time });
    }
  }
  // Array sort is stable, so equal times keep their read order.
  return keyed.sort((a, b) => a.time - b.time).map((k) => k.event);
}

/**
 * Busy live session first, then any live one, then the most recent. Stays on
 * the current session while it is still busy, so two agents working at once
 * don't make the feed flip back and forth.
 */
export function pickFollowTarget(
  sessions: SessionInfo[],
  currentKey?: string,
): SessionInfo | undefined {
  const current = sessions.find((s) => s.key === currentKey);
  if (current?.live && current.status === 'busy') return current;
  return (
    sessions.find((s) => s.live && s.status === 'busy') ??
    sessions.find((s) => s.live) ??
    sessions[0]
  );
}

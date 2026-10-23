import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { AGENT_SHORT_NAME } from '../core/events';
import { atEnd, keepFollowing, writingIn } from './follow';
import { Header } from './Header';
import {
  buildRows,
  currentTurn,
  isMarked,
  revealChain,
  shownIds,
  splitTopLevel,
  type Filter,
} from './rows';
import { Timeline } from './Timeline';
import type { Transport } from './transport';
import { useFeed } from './useFeed';
import { ViewContext, type ViewState } from './ViewContext';

interface SavedState {
  filter: Filter;
}

/** The feed: header, timeline and the jump-to-latest button. */
export function App({ transport }: { transport: Transport }) {
  const [filter, setFilter] = useState<Filter>(
    () => transport.getState<SavedState>()?.filter ?? 'narration',
  );
  const [now, setNow] = useState(Date.now());
  const [atBottom, setAtBottom] = useState(true);
  /**
   * An item to scroll to (from the status bar or the bookmarks list), until
   * it has been: its row, or the nearest subagent box around it on screen.
   */
  const [reveal, setReveal] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  /** Keep the newest entry in view, until the reader scrolls up. */
  const stick = useRef(true);
  /** The content's height when the feed last scrolled to the end. */
  const pinnedHeight = useRef(0);
  /** Unsaved notes, by session and item, so a session switch keeps them. */
  const drafts = useRef(new Map<string, string>());

  const { state, fresh } = useFeed(transport, {
    onReset: () => {
      stick.current = true;
      setReveal(undefined);
    },
    // Measured before the update renders: opening a step's output or a note
    // box near the end grows the feed without a scroll event.
    beforeUpsert: () => {
      const el = scroller.current;
      if (!el || !stick.current || keepFollowing(el, pinnedHeight.current))
        return;
      stick.current = false;
      setAtBottom(false);
    },
    onReveal: setReveal,
  });
  const { sessions, session, items } = state;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);
  useEffect(
    () => transport.setState<SavedState>({ filter }),
    [filter, transport],
  );

  const { top, childrenOf } = useMemo(() => splitTopLevel(items), [items]);
  const rows = useMemo(
    () => buildRows(top, filter, childrenOf),
    [top, filter, childrenOf],
  );

  const shown = useMemo(() => shownIds(top, childrenOf), [top, childrenOf]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current || writingIn(el)) return;
    el.scrollTop = el.scrollHeight;
    pinnedHeight.current = el.scrollHeight;
  }, [rows]);

  // Scroll to the requested row and outline it. Runs after the rows render,
  // so a feed that is still loading picks the request up once the row exists;
  // an item the feed doesn't show drops the request.
  useLayoutEffect(() => {
    if (!reveal) return;
    const el = scroller.current;
    const chain = revealChain(reveal, items);
    const row = chain
      .map((id) =>
        el?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`),
      )
      .find(Boolean);
    if (!row) {
      if (!chain.some((id) => shown.has(id))) setReveal(undefined);
      return;
    }
    setReveal(undefined);
    stick.current = false;
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth; // restart the outline if it is still showing
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 2500);
  }, [rows, reveal, items, shown]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = atEnd(el);
    stick.current = bottom;
    pinnedHeight.current = el.scrollHeight;
    setAtBottom(bottom);
  };

  const current = sessions.find((s) => s.key === state.currentKey) ?? session;
  const sessionKey = session?.key;
  const notes = useMemo(
    () =>
      state.annotations && state.annotations.sessionKey === sessionKey
        ? state.annotations.annotations
        : {},
    [state.annotations, sessionKey],
  );
  const live = current?.live === true;
  const turn = useMemo(() => currentTurn(top), [top]);
  const turnStart = turn[0]?.kind === 'prompt' ? turn[0].timestamp : undefined;
  const view = useMemo<ViewState>(() => {
    const draftKey = (id: string) => JSON.stringify([sessionKey, id]);
    return {
      annotations: notes,
      showTimes: state.showTimes,
      live,
      turnStart,
      workspace: state.workspace || undefined,
      edit:
        transport.readOnly || !sessionKey
          ? undefined
          : {
              bookmark: (id, on) =>
                transport.send({ type: 'bookmark', sessionKey, id, on }),
              note: (id, text) =>
                transport.send({ type: 'note', sessionKey, id, text }),
              draft: (id) => drafts.current.get(draftKey(id)),
              setDraft: (id, text) => {
                if (text === undefined) drafts.current.delete(draftKey(id));
                else drafts.current.set(draftKey(id), text);
              },
            },
    };
  }, [
    notes,
    state.showTimes,
    live,
    turnStart,
    state.workspace,
    transport,
    sessionKey,
  ]);
  // Only rows the feed shows: subagent work whose launch was trimmed has none.
  const marks = useMemo(
    () =>
      items.flatMap((item) =>
        shown.has(item.id) && isMarked(notes[item.id])
          ? [{ item, annotation: notes[item.id] }]
          : [],
      ),
    [items, notes, shown],
  );
  // Working, but no step of this turn is running: the agent is between
  // steps, thinking. Shown so a long think doesn't look like a frozen feed.
  const thinking =
    live &&
    current?.status === 'busy' &&
    !turn.some(
      (item) =>
        item.kind === 'tool' && item.status === 'running' && !item.spawnsAgent,
    );

  if (state.noWorkspace)
    return (
      <div class="empty">
        Open a folder to see the Claude Code and Codex sessions that ran in it.
      </div>
    );

  return (
    <ViewContext.Provider value={view}>
      <div class="app">
        <Header
          transport={transport}
          sessions={sessions}
          current={current}
          currentKey={state.currentKey}
          following={state.following}
          connected={state.connected}
          filter={filter}
          onFilter={setFilter}
          marks={marks}
          onPickMark={(item) => setReveal(item.id)}
          turnStart={state.showTimes ? turnStart : undefined}
        />

        <div class="scroller" ref={scroller} onScroll={onScroll}>
          {state.trimmed && rows.length > 0 && (
            <div class="trimmed-note">
              This session is long, so only its most recent part is shown. To
              load more, raise the “Verbosely: Initial History MB” setting.
            </div>
          )}
          {rows.length ? (
            <Timeline
              rows={rows}
              childrenOf={childrenOf}
              filter={filter}
              now={now}
              fresh={fresh}
              onOpenFile={
                transport.readOnly
                  ? undefined
                  : (path) => transport.send({ type: 'openFile', path })
              }
            />
          ) : (
            <div class="empty">
              {sessions.length
                ? 'Nothing to show yet. Activity appears here as the agent works.'
                : `No Claude Code or Codex sessions found for ${state.workspace || 'this folder'} yet. Start one here and its activity will appear.`}
            </div>
          )}
          {thinking && current && (
            <div class="thinking-indicator" role="status">
              <span class="dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {AGENT_SHORT_NAME[current.agent]} is thinking
            </div>
          )}
        </div>

        {!atBottom && (
          <button
            class="jump"
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            ↓ Latest
          </button>
        )}
      </div>
    </ViewContext.Provider>
  );
}

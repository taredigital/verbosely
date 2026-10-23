import {
  AGENT_SHORT_NAME,
  type FeedItem,
  type SessionInfo,
} from '../core/events';
import { shortDate } from '../core/time';
import { Elapsed } from './Elapsed';
import { MarksMenu, type Mark } from './MarksMenu';
import type { Filter } from './rows';
import type { Transport } from './transport';

const FOLLOW = '__follow__';

interface Props {
  transport: Transport;
  sessions: SessionInfo[];
  /** The session shown. */
  current?: SessionInfo;
  currentKey?: string;
  following: boolean;
  connected: boolean;
  filter: Filter;
  onFilter(filter: Filter): void;
  marks: Mark[];
  onPickMark(item: FeedItem): void;
  /** When the current turn began, to show how long it has been running. */
  turnStart?: string;
}

/** The session picker (or title), the live badge and the view controls. */
export function Header(props: Props) {
  const { transport, current, filter, onFilter } = props;
  return (
    <header class="bar">
      {transport.readOnly ? (
        // The browser page follows whatever VS Code shows; it can't switch.
        <div class="session-title" title={current?.title}>
          {current
            ? `${AGENT_SHORT_NAME[current.agent]} · ${current.title}`
            : 'Waiting for VS Code…'}
        </div>
      ) : (
        <SessionPicker {...props} />
      )}
      {!props.connected && (
        <div class="error-banner">
          Disconnected from VS Code. Run “Verbosely: Open Feed in Browser” again
          to reconnect.
        </div>
      )}
      <div class="bar-row">
        <LiveBadge session={current} turnStart={props.turnStart} />
        <MarksMenu marks={props.marks} onPick={props.onPickMark} />
        {transport.float && (
          <button
            class="float-button"
            onClick={() => void transport.float?.()}
            title="Float the feed in a small window that stays on top"
          >
            ⧉ Float
          </button>
        )}
        <div class="segmented" role="group" aria-label="Filter">
          <button
            class={filter === 'narration' ? 'on' : ''}
            onClick={() => onFilter('narration')}
            title="Show what the agent says; collapse its steps"
          >
            Narration
          </button>
          <button
            class={filter === 'all' ? 'on' : ''}
            onClick={() => onFilter('all')}
            title="Show every tool call"
          >
            Everything
          </button>
        </div>
      </div>
    </header>
  );
}

function SessionPicker({
  transport,
  sessions,
  current,
  currentKey,
  following,
}: Props) {
  return (
    <select
      class="session-select"
      value={following ? FOLLOW : currentKey}
      onChange={(e) => {
        const value = (e.target as HTMLSelectElement).value;
        if (value === FOLLOW) transport.send({ type: 'follow' });
        else transport.send({ type: 'selectSession', key: value });
      }}
    >
      <option value={FOLLOW}>
        Follow live{current && following ? `: ${current.title}` : ''}
      </option>
      {sessions.map((s) => (
        <option key={s.key} value={s.key}>
          {s.live ? '● ' : ''}
          {AGENT_SHORT_NAME[s.agent]} · {s.title} · {shortDate(s.mtime)}
        </option>
      ))}
    </select>
  );
}

function LiveBadge({
  session,
  turnStart,
}: {
  session?: SessionInfo;
  turnStart?: string;
}) {
  if (!session) return <span class="live-badge" />;
  if (!session.live) return <span class="live-badge past">Past session</span>;
  const agent = AGENT_SHORT_NAME[session.agent];
  return session.status === 'busy' ? (
    <span class="live-badge busy">
      <span class="pulse" /> {agent} is working
      {turnStart && <Elapsed from={turnStart} prefix=" · " />}
    </span>
  ) : (
    <span class="live-badge idle">{agent} · idle</span>
  );
}

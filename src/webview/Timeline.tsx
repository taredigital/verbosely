import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { FeedItem } from '../core/events';
import { displayPath } from '../core/risk';
import { revealInvisible, truncate } from '../core/text';
import {
  clockTime,
  formatDuration,
  fullTime,
  MIN_SHOWN_MS,
} from '../core/time';
import { NoteBox, RowActions, useRowNotes } from './Annotations';
import { Elapsed } from './Elapsed';
import { BookmarkIcon, WarningIcon } from './icons';
import { RichText } from './RichText';
import {
  agentTook,
  buildRows,
  flaggedCount,
  flaggedInside,
  isMarked,
  startedBefore,
  stayInView,
  type Filter,
  type Row,
  type ToolItem,
} from './rows';
import { useView } from './ViewContext';
import { shownCommand, shownPaths, stepRisks } from './whatRan';

interface Props {
  rows: Row[];
  childrenOf: Map<string, FeedItem[]>;
  filter: Filter;
  now: number;
  /** Ids that arrived live (not in the initial load); only these animate in. */
  fresh: Set<string>;
  onOpenFile?: (path: string) => void;
}

type Status = ToolItem['status'];

export function Timeline(props: Props) {
  const { showTimes } = useView();
  const stamps = showTimes ? clockStamps(props.rows) : new Map<Row, string>();
  return (
    <div class="timeline">
      {props.rows.map((row) => (
        <div
          key={rowKey(row)}
          class={props.fresh.has(firstId(row)) ? 'row fresh' : 'row'}
        >
          <RowView row={row} stamp={stamps.get(row)} {...props} />
        </div>
      ))}
    </div>
  );
}

/**
 * The clock time beside prompts and the agent's words. Prompts always get
 * one; messages only when the minute has changed since the last time shown,
 * so a burst of narration doesn't repeat "17:23" on every card.
 */
function clockStamps(rows: Row[]): Map<Row, string> {
  const stamps = new Map<Row, string>();
  let last = '';
  for (const row of rows) {
    if (row.kind !== 'item') continue;
    const { kind, timestamp } = row.item;
    if (kind !== 'prompt' && kind !== 'narration' && kind !== 'thinking')
      continue;
    const stamp = clockTime(timestamp);
    if (!stamp || (kind !== 'prompt' && stamp === last)) continue;
    stamps.set(row, stamp);
    last = stamp;
  }
  return stamps;
}

function rowKey(row: Row): string {
  return row.kind === 'steps' ? row.key : row.item.id;
}

function firstId(row: Row): string {
  return row.kind === 'steps' ? row.tools[0].id : row.item.id;
}

function RowView({
  row,
  stamp,
  ...props
}: Props & { row: Row; stamp?: string }) {
  switch (row.kind) {
    case 'item':
      return <ItemView item={row.item} stamp={stamp} />;
    case 'tool':
      return <ToolRow tool={row.item} onOpenFile={props.onOpenFile} />;
    case 'steps':
      return <StepsRow tools={row.tools} onOpenFile={props.onOpenFile} />;
    case 'agent':
      return <AgentRow tool={row.item} subItems={row.children} {...props} />;
  }
}

/** Makes a non-button element clickable with the mouse and the keyboard. */
function pressable(
  onPress: () => void,
  expanded?: boolean,
): JSX.HTMLAttributes<HTMLDivElement> {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': expanded,
    onClick: onPress,
    onKeyDown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onPress();
    },
  };
}

/**
 * Returns a one-off class when a step finishes while on screen, so it can
 * play its finish animation. Steps already finished when the feed loads
 * never animate.
 */
function useFinishEffect(status: Status): string {
  const previous = useRef(status);
  const [effect, setEffect] = useState('');
  useEffect(() => {
    if (previous.current === 'running' && status !== 'running')
      setEffect(status === 'ok' ? ' just-ok' : ' just-failed');
    previous.current = status;
  }, [status]);
  return effect;
}

function ItemView({
  item,
  stamp,
}: {
  item: Exclude<FeedItem, ToolItem>;
  stamp?: string;
}) {
  const notes = useRowNotes(item.id);
  const { edit } = useView();
  // Only when it has something to show: an empty float would still take
  // its margin from the first line.
  const corner = Boolean(stamp || edit || notes.annotation.bookmark);
  return (
    <>
      <div
        class={itemClass(item)}
        data-id={item.id}
        title={fullTime(item.timestamp)}
      >
        {/* Floats on the first line: the time, then the row's actions. */}
        {corner && (
          <span class="corner">
            {stamp && (
              <time class="stamp" dateTime={item.timestamp}>
                {stamp}
              </time>
            )}
            <RowActions notes={notes} />
          </span>
        )}
        <ItemBody item={item} />
      </div>
      <NoteBox notes={notes} />
    </>
  );
}

function itemClass(item: Exclude<FeedItem, ToolItem>): string {
  switch (item.kind) {
    case 'prompt':
      return 'prompt';
    case 'narration':
      return `narration${item.final ? ' final' : ''}`;
    case 'thinking':
      return 'thinking';
    case 'error':
      return 'error-banner';
    case 'interrupt':
      return 'interrupt';
  }
}

function ItemBody({ item }: { item: Exclude<FeedItem, ToolItem> }) {
  switch (item.kind) {
    case 'prompt':
      return (
        <>
          <div class="who">You</div>
          <div class="prompt-text">{item.text}</div>
        </>
      );
    case 'narration':
      return <RichText text={item.text} />;
    // Readable thinking is usually a progress update written for the user
    // (Claude's "updates" display), so it is shown, not hidden behind a toggle.
    case 'thinking':
      return (
        <>
          <div class="who">
            Thinking
            {item.durationMs !== undefined && item.durationMs >= MIN_SHOWN_MS
              ? ` · ${formatDuration(item.durationMs)}`
              : ''}
          </div>
          <RichText text={item.text} />
        </>
      );
    case 'error':
      return <>⚠ {item.text}</>;
    case 'interrupt':
      return <>⏹ {item.text.replace(/^\[|\]$/g, '')}</>;
  }
}

/**
 * How long a step took, or its clock while it runs (only in a live session
 * and the current turn: a step left running in an old log, or one that never
 * got its result before the last prompt, isn't still going).
 */
function Took({
  running,
  from,
  ms,
}: {
  running: boolean;
  /** When it started. */
  from: string;
  /** How long it took, once finished. */
  ms?: number;
}) {
  const { showTimes, live, turnStart } = useView();
  if (!showTimes) return null;
  if (running)
    return live && !startedBefore(from, turnStart) ? (
      <span class="took">
        <Elapsed from={from} />
      </span>
    ) : null;
  return ms !== undefined && ms >= MIN_SHOWN_MS ? (
    <span class="took">{formatDuration(ms)}</span>
  ) : null;
}

function StatusIcon({ status, effect }: { status: Status; effect?: string }) {
  if (status === 'running')
    return <span class="status running" aria-label="Running" />;
  return (
    <span
      class={`status ${status}${effect ?? ''}`}
      aria-label={status === 'ok' ? 'Done' : 'Failed'}
    >
      {status === 'ok' ? '✓' : '✗'}
    </span>
  );
}

function ToolRow({
  tool,
  onOpenFile,
}: {
  tool: ToolItem;
  onOpenFile?: (path: string) => void;
}) {
  const [open, setOpen] = useState(tool.status === 'error');
  const effect = useFinishEffect(tool.status);
  const notes = useRowNotes(tool.id);
  const { workspace } = useView();
  const { filePath } = tool;
  const hasMore = Boolean(
    (tool.detail && tool.detail !== tool.title) || tool.result,
  );
  return (
    <div class={`tool ${tool.status}${effect}`} data-id={tool.id}>
      <div
        class={`tool-head${hasMore ? ' clickable' : ''}`}
        title={fullTime(tool.timestamp)}
        {...(hasMore ? pressable(() => setOpen(!open), open) : {})}
      >
        <StatusIcon status={tool.status} effect={effect} />
        <span class="tool-name">{revealInvisible(tool.name)}</span>
        <span class="tool-title">{revealInvisible(tool.title)}</span>
        <Took
          running={tool.status === 'running'}
          from={tool.timestamp}
          ms={tool.durationMs}
        />
        <RowActions notes={notes} />
        {filePath && onOpenFile && (
          <a
            class="open-file"
            title={`Open ${revealInvisible(displayPath(filePath, workspace))}`}
            href="#"
            // Enter on the link opens the file, not the row's toggle.
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenFile(filePath);
            }}
          >
            ↗
          </a>
        )}
        <WhatRan tool={tool} workspace={workspace} />
      </div>
      {open && hasMore && (
        <div class="tool-body">
          {tool.detail && tool.detail !== tool.title && (
            <pre class="code">{revealInvisible(tool.detail)}</pre>
          )}
          {tool.result && (
            <pre
              class={`code result${tool.status === 'error' ? ' failed' : ''}`}
            >
              {revealInvisible(tool.result)}
            </pre>
          )}
        </div>
      )}
      <NoteBox notes={notes} />
    </div>
  );
}

/**
 * Under a step's headline (the agent's own words): what actually ran, the
 * files it touched and anything worth a second look.
 */
function WhatRan({ tool, workspace }: { tool: ToolItem; workspace?: string }) {
  // The feed re-renders every few seconds for its clocks; a command can be long.
  const what = useMemo(() => {
    const command = shownCommand(tool);
    return {
      command,
      paths: command ? undefined : shownPaths(tool, workspace),
      risks: stepRisks(tool, workspace),
    };
  }, [tool, workspace]);
  const { command, paths, risks } = what;
  if (!command && !paths && !risks.length) return null;
  return (
    <div class="what-ran">
      {command && (
        <span class="ran-line">
          <span class="ran-command" title={truncate(command.full, 4000)}>
            <span class="sr-only">Command: </span>
            {command.line}
          </span>
          {command.more > 0 && (
            <span class="more-lines">
              +{command.more} {command.more === 1 ? 'line' : 'lines'}
            </span>
          )}
        </span>
      )}
      {paths && (
        <span class="ran-line">
          <span class="ran-paths" title={paths.join('\n')}>
            {paths.join(', ')}
          </span>
        </span>
      )}
      {risks.map((risk) => (
        <span
          key={risk.label}
          class="risk"
          title={`Flagged from what ran, not from the agent's description: ${risk.label}`}
        >
          <WarningIcon />
          <span class="sr-only">Flagged: </span>
          {risk.label}
        </span>
      ))}
    </div>
  );
}

/** On a shut group or subagent box: how many flagged steps it holds. */
function FlaggedCount({ count, inside }: { count: number; inside?: boolean }) {
  const full = `${count} flagged ${count === 1 ? 'step' : 'steps'}${inside ? ' inside' : ''}`;
  return (
    <span class="risk count" title={full}>
      <WarningIcon />
      <span aria-hidden="true">{count} flagged</span>
      <span class="sr-only">{full}</span>
    </span>
  );
}

function StepsRow({
  tools,
  onOpenFile,
}: {
  tools: ToolItem[];
  onOpenFile?: (path: string) => void;
}) {
  const { annotations, workspace } = useView();
  const failed = tools.filter((t) => t.status === 'error');
  const running = tools.some((t) => t.status === 'running');
  // Failed, bookmarked, noted and flagged steps stay visible while it is shut.
  const shown = stayInView(tools, annotations, workspace);
  const flagged = flaggedCount(tools, workspace);
  const [open, setOpen] = useState(false);
  const effect = useFinishEffect(
    running ? 'running' : failed.length ? 'error' : 'ok',
  );
  const last = tools[tools.length - 1];
  return (
    <div class={`steps${failed.length ? ' has-error' : ''}`}>
      <div
        class="steps-head clickable"
        {...pressable(() => setOpen(!open), open)}
      >
        <span class="chevron">{open ? '▾' : '▸'}</span>
        {running ? (
          <span class="status running" aria-label="Running" />
        ) : (
          <span class={`gear${effect}`}>⚙</span>
        )}
        <span class="steps-label">
          {tools.length === 1
            ? revealInvisible(last.title)
            : `${tools.length} steps`}
          {tools.length > 1 && !open && (
            <span class="steps-latest"> · {revealInvisible(last.title)}</span>
          )}
        </span>
        {flagged > 0 && <FlaggedCount count={flagged} />}
        {failed.length > 0 && (
          <span class="steps-failed">{failed.length} failed</span>
        )}
      </div>
      {open && (
        <div class="steps-body">
          {tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
      {!open &&
        shown.map((tool) => (
          <ToolRow key={tool.id} tool={tool} onOpenFile={onOpenFile} />
        ))}
    </div>
  );
}

function AgentRow({
  tool,
  subItems,
  childrenOf,
  filter,
  now,
  fresh,
  onOpenFile,
}: Props & { tool: ToolItem; subItems: FeedItem[] }) {
  const [open, setOpen] = useState(false);
  const lastChild = subItems[subItems.length - 1];
  // Background agents report "launched" straight away, so treat recent
  // activity in the subagent's own log as still running.
  const active =
    tool.status === 'running' ||
    (lastChild !== undefined && now - Date.parse(lastChild.timestamp) < 20_000);
  const effect = useFinishEffect(active ? 'running' : tool.status);
  const rows = open ? buildRows(subItems, filter, childrenOf) : [];
  const notes = useRowNotes(tool.id);
  const { annotations, workspace } = useView();
  const markedInside = subItems.some((item) => isMarked(annotations[item.id]));
  const flagged = flaggedInside(subItems, childrenOf, workspace);
  return (
    <div class="agent" data-id={tool.id}>
      <div
        class="agent-head clickable"
        {...pressable(() => setOpen(!open), open)}
      >
        <span class="chevron">{open ? '▾' : '▸'}</span>
        {active ? (
          <span class="status running" aria-label="Running" />
        ) : (
          <StatusIcon status={tool.status} effect={effect} />
        )}
        <span class="agent-badge">
          {revealInvisible(tool.detail ?? 'agent')}
        </span>
        <span class="tool-title">{revealInvisible(tool.title)}</span>
        <Took
          running={active}
          from={tool.timestamp}
          ms={agentTook(tool, lastChild)}
        />
        {flagged > 0 && !open && <FlaggedCount count={flagged} inside />}
        {markedInside && !open && (
          <span
            class="inner-marks"
            title="Has bookmarks or notes inside"
            role="img"
            aria-label="Has bookmarks or notes inside"
          >
            <BookmarkIcon filled />
          </span>
        )}
        <RowActions notes={notes} />
        <span class="agent-count">{subItems.length}</span>
      </div>
      <NoteBox notes={notes} />
      {open && (
        <div class="agent-body">
          {rows.length ? (
            <Timeline
              rows={rows}
              childrenOf={childrenOf}
              filter={filter}
              now={now}
              fresh={fresh}
              onOpenFile={onOpenFile}
            />
          ) : (
            <div class="muted">No activity recorded yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

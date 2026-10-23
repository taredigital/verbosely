import * as vscode from 'vscode';
import {
  AGENT_SHORT_NAME,
  type FeedItem,
  type SessionInfo,
} from '../core/events';
import type { FeedController } from '../core/FeedController';
import { failuresThisTurn } from '../core/failures';

/**
 * The session the status bar reports on: a busy live one first, then any
 * live one. Independent of the session the feed shows (an old one, picked
 * with follow off, says nothing about whether the agent is working).
 */
export function liveSession(sessions: SessionInfo[]): SessionInfo | undefined {
  return (
    sessions.find((s) => s.live && s.status === 'busy') ??
    sessions.find((s) => s.live)
  );
}

/**
 * A status-bar entry that is always visible: it shows whether the agent is
 * working, flags failed steps in the current turn of the session shown, and
 * opens the feed (at the failures, when there are any:
 * verbosely.showFailures).
 */
export function createStatusItem(
  controller: FeedController,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    'verbosely.status',
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.name = 'Verbosely';
  item.command = 'verbosely.showFailures';

  /** The session the feed shows: the failures are counted in it. */
  let shown: SessionInfo | undefined;
  let live: SessionInfo | undefined;
  let items: FeedItem[] = [];
  const render = () => {
    // Say which session failed when it isn't the one the state is about.
    const elsewhere = shown?.key !== live?.key ? shown : undefined;
    // An old session's failures beside the live agent's name would read as
    // the live agent's, so they are only counted when nothing is live.
    const failed = elsewhere && live ? 0 : failuresThisTurn(items).length;
    const agent = live ? AGENT_SHORT_NAME[live.agent] : 'Agent';
    const busy = live?.status === 'busy';
    // Kept short (the spinner says "working"); the words are in the tooltip.
    // No red background: a failed step is worth a glance, not an alarm.
    item.text = busy
      ? `$(loading~spin) ${agent}`
      : `$(list-flat)${live ? ` ${agent}` : ''}`;
    if (failed) item.text += ` $(error) ${failed}`;
    const state = busy
      ? `${agent} is working`
      : live
        ? `${agent} is idle`
        : 'No live session';
    const failures = failed
      ? `${failed} failed step${failed === 1 ? '' : 's'} since your last message` +
        (elsewhere ? ` in the session shown (${elsewhere.title})` : '')
      : '';
    item.accessibilityInformation = {
      label: `Verbosely: ${[state, failures].filter(Boolean).join(', ')}`,
    };
    item.tooltip = [
      live ? `${state}: ${live.title}` : state,
      failures,
      failed ? 'Click to see what failed' : 'Click to open Verbosely',
    ]
      .filter(Boolean)
      .join('\n');
    item.show();
  };

  const subscription = controller.subscribe({
    onReset: (s, all) => {
      shown = s;
      items = all;
      render();
    },
    onUpsert: () => {
      items = controller.items();
      render();
    },
    onSessions: (sessions, currentKey) => {
      shown = sessions.find((s) => s.key === currentKey) ?? shown;
      live = liveSession(sessions);
      render();
    },
  });

  return {
    dispose() {
      subscription.dispose();
      item.dispose();
    },
  };
}

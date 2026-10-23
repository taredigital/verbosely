// How the feed and the export write times: step durations ("14s", "2m 05s")
// and clock times ("17:23", with the date when it isn't today).

/** Durations under a second aren't worth a label; most reads and edits are. */
export const MIN_SHOWN_MS = 1000;

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${pad(total % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** "17:23", or "Oct 20, 17:23" for another day; '' without a valid time. */
export function clockTime(timestamp: string, now = Date.now()): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}

/** The full local time ("5:19:47 PM"), for tooltips; '' without a valid time. */
export function fullTime(timestamp: string): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

/** When a session last changed: the time if today, else the date ("Oct 20"). */
export function shortDate(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  return date.toDateString() === new Date(now).toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Milliseconds from an ISO timestamp to `now`, or undefined. */
export function since(timestamp: string, now: number): number | undefined {
  const start = Date.parse(timestamp);
  return Number.isFinite(start) && now >= start ? now - start : undefined;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

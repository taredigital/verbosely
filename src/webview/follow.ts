// When the feed keeps its newest entry in view. Kept apart from App so the
// rule can be tested without a DOM.

/** How close to the end still counts as reading the latest. */
const END_SLACK = 40;

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** The reader is at (or within a line of) the end. */
export function atEnd(box: ScrollBox): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight < END_SLACK;
}

/**
 * Whether a feed that follows the newest entry should still follow when an
 * update arrives. `pinnedHeight` is the content height when it last scrolled
 * to the end (or the reader last scrolled). Content that grew since without
 * a scroll (a step's output or a note box opened) leaves the reader's real
 * place to decide; a window that only changed size keeps following.
 */
export function keepFollowing(box: ScrollBox, pinnedHeight: number): boolean {
  return box.scrollHeight === pinnedHeight || atEnd(box);
}

/** The reader is writing a note in the feed: don't move it under them. */
export function writingIn(el: HTMLElement): boolean {
  const active = el.ownerDocument.activeElement;
  return active?.tagName === 'TEXTAREA' && el.contains(active);
}

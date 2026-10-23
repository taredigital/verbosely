import { useEffect, useRef, useState } from 'preact/hooks';
import type { Annotation } from '../core/annotations';
import type { FeedItem } from '../core/events';
import { BookmarkIcon, NoteIcon } from './icons';
import { markLabel } from './rows';

export interface Mark {
  item: FeedItem;
  annotation: Annotation;
}

/** The header's list of bookmarked and noted rows; picking one jumps to it. */
export function MarksMenu({
  marks,
  onPick,
}: {
  marks: Mark[];
  onPick(item: FeedItem): void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The feed can float in a picture-in-picture window, a different document.
    const doc = root.current?.ownerDocument;
    if (!open || !doc) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener('mousedown', close);
    return () => doc.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (!marks.length) setOpen(false);
  }, [marks.length]);
  if (!marks.length) return null;

  const bookmarks = marks.filter((m) => m.annotation.bookmark).length;
  const noted = marks.length - bookmarks;
  return (
    <div
      class="marks"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <button
        class={`marks-button${open ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        title={[
          bookmarks && `${bookmarks} bookmarked`,
          noted && `${noted} with a note`,
        ]
          .filter(Boolean)
          .join(', ')}
        onClick={() => setOpen(!open)}
      >
        <BookmarkIcon filled /> {marks.length}
      </button>
      {open && (
        <div class="marks-list" role="menu" aria-label="Bookmarks and notes">
          {marks.map(({ item, annotation }) => (
            <button
              key={item.id}
              class="mark"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(item);
              }}
            >
              <span class="mark-icon">
                {annotation.bookmark ? (
                  <BookmarkIcon filled />
                ) : (
                  <NoteIcon filled />
                )}
              </span>
              <span class="mark-text">
                <span class="mark-label">{markLabel(item)}</span>
                {annotation.note && (
                  <span class="mark-note">{annotation.note}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

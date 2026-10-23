// A row's bookmark and note: the buttons, the note under the row and the box
// to write one. The state lives in the host's AnnotationStore; these send
// changes through the view's `edit` and render what comes back.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_NOTE_LENGTH, type Annotation } from '../core/annotations';
import { BookmarkIcon, NoteIcon } from './icons';
import { useView } from './ViewContext';

export interface RowNotes {
  id: string;
  annotation: Annotation;
  editing: boolean;
  setEditing(editing: boolean): void;
}

/**
 * A row's bookmark and note, and whether its note is being edited. A row
 * that comes back (its session shown again) reopens an unsaved note.
 */
export function useRowNotes(id: string): RowNotes {
  const { annotations, edit } = useView();
  const [editing, setEditing] = useState(() => edit?.draft(id) !== undefined);
  return { id, annotation: annotations[id] ?? {}, editing, setEditing };
}

/**
 * The bookmark and note buttons. They show on hover and keyboard focus; a
 * set bookmark stays visible as the row's marker. Read-only views show only
 * the marker.
 */
export function RowActions({ notes }: { notes: RowNotes }) {
  const { edit } = useView();
  const { bookmark, note } = notes.annotation;
  if (!edit)
    return bookmark ? (
      <span class="actions">
        <span
          class="act on"
          title="Bookmarked"
          role="img"
          aria-label="Bookmarked"
        >
          <BookmarkIcon filled />
        </span>
      </span>
    ) : null;
  // The rows these sit in toggle on click and Enter; keep those for the buttons.
  const stop = (e: Event) => e.stopPropagation();
  return (
    <span class="actions" onClick={stop} onKeyDown={stop}>
      <button
        class={`act${bookmark ? ' on' : ''}`}
        title={bookmark ? 'Remove bookmark' : 'Bookmark'}
        aria-pressed={Boolean(bookmark)}
        onClick={() => edit.bookmark(notes.id, !bookmark)}
      >
        <BookmarkIcon filled={bookmark} />
      </button>
      <button
        class="act"
        title={note ? 'Edit note' : 'Add a note'}
        onClick={() => notes.setEditing(true)}
      >
        <NoteIcon filled={Boolean(note)} />
      </button>
    </span>
  );
}

/** The row's note, under it; or the box to write one. */
export function NoteBox({ notes }: { notes: RowNotes }) {
  const { edit } = useView();
  const { note } = notes.annotation;
  if (notes.editing && edit)
    return (
      <NoteEditor
        initial={note ?? ''}
        draft={edit.draft(notes.id)}
        onDraft={(text) => edit.setDraft(notes.id, text)}
        onSave={(text) => {
          edit.note(notes.id, text);
          edit.setDraft(notes.id, undefined);
          notes.setEditing(false);
        }}
        onCancel={() => {
          edit.setDraft(notes.id, undefined);
          notes.setEditing(false);
        }}
      />
    );
  if (!note) return null;
  return (
    <div class="note">
      <span class="note-icon" aria-hidden="true">
        <NoteIcon filled />
      </span>
      <div class="note-text">{note}</div>
      {edit && (
        <span class="note-actions">
          <button onClick={() => notes.setEditing(true)}>Edit</button>
          <button onClick={() => edit.note(notes.id, '')}>Delete</button>
        </span>
      )}
    </div>
  );
}

function NoteEditor({
  initial,
  draft,
  onDraft,
  onSave,
  onCancel,
}: {
  initial: string;
  /** Unsaved text from before the row went away; it doesn't take focus. */
  draft?: string;
  onDraft(text: string): void;
  onSave(text: string): void;
  onCancel(): void;
}) {
  const [text, setText] = useState(draft ?? initial);
  const restored = useRef(draft !== undefined);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || restored.current) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave(text);
    }
  };
  return (
    <div class="note editing">
      <textarea
        ref={box}
        rows={3}
        maxLength={MAX_NOTE_LENGTH}
        value={text}
        placeholder="Write a note. Only you see it; it stays on this computer."
        aria-label="Note"
        onInput={(e) => {
          const value = (e.target as HTMLTextAreaElement).value;
          setText(value);
          onDraft(value);
        }}
        onKeyDown={onKeyDown}
      />
      <div class="note-buttons">
        <button class="primary" onClick={() => onSave(text)}>
          Save
        </button>
        <button onClick={onCancel}>Cancel</button>
        <span class="hint">Ctrl+Enter to save, Esc to cancel</span>
      </div>
    </div>
  );
}

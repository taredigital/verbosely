import { describe, expect, it } from 'vitest';
import {
  AnnotationStore,
  MAX_NOTE_LENGTH,
  type KeyValueStore,
} from '../src/core/annotations';

/** Behaves like VS Code's Memento: undefined deletes the key. */
function memory(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: <T>(key: string) => data.get(key) as T | undefined,
    update(key, value) {
      if (value === undefined) data.delete(key);
      else data.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
}

describe('AnnotationStore', () => {
  it('keeps bookmarks and notes per session and item', () => {
    const store = new AnnotationStore(memory());
    store.setBookmark('claude:a', 'item-1', true);
    store.setNote('claude:a', 'item-2', '  check this later  ');
    store.setBookmark('codex:b', 'item-1', true);

    expect(store.get('claude:a')).toEqual({
      'item-1': { bookmark: true },
      'item-2': { note: 'check this later' },
    });
    expect(store.get('codex:b')).toEqual({ 'item-1': { bookmark: true } });
    expect(store.get('claude:other')).toEqual({});
  });

  it('survives a reload, since it lives in the storage it was given', () => {
    const storage = memory();
    new AnnotationStore(storage).setNote('claude:a', 'x', 'kept');
    expect(new AnnotationStore(storage).get('claude:a')).toEqual({
      x: { note: 'kept' },
    });
  });

  it('removes an entry once it has neither a bookmark nor a note', () => {
    const storage = memory();
    const store = new AnnotationStore(storage);
    store.setBookmark('claude:a', 'x', true);
    store.setNote('claude:a', 'x', 'note');
    store.setNote('claude:a', 'x', '   ');
    expect(store.get('claude:a')).toEqual({ x: { bookmark: true } });
    store.setBookmark('claude:a', 'x', false);
    expect(store.get('claude:a')).toEqual({});
    // Nothing left for the session: the key itself is gone.
    expect(storage.data.size).toBe(0);
  });

  it('caps the length of a note', () => {
    const store = new AnnotationStore(memory());
    store.setNote('claude:a', 'x', 'a'.repeat(MAX_NOTE_LENGTH + 50));
    expect(store.get('claude:a').x.note).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('tells listeners which session changed', () => {
    const store = new AnnotationStore(memory());
    const seen: string[] = [];
    const sub = store.onChange((key) => seen.push(key));
    store.setBookmark('claude:a', 'x', true);
    sub.dispose();
    store.setBookmark('claude:b', 'x', true);
    expect(seen).toEqual(['claude:a']);
  });
});

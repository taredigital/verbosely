import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Annotations } from '../core/annotations';

/** What every row needs from the app, without passing it down each level. */
export interface ViewState {
  annotations: Annotations;
  showTimes: boolean;
  /** The session is live, so a running step's clock can tick. */
  live: boolean;
  /** When the current turn's prompt was sent: older steps have no clock. */
  turnStart?: string;
  /** The folder the feed watches: paths in it show relative, writes outside are flagged. */
  workspace?: string;
  /** Absent on the read-only browser page. */
  edit?: {
    bookmark(id: string, on: boolean): void;
    note(id: string, text: string): void;
    /** A note being written and not yet saved, kept while its row is away. */
    draft(id: string): string | undefined;
    setDraft(id: string, text: string | undefined): void;
  };
}

export const ViewContext = createContext<ViewState>({
  annotations: {},
  showTimes: true,
  live: false,
});

export function useView(): ViewState {
  return useContext(ViewContext);
}

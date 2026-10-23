import type { HostMessage, WebviewMessage } from '../shared/protocol';

/**
 * How the UI talks to the host. The VS Code webviews use postMessage; the
 * browser page reads a one-way Server-Sent Events stream.
 */
export interface Transport {
  send(message: WebviewMessage): void;
  onMessage(handler: (message: HostMessage) => void): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
  /** The browser page can only watch: no session switching or file opening. */
  readOnly?: boolean;
  /** Present when the page can open a picture-in-picture window. */
  float?: () => Promise<void>;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export function inVsCode(): boolean {
  return typeof acquireVsCodeApi === 'function';
}

export function vscodeTransport(): Transport {
  const api = acquireVsCodeApi();
  return {
    send: (message) => api.postMessage(message),
    onMessage: (handler) =>
      window.addEventListener('message', (event: MessageEvent) =>
        handler(event.data as HostMessage),
      ),
    getState: <T>() => api.getState() as T | undefined,
    setState: (state) => api.setState(state),
  };
}

const STORAGE_KEY = 'verbosely.state';

/**
 * The page and its stream are authorised by an HttpOnly cookie the server
 * set when the browser opened the link, so nothing here holds a key.
 */
export function browserTransport(): Transport {
  const handlers: ((message: HostMessage) => void)[] = [];
  const emit = (message: HostMessage) => handlers.forEach((h) => h(message));
  let source: EventSource | undefined;

  return {
    readOnly: true,
    float: canFloat() ? floatWindow : undefined,
    send(message) {
      // Read-only: the only message that matters is the initial "ready",
      // which opens the stream. EventSource reconnects on its own.
      if (message.type !== 'ready' || source) return;
      // Same origin, so the browser sends the cookie (reconnects too).
      source = new EventSource('/events');
      source.onopen = () => emit({ type: 'connection', connected: true });
      source.onerror = () => emit({ type: 'connection', connected: false });
      source.onmessage = (event) => {
        try {
          emit(JSON.parse(event.data) as HostMessage);
        } catch {
          // Ignore a malformed message rather than break the page.
        }
      };
    },
    onMessage: (handler) => handlers.push(handler),
    getState<T>() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as T) : undefined;
      } catch {
        return undefined;
      }
    },
    setState(state) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage can be unavailable (private windows); state is optional.
      }
    },
  };
}

interface DocumentPictureInPicture {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

function pictureInPicture(): DocumentPictureInPicture | undefined {
  return (
    window as unknown as { documentPictureInPicture?: DocumentPictureInPicture }
  ).documentPictureInPicture;
}

function canFloat(): boolean {
  return pictureInPicture() !== undefined;
}

/**
 * Moves the live feed into an always-on-top picture-in-picture window
 * (Chrome and Edge 116+). The same DOM moves across, so it keeps updating;
 * closing the window moves it back into the tab.
 */
async function floatWindow(): Promise<void> {
  const api = pictureInPicture();
  const root = document.getElementById('root');
  if (!api || !root) return;
  const pip = await api.requestWindow({ width: 380, height: 560 });
  pip.document.title = 'Verbosely';
  pip.document.documentElement.dataset.mode = 'browser';
  pip.document.body.dataset.mode = 'browser';
  for (const style of document.head.querySelectorAll('style'))
    pip.document.head.appendChild(style.cloneNode(true));

  const placeholder = document.createElement('div');
  placeholder.className = 'empty';
  placeholder.textContent =
    'The feed is floating in its own window. Close that window to bring it back here.';
  root.replaceWith(placeholder);
  pip.document.body.appendChild(root);

  pip.addEventListener('pagehide', () => placeholder.replaceWith(root), {
    once: true,
  });
}

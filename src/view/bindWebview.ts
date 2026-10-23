import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { FeedController } from '../core/FeedController';
import { streamFeed, type FeedExtras } from '../core/feedStream';
import { parseWebviewMessage, type HostMessage } from '../shared/protocol';

/** What a feed view needs from the extension. */
export interface FeedServices {
  readonly extensionUri: vscode.Uri;
  /** Absent when no folder is open. */
  readonly controller?: FeedController;
  readonly extras: FeedExtras;
  exportMarkdown(): void;
}

/**
 * Requests to scroll the feed to a row (the status bar's failures). Every
 * feed that has loaded scrolls to it; if none has (the side bar was never
 * opened), the next one to load picks the request up, if it is recent.
 */
const reveals = new vscode.EventEmitter<string>();
let pendingReveal: { id: string; at: number } | undefined;
const PENDING_REVEAL_MS = 10_000;

export function revealInFeed(id: string): void {
  pendingReveal = { id, at: Date.now() };
  reveals.fire(id);
}

/** Connects one webview (side bar or pop-out) to the feed. */
export function bindWebview(
  webview: vscode.Webview,
  services: FeedServices,
): vscode.Disposable {
  const { controller, extras } = services;
  const post = (message: HostMessage) => void webview.postMessage(message);
  let subscription: { dispose(): void } | undefined;
  let ready = false;
  const onReveal = reveals.event((id) => {
    if (!ready) return;
    post({ type: 'reveal', id });
    pendingReveal = undefined;
  });

  const receiver = webview.onDidReceiveMessage((raw: unknown) => {
    const message = parseWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        subscription?.dispose();
        if (!controller) {
          post({ type: 'noWorkspace' });
          return;
        }
        post({ type: 'workspace', path: controller.workspace ?? '' });
        subscription = streamFeed(controller, extras, post);
        ready = true;
        if (pendingReveal && Date.now() - pendingReveal.at < PENDING_REVEAL_MS)
          post({ type: 'reveal', id: pendingReveal.id });
        pendingReveal = undefined;
        break;
      case 'selectSession':
        controller?.select(message.key);
        break;
      case 'follow':
        controller?.follow();
        break;
      case 'openFile':
        // Only files the feed shows: a view can't open anything else.
        if (controller?.hasFile(message.path))
          void openFile(resolveFeedPath(message.path, controller.workspace));
        break;
      case 'export':
        services.exportMarkdown();
        break;
      case 'bookmark':
        extras.annotations?.setBookmark(
          message.sessionKey,
          message.id,
          message.on,
        );
        break;
      case 'note':
        extras.annotations?.setNote(
          message.sessionKey,
          message.id,
          message.text,
        );
        break;
    }
  });

  return {
    dispose() {
      receiver.dispose();
      onReveal.dispose();
      subscription?.dispose();
    },
  };
}

/**
 * A path as the feed records it, made absolute. Some logs give paths
 * relative to the workspace (Codex CLI's apply_patch), not to the extension
 * host's working directory.
 */
export function resolveFeedPath(
  filePath: string,
  workspace: string | undefined,
): string {
  return workspace && !path.isAbsolute(filePath)
    ? path.resolve(workspace, filePath)
    : filePath;
}

async function openFile(filePath: string): Promise<void> {
  try {
    if (!fs.statSync(filePath).isFile()) return;
  } catch {
    void vscode.window.showWarningMessage(
      `Verbosely: ${filePath} no longer exists.`,
    );
    return;
  }
  // vscode.open picks the right editor, so images and PDFs open too.
  const uri = vscode.Uri.file(filePath);
  await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
}

import * as vscode from 'vscode';
import { bindWebview, type FeedServices } from './bindWebview';
import { getWebviewHtml } from './webviewHtml';

// VS Code's own commands. Both window commands act on the focused window, and
// always-on-top only applies to a floating (auxiliary) window, so they are
// run after the move, once the new window has focus. If focus has gone back
// to the main window by then they do nothing, which is the safe outcome.
const MOVE_TO_NEW_WINDOW = 'workbench.action.moveEditorToNewWindow';
const ALWAYS_ON_TOP = 'workbench.action.enableWindowAlwaysOnTop';
const COMPACT = 'workbench.action.enableCompactAuxiliaryWindow';

/**
 * The feed as an editor tab that can be popped out into its own small,
 * always-on-top window: picture-in-picture inside VS Code.
 */
export class FeedPanel {
  private static current?: FeedPanel;
  private readonly disposables: vscode.Disposable[] = [];

  /** Brings the floating feed forward if one is open; false if there is none. */
  static showIfOpen(): boolean {
    FeedPanel.current?.panel.reveal(undefined, true);
    return Boolean(FeedPanel.current);
  }

  /** Shows the feed in a floating window, reusing one that is already open. */
  static async popOut(services: FeedServices): Promise<void> {
    if (FeedPanel.current) {
      FeedPanel.current.panel.reveal();
      return;
    }
    const panel = new FeedPanel(services);
    FeedPanel.current = panel;
    await panel.float();
  }

  readonly panel: vscode.WebviewPanel;

  private constructor(services: FeedServices) {
    const { extensionUri } = services;
    this.panel = vscode.window.createWebviewPanel(
      'verbosely.panel',
      'Verbosely',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(
      extensionUri,
      'media',
      'icon.png',
    );
    this.panel.webview.html = getWebviewHtml(
      this.panel.webview,
      extensionUri,
      'panel',
    );
    this.disposables.push(
      bindWebview(this.panel.webview, services),
      this.panel.onDidDispose(() => this.dispose()),
    );
  }

  private async float(): Promise<void> {
    const config = vscode.workspace.getConfiguration('verbosely.popOut');
    // Let the new tab become the active editor before moving it.
    await waitFor(() => this.panel.active, 1000);
    if (!this.panel.active) return;
    await vscode.commands.executeCommand(MOVE_TO_NEW_WINDOW);
    // The floating window takes focus asynchronously; pinning is a no-op
    // until it has, so try again shortly after.
    for (const delay of [250, 750]) {
      await sleep(delay);
      if (config.get<boolean>('alwaysOnTop', true))
        await runQuietly(ALWAYS_ON_TOP);
      if (config.get<boolean>('compact', true)) await runQuietly(COMPACT);
    }
  }

  private dispose(): void {
    FeedPanel.current = undefined;
    for (const d of this.disposables) d.dispose();
  }
}

/** Older VS Code builds lack some window commands; skip those silently. */
async function runQuietly(command: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(command);
  } catch {
    // Not available in this VS Code version.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!check() && Date.now() - start < timeoutMs) await sleep(50);
}

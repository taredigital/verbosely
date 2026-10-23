import * as vscode from 'vscode';
import { bindWebview, type FeedServices } from './bindWebview';
import { getWebviewHtml } from './webviewHtml';

/** The feed in the activity bar's side bar. */
export class FeedViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'verbosely.feed';

  constructor(private readonly services: FeedServices) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    const { extensionUri } = this.services;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
    };
    view.webview.html = getWebviewHtml(view.webview, extensionUri, 'sidebar');
    const binding = bindWebview(view.webview, this.services);
    view.onDidDispose(() => binding.dispose());
  }
}

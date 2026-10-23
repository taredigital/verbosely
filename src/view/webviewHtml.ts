import * as crypto from 'crypto';
import * as vscode from 'vscode';

/** The page shell for the feed UI, shared by the sidebar and the pop-out. */
export function getWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  mode: 'sidebar' | 'panel',
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'),
  );
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verbosely</title>
</head>
<body data-mode="${mode}">
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/** A fresh random value per page, so only the bundle's own script runs. */
function makeNonce(): string {
  return crypto.randomBytes(24).toString('base64');
}

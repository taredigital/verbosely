import * as vscode from 'vscode';
import type { AgentAdapter } from './adapters/AgentAdapter';
import { ClaudeAdapter } from './adapters/ClaudeAdapter';
import { CodexAdapter } from './adapters/CodexAdapter';
import { exportMarkdown, showFailures } from './commands';
import { AnnotationStore } from './core/annotations';
import { FeedController, type FeedSettings } from './core/FeedController';
import { LiveValue, type FeedOptions } from './core/feedStream';
import { FeedServer } from './server/FeedServer';
import type { FeedServices } from './view/bindWebview';
import { FeedPanel } from './view/FeedPanel';
import { FeedViewProvider } from './view/FeedViewProvider';
import { createStatusItem } from './view/StatusItem';

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('verbosely');
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const controller = workspacePath
    ? new FeedController(
        createAdapters(config),
        workspacePath,
        readFeedSettings(),
      )
    : undefined;
  if (controller)
    context.subscriptions.push(controller, createStatusItem(controller));

  // Bookmarks and notes stay on this computer, per workspace.
  const annotations = new AnnotationStore(context.workspaceState);
  const options = new LiveValue(readOptions());
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('verbosely.timestamps') ||
        e.affectsConfiguration('verbosely.maxItems')
      )
        options.set(readOptions());
      if (
        e.affectsConfiguration('verbosely.initialHistoryMB') ||
        e.affectsConfiguration('verbosely.maxItems')
      )
        controller?.updateSettings(readFeedSettings());
    }),
  );

  const services: FeedServices = {
    extensionUri: context.extensionUri,
    controller,
    extras: { annotations, options },
    exportMarkdown: () => void exportMarkdown(controller, annotations),
  };

  // The browser view's server starts on demand and stops itself after the
  // last tab closes.
  let server: FeedServer | undefined;
  const openInBrowser = async () => {
    if (!controller) {
      void vscode.window.showInformationMessage(
        'Verbosely: open a folder first.',
      );
      return;
    }
    server ??= new FeedServer(
      controller,
      vscode.Uri.joinPath(context.extensionUri, 'dist').fsPath,
      () => (server = undefined),
      services.extras,
    );
    const url = await server.start();
    await vscode.env.openExternal(vscode.Uri.parse(url, true));
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      FeedViewProvider.viewId,
      new FeedViewProvider(services),
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('verbosely.exportMarkdown', () =>
      exportMarkdown(controller, annotations),
    ),
    vscode.commands.registerCommand('verbosely.showFailures', () =>
      showFailures(controller),
    ),
    vscode.commands.registerCommand('verbosely.followLive', () =>
      controller?.follow(),
    ),
    vscode.commands.registerCommand('verbosely.popOut', () =>
      FeedPanel.popOut(services),
    ),
    vscode.commands.registerCommand('verbosely.openInBrowser', openInBrowser),
    { dispose: () => server?.dispose() },
  );
}

export function deactivate(): void {}

/** The agents to read, from the `verbosely.agents` setting. */
function createAdapters(config: vscode.WorkspaceConfiguration): AgentAdapter[] {
  const value = config.get<unknown>('agents');
  const enabled = Array.isArray(value) ? value : ['claude', 'codex'];
  const adapters: AgentAdapter[] = [];
  if (enabled.includes('claude')) adapters.push(new ClaudeAdapter());
  if (enabled.includes('codex')) adapters.push(new CodexAdapter());
  return adapters;
}

function readOptions(): FeedOptions {
  const config = vscode.workspace.getConfiguration('verbosely');
  return {
    showTimes: config.get<boolean>('timestamps', true),
    maxItems: readMaxItems(config),
  };
}

/**
 * Memory limits, held to the ranges the settings declare: VS Code doesn't
 * enforce a schema's minimum and maximum, and a value far out of range could
 * exhaust the extension host.
 */
function readFeedSettings(): FeedSettings {
  const config = vscode.workspace.getConfiguration('verbosely');
  return {
    initialBytes: clamp(config.get('initialHistoryMB'), 4, 1, 64) * 1024 * 1024,
    maxItems: readMaxItems(config),
  };
}

function readMaxItems(config: vscode.WorkspaceConfiguration): number {
  return clamp(config.get('maxItems'), 4000, 200, 20_000);
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const n =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

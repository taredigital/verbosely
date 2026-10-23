import * as vscode from 'vscode';
import type { AnnotationStore } from './core/annotations';
import type { FeedController } from './core/FeedController';
import { failuresThisTurn } from './core/failures';
import { toMarkdown } from './core/markdown';
import { revealInvisible } from './core/text';
import { revealInFeed } from './view/bindWebview';
import { FeedPanel } from './view/FeedPanel';

/**
 * Opens the shown session as a Markdown document, with its bookmarks and
 * notes, and likely secrets redacted unless the user turned that off.
 */
export async function exportMarkdown(
  controller: FeedController | undefined,
  annotations: AnnotationStore,
): Promise<void> {
  const session = controller?.session;
  if (!controller || !session) {
    void vscode.window.showInformationMessage(
      'Verbosely: no session to export yet.',
    );
    return;
  }
  const redactSecrets = vscode.workspace
    .getConfiguration('verbosely')
    .get<boolean>('exportRedactSecrets', true);
  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: toMarkdown(
      session,
      controller.items(),
      annotations.get(session.key),
      { workspace: controller.workspace, redactSecrets },
    ),
  });
  await vscode.window.showTextDocument(doc);
}

/**
 * The status bar's click: open the feed at what failed this turn. One
 * failure goes straight there; several are listed first, newest on top.
 */
export async function showFailures(
  controller: FeedController | undefined,
): Promise<void> {
  const failed = controller ? failuresThisTurn(controller.items()) : [];
  let target = failed[0];
  if (failed.length > 1) {
    const picked = await vscode.window.showQuickPick(
      failed.map((f) => ({
        label: `$(error) ${revealInvisible(f.tool.title)}`,
        description: f.tool.parentId
          ? `${f.tool.name} · in a subagent`
          : f.tool.name,
        detail: f.tool.result?.split('\n').find((line) => line.trim()),
        failure: f,
      })),
      {
        placeHolder: `${failed.length} steps failed since your last message. Pick one to see it in the feed.`,
      },
    );
    if (!picked) return;
    target = picked.failure;
  }
  if (!FeedPanel.showIfOpen())
    await vscode.commands.executeCommand('verbosely.feed.focus');
  if (target) revealInFeed(target.revealId);
}

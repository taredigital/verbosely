import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedController } from '../src/core/FeedController';

const vscode = vi.hoisted(() => ({
  executeCommand: vi.fn(() => Promise.resolve()),
  showWarningMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = () => ({ dispose() {} });
    fire() {}
  },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  commands: { executeCommand: vscode.executeCommand },
  window: { showWarningMessage: vscode.showWarningMessage },
}));

import { bindWebview, resolveFeedPath } from '../src/view/bindWebview';

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'verbosely-ws-'));
  fs.mkdirSync(path.join(workspace, 'src'));
  fs.writeFileSync(path.join(workspace, 'src', 'sum.ts'), 'x');
  fs.writeFileSync(path.join(workspace, 'src', 'other.ts'), 'x');
  fs.writeFileSync(path.join(workspace, 'chart.png'), 'png');
  vscode.executeCommand.mockClear();
  vscode.showWarningMessage.mockClear();
});
afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

/** A webview bound to a controller whose feed touched `feedFiles`. */
function bind(feedFiles: string[]) {
  let receive: (message: unknown) => void = () => {};
  const webview = {
    postMessage: () => Promise.resolve(true),
    onDidReceiveMessage: (fn: (message: unknown) => void) => {
      receive = fn;
      return { dispose() {} };
    },
  };
  const asked: string[] = [];
  const controller = {
    workspace,
    hasFile: (filePath: string) => {
      asked.push(filePath);
      return feedFiles.includes(filePath);
    },
  } as unknown as FeedController;
  bindWebview(webview as never, {
    extensionUri: {} as never,
    controller,
    extras: {},
    exportMarkdown() {},
  });
  return {
    open: (filePath: string) => receive({ type: 'openFile', path: filePath }),
    asked,
  };
}

describe('opening a file from the feed', () => {
  it('resolves a workspace-relative path (Codex CLI apply_patch)', () => {
    const view = bind(['src/sum.ts']);
    view.open('src/sum.ts');
    // The feed is asked about the path as it recorded it.
    expect(view.asked).toEqual(['src/sum.ts']);
    expect(vscode.showWarningMessage).not.toHaveBeenCalled();
    expect(vscode.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      { fsPath: path.join(workspace, 'src', 'sum.ts') },
      { preview: true },
    );
  });

  it('opens any kind of file through vscode.open (images, PDFs)', () => {
    const png = path.join(workspace, 'chart.png');
    bind([png]).open(png);
    expect(vscode.executeCommand).toHaveBeenCalledWith(
      'vscode.open',
      { fsPath: png },
      { preview: true },
    );
  });

  it('opens nothing the feed does not show', () => {
    bind(['src/sum.ts']).open('src/other.ts');
    expect(vscode.executeCommand).not.toHaveBeenCalled();
  });

  it('warns when the file is gone', () => {
    bind(['src/gone.ts']).open('src/gone.ts');
    expect(vscode.executeCommand).not.toHaveBeenCalled();
    expect(vscode.showWarningMessage).toHaveBeenCalledOnce();
  });
});

describe('resolveFeedPath', () => {
  it('leaves absolute paths, and paths without a workspace, alone', () => {
    const absolute = path.join(os.tmpdir(), 'a.ts');
    expect(resolveFeedPath(absolute, '/ws')).toBe(absolute);
    expect(resolveFeedPath('src/a.ts', undefined)).toBe('src/a.ts');
    expect(resolveFeedPath('src/a.ts', workspace)).toBe(
      path.join(workspace, 'src', 'a.ts'),
    );
  });
});

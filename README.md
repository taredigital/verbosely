# Verbosely

**Verbose mode for your coding agent.** See what Claude Code and Codex are actually doing, not just their final answer.

When Claude Code or Codex runs on auto, its narration, commands, results and failures scroll past or get collapsed. Verbosely keeps that middle layer in a calm, readable feed in your side bar, live as the agent works.

![The Verbosely feed following Claude Code as it fixes a bug: its narration, the test run that failed, shown in red, the fix, and then every step.](https://taredigital.com/verbosely/listing/feed.gif)

_A real Claude Code session, played back at 4x speed. [Watch the trailer](https://taredigital.com/verbosely/#trailer)._

## Features

- **Works with Claude Code and Codex.** Sessions from both appear in one picker, labelled by agent.
- **Live feed** of the session running in your workspace. It follows whichever session is busy.
- **Narration mode** shows what the agent says and folds the steps in between into one line. Failures always stay visible.
- **Everything mode** shows every tool call, with its command and output.
- **What actually ran.** A step's headline is the agent's own description of it, so each row also shows the command or file it really used, and flags steps worth a second look: a downloaded script run in a shell, a file uploaded, a recursive delete, a force push, credentials touched, settings for the agent, git or the editor changed, or a write outside the workspace. Hidden characters in a command are shown, not hidden.
- **Subagents** appear as boxes you can open to see their own work.
- **Past sessions** for this folder can be reopened from the session picker.
- **Open files** the agent read or edited with one click.
- **Pop out** the feed into a small window that stays on top of your other apps, with the pin button or "Pop Out Feed" in the Command Palette. It has no default key; you can set one in Keyboard Shortcuts. Handy while you watch an emulator or browser.
- **Float it in your browser.** "Open Feed in Browser" shows the feed in Chrome or Edge, and **Float** puts it in a picture-in-picture window that stays visible even with VS Code minimised.
- **Status bar** shows whether the agent is working and how many steps failed. Click it to see what failed: one failure opens the feed at that step; several are listed first, so you can pick one.
- **Times.** Each step shows how long it took, prompts and messages show the time, and "working" shows how long the current turn has been running. Turn them off with `verbosely.timestamps`.
- **Bookmarks and notes.** Hover any row to bookmark it or write a note on it. The bookmark button in the header lists them all, so you can jump back. Bookmarks and notes are saved on this computer, for this workspace, and are never written into the agent's logs or sent to the agent.
- **Export a session as Markdown**, a readable record of what happened, with your bookmarks and notes. Things that look like secrets (API keys, tokens, private keys) are replaced with `[redacted]`.

![Three views of the feed: Narration with the failed step open, Everything with how long each step took, and a bookmark and a note with the bookmarks list open.](https://taredigital.com/verbosely/listing/screenshots.png)

## How it works

Claude Code and Codex each write a log of every session to your disk as they run. Verbosely reads those logs and nothing else. It needs no setup, uses no tokens, and works for old sessions too.

## Privacy and security

- **What it reads:** the agents' own session logs, `~/.claude/projects/` and `~/.claude/sessions/` for Claude Code, `~/.codex/sessions/` and `~/.codex/session_index.jsonl` for Codex. Only sessions that ran in the open folder are shown. It never writes to these files.
- **What it stores:** your bookmarks and notes, in VS Code's storage for this workspace, on this computer.
- **No internet:** the extension makes no network requests. (The agents themselves send your prompts to their providers; Verbosely only reads what they log.)
- **The browser view** runs a small local server only while you use it. It listens on `127.0.0.1` only and checks the `Host` header. The link VS Code opens works once; the page then keeps a random key in a cookie, so no key stays in the address bar or your browser history. It is read-only, and shuts down 30 seconds after you close the tab. It shows the same feed as VS Code, including your bookmarks and notes.
- **Open files** from the feed opens only files the agent's steps touched.
- **Nothing hidden from you:** tool output is shown as the agent received it, including tags that look like harness messages, so instructions planted in a web page or file can't be hidden from the feed. Only the context Claude Code adds to your own prompts is left out.
- It runs in untrusted workspaces: it never runs code from the workspace, and a workspace's settings can't change how much it loads or whether exports are redacted.

Found a security problem? Please report it privately, through **Report a vulnerability** on the repository's Security tab, rather than in a public issue.

## Settings

- `verbosely.agents`: which agents to show (`claude`, `codex`). Both are on by default.
- `verbosely.popOut.alwaysOnTop`: keep the popped-out window on top. On by default.
- `verbosely.popOut.compact`: hide tabs and toolbars in the popped-out window. On by default.
- `verbosely.timestamps`: show step durations, the time of prompts and messages, and how long the turn has been running. On by default.
- `verbosely.initialHistoryMB`: how much of a long session log to load when it opens, from the end (4 MB by default, up to 64).
- `verbosely.maxItems`: the most feed entries kept per session (4000 by default, up to 20000).
- `verbosely.exportRedactSecrets`: replace likely secrets with `[redacted]` in the Markdown export. On by default.

The last three are read from your user settings only.

## Limits

- The agent's private reasoning is usually stored encrypted, so it can't be shown. Readable progress updates are shown.
- The log format isn't officially documented. If an agent update changes it, entries the extension doesn't recognise are skipped until it is updated.

## Building from source

Requires Node.js 22 and VS Code 1.100 or later.

```sh
npm ci
npm run build      # or: npm run watch
npm run check      # typecheck, lint, formatting and tests
npm run package    # builds verbosely-<version>.vsix
```

Press F5 in VS Code to run the extension in a development window.

The code is in `src/`:

- `adapters/` reads each agent's logs (`ClaudeAdapter`, `CodexAdapter`) into one event model (`core/events.ts`).
- `core/` follows the log files (`JsonlTailer`), folds events into feed items (`FeedStore`), tracks sessions (`FeedController`) and keeps bookmarks and notes (`annotations.ts`).
- `view/` and `server/` are the VS Code side: the side bar, the pop-out, the status bar and the browser view's local server.
- `webview/` is the feed's UI, in Preact. The same bundle runs in the side bar, the pop-out and the browser page.
- `shared/protocol.ts` is the message contract between the two halves.

Both log formats are undocumented, so the adapters ignore records they don't recognise. Tests use small hand-written logs in `test/fixtures/`.

## License

Verbosely is free software under the [GNU General Public License v3.0](LICENSE): you can use, study, change and share it, and copies and changed versions must stay under the same license.

The license covers the code, not the name or the icon: "Verbosely", its icon, and the Tare Digital name and marks are not licensed for other uses, so a fork you publish needs its own name and icon. Details, and the licenses of bundled software, are in [NOTICE](NOTICE).

Made by Tare Digital.

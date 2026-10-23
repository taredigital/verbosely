# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.1] - 2026-10-22

### Security

- Each step now shows what actually ran, not only the agent's description of it: the command (first line, with "+N lines") or the file's path, relative to the workspace. Steps worth a second look are flagged: a downloaded script run in a shell, a file uploaded, a recursive delete, a force push or discarded changes, credentials touched, settings for the agent, git or the editor changed, or a write outside the workspace. Flagged steps stay visible when the Narration view folds their group. Flags never block anything.
- Tool output is shown as the agent received it. Tags that look like harness messages were removed from it before, so instructions planted in a web page or file could be hidden from the feed. Only the context Claude Code adds to your own prompts is left out.
- Invisible characters in commands, paths and output (bidi controls, zero-width characters) are shown as `⟨U+202E⟩`, and such a step is flagged.
- A tool's output preview says how much was not shown.
- The browser view's link works once and then uses a cookie, so its key no longer stays in the address bar, your browser history or a screenshot.
- The Markdown export replaces things that look like secrets with `[redacted]` (the `verbosely.exportRedactSecrets` setting), and lists each step's flags.
- A workspace's settings can no longer change how much Verbosely loads or whether exports are redacted, and out-of-range values are held to their limits. Opening a session reads only the subagent logs the feed can show.
- Fixed slow paths that hostile log content could trigger: a tool result could stall VS Code's extension host for half a minute, and some message text could stall the feed.

### Changed

- The pop-out has no default keyboard shortcut any more. Ctrl+Alt+F (Cmd+Alt+F on Mac) took over VS Code's Replace on Mac and could block typing on keyboards that use AltGr. Use the pin button or "Pop Out Feed" in the Command Palette, or set your own key in Keyboard Shortcuts.
- Changing "Initial History MB" or "Max Items" now takes effect straight away, without reloading the window.
- The status bar reports the live agent even when the feed shows an older session.

### Fixed

- A message with a line starting with `|` but not ending with one, or a heading with a Windows line ending, could freeze the feed.
- A session with many subagents could open to an empty feed, and count failed steps from earlier turns as failures since your last message. A session's history now loads in time order.
- The feed no longer jumps to the end while you read a step's output or write a note.
- A note you are writing is kept when the feed switches to another session.
- Opening a file from a Codex edit said the file no longer exists; images and PDFs now open in their own viewers.
- Pressing Enter on a row's open-file button opens the file.
- The bookmarks list only offers rows the feed shows, and jumping to a bookmark inside a nested subagent works.
- A long live session no longer keeps more entries than "Max Items".
- "Thinking" and step clocks only look at the current turn, so an unfinished step from an earlier turn no longer hides them.
- A subagent box shows its duration when its steps aren't loaded.
- When Claude declines to answer or a response is stopped, the feed says so instead of ending the turn silently.
- Codex CLI steps keep the duration the log recorded, and a failure is never overwritten by a later result.
- The export: commands that contain code fences, blank lines inside code, and notes over several lines keep their shape.
- The session picker's times and the export's session title stay up to date.
- A subagent whose details were still being written could show its steps as your own.
- Smaller log-reading fixes: a record at the exact history cut is kept, a log replaced by a new file is read from the start, and long titles are never cut through an emoji.
- The browser view: opening it twice quickly no longer starts two servers, and a malformed request gets an error response instead of raising an exception.

## [0.2.0] - 2026-10-21

### Added

- Times: how long each step took (`Run all tests · 14s`), live while a step runs; the time of your prompts and the agent's messages; and how long the current turn has been running, beside "working". The `verbosely.timestamps` setting turns them off.
- Bookmarks: hover a row and click the bookmark. Bookmarked rows keep a marker, and the bookmark button in the header lists them, so you can jump back to one.
- Notes: write a note on any row. It shows under the row and can be edited or deleted.
- Bookmarks and notes are saved on this computer, per workspace. They are never written into the agent's logs or sent to the agent. The browser view shows them, read-only.
- The Markdown export includes your bookmarks, notes and step durations.
- In the Narration view, bookmarked and noted steps stay visible when their group is folded, like failed ones.

### Security

- The feed's views can only open files that the agent's steps touched, and every message from a view is checked before the extension acts on it.
- The local browser view also tells browsers not to share its responses with other sites.
- Reading logs stays bounded in memory: large appends are read in chunks, and a line that never ends is dropped.
- A log that disappears mid-read no longer raises an error.

### Changed

- The status bar entry is quieter: shorter (`Claude`, a spinner while it works, and the failed count, such as `⊗ 1`), and no longer red when a step fails. The full wording is in its tooltip.

## [0.1.0] - 2026-10-21

First release.

### Added

- Live feed of what Claude Code and Codex are doing in your workspace: narration, commands, results and errors, as they happen.
- Narration view, which folds steps between the agent's words, and an Everything view with every tool call.
- Subagents shown as boxes you can open.
- Session picker for past sessions in the folder.
- Open edited files from the feed, and export a session as Markdown.
- Pop-out: a small window that stays on top of other windows (Ctrl+Alt+F).
- Open in browser and float it in picture-in-picture (Chrome, Edge), visible even with VS Code minimised. The local page is read-only, key-protected and reachable only from your own computer.
- Status bar item showing whether the agent is working, with a count of failed steps. Clicking it shows what failed: the feed scrolls to the step and outlines it.
- Subtle animations for live changes, switched off when you ask VS Code or your system to reduce motion.
- High-contrast theme and keyboard support.

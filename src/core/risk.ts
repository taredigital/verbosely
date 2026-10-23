// Steps worth a second look. The feed's headline for a command is the
// agent's own description of it, so a hijacked agent (e.g. by instructions
// planted in a web page it read) could label anything "Run the tests". These
// checks look at what actually ran, and the feed shows what they find next
// to the headline. They flag; they never block.

import type { FeedItem } from './events';

type ToolItem = Extract<FeedItem, { kind: 'tool' }>;

export interface Risk {
  /** Short label for the row, e.g. "runs a downloaded script". */
  label: string;
}

/** Programs that fetch from the network. */
const DOWNLOADERS = new Set([
  'curl',
  'wget',
  'iwr',
  'irm',
  'invoke-webrequest',
  'invoke-restmethod',
]);
/** Programs that run a script given to them. */
const SHELLS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'iex',
  'invoke-expression',
]);
/** Words that run the command after them. */
const PREFIXES = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command']);

/**
 * What a shell command does that deserves a look. A single pass over its
 * words, so it stays linear on any input: the command line is text the agent
 * (or whoever steers it) chose.
 */
function commandRisks(command: string): string[] {
  const found = new Set<string>();
  for (const line of command.split(/\r\n?|\n/)) {
    // Shell separators become words of their own.
    const words = line
      .replace(/[|;&()]/g, ' $& ')
      .split(/\s+/)
      .filter(Boolean);
    let fetched = false; // a downloader ran earlier on this line
    let shellOpen = false; // a shell whose input is a ( … ) or $( … )
    let separator = '';
    let i = 0;
    while (i < words.length) {
      // One simple command: up to the next separator.
      const args: string[] = [];
      while (i < words.length && !/^[|;&()]$/.test(words[i]))
        args.push(words[i++]);
      let at = 0;
      // Skip `sudo -E`, `env X=1` and the like to reach the program.
      let prefixed = false;
      while (
        at < args.length &&
        (PREFIXES.has(name(args[at])) ||
          /^\w+=/.test(args[at]) ||
          (prefixed && args[at].startsWith('-')))
      ) {
        if (PREFIXES.has(name(args[at]))) prefixed = true;
        at++;
      }
      const program = name(args[at] ?? '');
      const flags = args.slice(at + 1).map(unquote);

      if (DOWNLOADERS.has(program)) {
        if (shellOpen && separator === '(')
          found.add('runs a downloaded script');
        fetched = true;
        if (uploads(program, flags)) found.add('uploads a file');
      }
      if (SHELLS.has(program)) {
        if (fetched && separator === '|') found.add('runs a downloaded script');
        shellOpen = true;
      }
      if (deletesRecursively(program, flags)) found.add('deletes recursively');
      if (program === 'git') {
        // The subcommand: the first word that is no option, nor the value
        // of `-C dir` or `-c key=value`.
        let sub = 0;
        while (sub < flags.length && flags[sub].startsWith('-'))
          sub += flags[sub] === '-C' || flags[sub] === '-c' ? 2 : 1;
        const rest = flags.slice(sub + 1);
        if (
          flags[sub] === 'push' &&
          rest.some(
            (f) => f === '-f' || f.startsWith('--force') || /^\+[^-]/.test(f),
          )
        )
          found.add('force-pushes');
        if (
          (flags[sub] === 'reset' && rest.includes('--hard')) ||
          (flags[sub] === 'clean' &&
            rest.some((f) => f === '--force' || /^-[a-z]*f/i.test(f)))
        )
          found.add('discards changes');
      }
      if (i < words.length) separator = words[i++];
    }
  }
  return [...found];
}

/** A program's name: no quotes, no directory, no .exe, any case. */
function name(word: string): string {
  const bare = unquote(word).toLowerCase();
  const start = Math.max(bare.lastIndexOf('/'), bare.lastIndexOf('\\')) + 1;
  return bare.slice(start).replace(/\.exe$/, '');
}

function unquote(word: string): string {
  return word.replace(/^["'`]+|["'`]+$/g, '');
}

/** curl -d @file, --data-binary @file, -F f=@file, -T file; iwr -InFile. */
function uploads(program: string, flags: string[]): boolean {
  if (program !== 'curl') return flags.some((f) => /^-infile$/i.test(f));
  return flags.some((flag, k) => {
    if (flag === '-T' || flag.startsWith('--upload-file')) return true;
    const data =
      /^(?:-d|-F|--data(?:-binary|-raw|-urlencode)?|--form)(?:=)?(.*)$/.exec(
        flag,
      );
    if (!data) return false;
    const value = data[1] || (flags[k + 1] ?? '');
    return value.includes('@');
  });
}

function deletesRecursively(program: string, flags: string[]): boolean {
  if (program === 'rm')
    return flags.some(
      (f) => f === '--recursive' || (/^-[a-zA-Z]+$/.test(f) && /r/i.test(f)),
    );
  if (program === 'remove-item' || program === 'ri' || program === 'del')
    return flags.some((f) => /^-rec/i.test(f) || /^-r$/i.test(f));
  if (program === 'rd' || program === 'rmdir')
    return flags.some((f) => /^\/s$/i.test(f));
  return false;
}

/** Files that hold secrets. */
const CREDENTIALS =
  /(?:^|[\\/\s"'=])(?:\.ssh[\\/]|id_(?:rsa|ed25519|ecdsa|dsa)\b|\.aws[\\/]credentials|\.env(?:\.[\w-]+)?(?:$|[\s"'])|\.netrc\b|\.npmrc\b|\.pypirc\b|\.git-credentials\b|\.docker[\\/]config\.json|\.kube[\\/]config|Login Data\b|\.gnupg[\\/])/i;

/** Settings that change what agents, git or the editor do next time. */
const CONFIG =
  /(?:^|[\\/])(?:\.git[\\/]hooks[\\/]|\.claude[\\/](?:settings(?:\.local)?\.json$|CLAUDE\.md$|(?:agents|commands|skills|hooks)[\\/])|\.codex[\\/](?:config\.toml$|AGENTS\.md$)|\.vscode[\\/](?:settings|tasks|launch)\.json$|\.mcp\.json$)/i;

/**
 * Where agents keep their own working files (memory, plans, scratch space).
 * Writing there is routine, not "outside the workspace"; the parts that
 * change their behaviour are flagged by CONFIG instead.
 */
const AGENT_AREAS =
  /[\\/]\.(?:claude|codex)[\\/]|[\\/]AppData[\\/]Local[\\/]Temp[\\/]|^\/tmp\/|^\/var\/folders\//i;

/** Tools that run a shell command (Claude Code, and Codex as "Shell"). */
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'Shell']);

/** Tools that write files. */
const WRITERS = new Set([
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'apply_patch',
  'FileChange',
]);

/**
 * What about a step deserves attention. `workspace` is the folder the feed
 * watches, so writes outside it can be flagged.
 */
export function risksOf(tool: ToolItem, workspace?: string): Risk[] {
  const risks: Risk[] = [];
  const writer = WRITERS.has(tool.name);
  // A Codex edit of several files lists them in the detail, one per line.
  const targets = tool.filePath
    ? [tool.filePath]
    : writer
      ? (tool.detail ?? '').split('\n').filter(Boolean)
      : [];
  // A Codex shell step can carry the file it read as well as its command.
  const command = COMMAND_TOOLS.has(tool.name) ? (tool.detail ?? '') : '';
  for (const label of commandRisks(command)) risks.push({ label });

  if (CREDENTIALS.test(command) || targets.some((t) => CREDENTIALS.test(t)))
    risks.push({ label: 'touches credentials' });
  if (writer) {
    if (targets.some((t) => CONFIG.test(t)))
      risks.push({ label: 'changes agent, git or editor settings' });
    if (targets.some((t) => outside(t, workspace) && !AGENT_AREAS.test(t)))
      risks.push({ label: 'outside the workspace' });
  }
  return risks;
}

/** An absolute path not in the workspace, or a relative one climbing out of it. */
function outside(p: string, workspace?: string): boolean {
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(p))
    return workspace !== undefined && !isInside(p, workspace);
  let depth = 0;
  for (const part of p.split(/[\\/]/)) {
    if (part === '..') depth--;
    else if (part && part !== '.') depth++;
    if (depth < 0) return true;
  }
  return false;
}

/** Whether `p` is `folder` or inside it (any case on Windows-style paths). */
export function isInside(p: string, folder: string): boolean {
  const windows = /^[a-zA-Z]:/.test(folder);
  const norm = (s: string) => {
    const slashed = s.replace(/\\/g, '/').replace(/\/+$/, '');
    return windows ? slashed.toLowerCase() : slashed;
  };
  const a = norm(p);
  const b = norm(folder);
  return a === b || a.startsWith(b + '/');
}

/** A path as the reader should see it: relative inside the workspace, else whole. */
export function displayPath(p: string, workspace?: string): string {
  if (!workspace || !isInside(p, workspace)) return p;
  const rest = p
    .replace(/\\/g, '/')
    .slice(workspace.replace(/\\/g, '/').replace(/\/+$/, '').length + 1);
  return rest || p;
}

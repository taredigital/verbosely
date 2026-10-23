import type { Annotations } from './annotations';
import { AGENT_NAME, type FeedItem, type SessionInfo } from './events';
import { risksOf } from './risk';
import { revealInvisible } from './text';
import { clockTime, formatDuration, MIN_SHOWN_MS } from './time';

export interface MarkdownOptions {
  /** The folder the feed watches, for the "outside the workspace" flag. */
  workspace?: string;
  /** Replace likely secrets with `[redacted]` (on unless turned off). */
  redactSecrets?: boolean;
}

/**
 * Renders a session's feed as a readable Markdown log, with the reader's
 * bookmarks and notes under the entries they belong to. Each step shows what
 * actually ran: its risks, and any invisible characters spelled out.
 */
export function toMarkdown(
  session: SessionInfo | undefined,
  items: FeedItem[],
  annotations: Annotations = {},
  options: MarkdownOptions = {},
): string {
  const redact = options.redactSecrets ?? true;
  // Everything the agent or the reader wrote goes through here.
  const text = (s: string) => (redact ? redactSecrets(s) : s);
  // Commands, paths and output: also shown exactly as they ran.
  const code = (s: string) => revealInvisible(text(s));
  const lines: string[] = [];
  const agent = session ? AGENT_NAME[session.agent] : 'Agent';
  lines.push(`# ${text(session?.title ?? 'Agent session')}`, '');
  lines.push(`*${agent} · exported ${new Date().toLocaleString()}*`, '');

  const byParent = new Map<string, FeedItem[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }

  const render = (item: FeedItem, depth: number) => {
    const quote = depth > 0 ? '> '.repeat(depth) : '';
    // Each entry ends with one blank line; blank lines inside it (code
    // blocks included) are kept as they are.
    const push = (text: string) => {
      const entry = text.replace(/^\n+|\n+$/g, '');
      if (!entry) return;
      lines.push(...entry.split('\n').map((l) => quote + l), quote.trimEnd());
    };
    const annotate = () => {
      const annotation = annotations[item.id];
      if (annotation?.bookmark) push('**Bookmarked**');
      if (annotation?.note)
        push(`**Note:** ${noteLines(text(annotation.note))}`);
    };
    switch (item.kind) {
      case 'prompt': {
        const at = clockTime(item.timestamp);
        push(`## You${at ? ` · ${at}` : ''}\n\n${text(item.text)}`);
        break;
      }
      case 'narration':
        push(text(item.text));
        break;
      case 'thinking':
        push(`*Thinking:* ${text(item.text)}`);
        break;
      case 'error':
        push(`**Error:** ${text(item.text)}`);
        break;
      case 'interrupt':
        push(`*${text(item.text)}*`);
        break;
      case 'tool': {
        const mark =
          item.status === 'error' ? '✗' : item.status === 'ok' ? '✓' : '…';
        const detail =
          item.detail && item.detail !== item.title
            ? `\n\n${codeBlock(code(item.detail))}`
            : '';
        const failure =
          item.status === 'error' && item.result
            ? `\n\nFailed:\n\n${codeBlock(code(item.result))}`
            : '';
        const took =
          item.durationMs !== undefined && item.durationMs >= MIN_SHOWN_MS
            ? ` · ${formatDuration(item.durationMs)}`
            : '';
        // Judged on the step as it ran, before anything is redacted.
        const risks = risksOf(item, options.workspace)
          .map((risk) => ` · ⚠ ${risk.label}`)
          .join('');
        push(
          `- ${mark} **${code(item.name)}** · ${code(item.title)}${took}${risks}${detail}${failure}`,
        );
        annotate();
        for (const child of byParent.get(item.callId) ?? [])
          render(child, depth + 1);
        return;
      }
    }
    annotate();
  };

  for (const item of items) if (!item.parentId) render(item, 0);
  return lines.join('\n') + '\n';
}

/** A fenced block whose fence is longer than any run of backticks in it. */
function codeBlock(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return `${fence}\n${text}\n${fence}`;
}

/** The start of a line that Markdown would read as a block of its own. */
const BLOCK_START =
  /^(?:[-+*](?=\s|$)|#{1,6}(?=\s|$)|>|<|\||`{3}|~{3}|=+\s*$|-+\s*$|([*_])(?:\s*\1){2,}\s*$)/;

/**
 * A note keeps its lines: each ends in a hard break, and none can start a
 * heading, list, quote or code block. Blank lines separate paragraphs.
 */
function noteLines(note: string): string {
  const lines = note.split(/\r?\n/).map((line) =>
    /^\s*$/.test(line)
      ? ''
      : line
          // Indents as no-break spaces: four spaces would start code.
          .replace(/^[ \t]+/, (s) => ' '.repeat(s.length))
          .replace(/^(\d+)([.)])/, '$1\\$2')
          .replace(BLOCK_START, '\\$&'),
  );
  return lines
    .map((line, i) => (line && lines[i + 1] ? `${line}\\` : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Likely secrets. Every pattern runs in linear time: no nested quantifiers,
 * and a lookbehind keeps a match from starting inside a run it already
 * scanned, so hostile input cannot make the export hang.
 */
const SECRETS: { pattern: RegExp; keep?: string }[] = [
  {
    // A private key block; if its end was cut off, everything after it.
    pattern:
      /-----BEGIN[A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END[A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g,
  },
  {
    // scheme://user:password@host keeps the scheme and the host.
    pattern: /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]+@/gi,
    keep: '$1[redacted]@',
  },
  {
    pattern:
      /(\bAuthorization["']?[ \t]*[:=][ \t]*["']?Bearer[ \t]+)[^\s"'`\\]+/gi,
    keep: '$1[redacted]',
  },
  // AWS access key ids
  { pattern: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g },
  // GitHub
  {
    pattern: /(?<![\w-])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})/g,
  },
  // Slack
  { pattern: /(?<![\w-])xox[abprs]-[A-Za-z0-9-]{10,}/g },
  // OpenAI and Anthropic (sk-…, sk-proj-…, sk-ant-…); random, so a digit
  // somewhere, which keeps hyphenated words out.
  { pattern: /(?<![\w-])sk-(?=[\w-]*\d)[\w-]{20,}/g },
  // Stripe
  { pattern: /(?<![\w-])[rs]k_live_[A-Za-z0-9]{10,}/g },
  // Google API keys
  { pattern: /(?<![\w-])AIza[\w-]{35}/g },
  // npm
  { pattern: /(?<![\w-])npm_[A-Za-z0-9]{36}/g },
  // JWTs: header.payload.signature, the first two JSON (so "eyJ")
  { pattern: /(?<![\w-])eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*/g },
];

/**
 * `password=…`, `"api_key": "…"`, `GITHUB_TOKEN: …`, `AWS_SECRET_ACCESS_KEY=…`
 * and the like: the key must end in one of these words, so `max_tokens: 900`
 * stays. A value that is a reference ($VAR, ${…}, <…>) or already redacted
 * is left alone.
 */
const KEY_VALUE =
  /(?<![\w-])([\w-]*(?:password|passwd|secret(?:[_-]?(?:access[_-]?)?key)?|token|api[_-]?key)["']?[ \t]*[:=][ \t]*)("[^"\n]*"|'[^'\n]*'|(?![$%{<([=])[^\s"'`,;&)}\]]+)/gi;

/** Values that name a type or a setting rather than hold a secret. */
const NOT_SECRET = new Set([
  'true',
  'false',
  'null',
  'none',
  'undefined',
  'string',
  'number',
  'boolean',
]);

/** Replaces likely secrets (keys, tokens, passwords) with `[redacted]`. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern, keep } of SECRETS)
    out = out.replace(pattern, keep ?? '[redacted]');
  return out.replace(KEY_VALUE, (match, key: string, value: string) => {
    const quote = /^["']/.test(value) ? value[0]! : '';
    const bare = quote ? value.slice(1, -1) : value;
    if (!bare || NOT_SECRET.has(bare.toLowerCase())) return match;
    return `${key}${quote}[redacted]${quote}`;
  });
}
